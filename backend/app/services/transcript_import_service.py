"""Parse user-supplied interview transcripts without persisting the source file."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile, status

MAX_TRANSCRIPT_IMPORT_SIZE = 5 * 1024 * 1024
SUPPORTED_TRANSCRIPT_SUFFIXES = {".txt", ".vtt"}
MAX_IMPORTED_SEGMENT_CHARS = 18_000

_TIMESTAMP_RE = re.compile(
    r"^\s*(?P<start>(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*"
    r"(?P<end>(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$",
    re.MULTILINE,
)
_SPEAKER_RE = re.compile(r"^\s*(?P<speaker>[^:：\n]{1,100})[:：]\s*(?P<text>.*)$")


def _decode_transcript(data: bytes) -> str:
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="文件编码无法识别，请使用 UTF-8、UTF-8 BOM 或 GB18030",
    )


def _timestamp_seconds(value: str) -> float:
    parts = value.replace(",", ".").split(":")
    if len(parts) == 2:
        hours = 0
        minutes, seconds = parts
    else:
        hours, minutes, seconds = parts
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def _speaker_and_text(lines: list[str]) -> tuple[str | None, str]:
    cleaned = [line.strip() for line in lines if line.strip()]
    if not cleaned:
        return None, ""
    match = _SPEAKER_RE.match(cleaned[0])
    if not match:
        return None, "\n".join(cleaned)
    speaker = match.group("speaker").strip()
    first_text = match.group("text").strip()
    text_lines = ([first_text] if first_text else []) + cleaned[1:]
    return speaker, "\n".join(text_lines).strip()


def _parse_webvtt(text: str) -> dict[str, Any]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    segments: list[dict[str, Any]] = []
    warnings: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        match = _TIMESTAMP_RE.match(line)
        if not match:
            if "-->" in line:
                warnings.append(f"第 {index + 1} 行的时间戳无法识别，已跳过")
            index += 1
            continue

        start = _timestamp_seconds(match.group("start"))
        end = _timestamp_seconds(match.group("end"))
        cue_line = index + 1
        index += 1
        body: list[str] = []
        while index < len(lines) and lines[index].strip():
            body.append(lines[index])
            index += 1
        speaker, cue_text = _speaker_and_text(body)
        if end < start:
            warnings.append(f"第 {cue_line} 行的结束时间早于开始时间，已跳过")
        elif not cue_text:
            warnings.append(f"第 {cue_line} 行对应的字幕为空，已跳过")
        else:
            segment: dict[str, Any] = {
                "id": f"import-{len(segments) + 1}",
                "start": start,
                "end": end,
                "text": cue_text,
            }
            if speaker:
                segment["speaker"] = speaker
            segments.append(segment)
        index += 1

    return {
        "format": "webvtt",
        "has_timestamps": True,
        "segments": segments,
        "warnings": warnings,
    }


def _parse_plain_text(text: str) -> dict[str, Any]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    segments = []
    for index, line in enumerate(lines):
        speaker, content = _speaker_and_text([line])
        if not content:
            continue
        segment: dict[str, Any] = {
            "id": f"import-{len(segments) + 1}",
            # Synthetic ranges keep evidence validation possible; the UI hides
            # them because has_timestamps is false.
            "start": float(index),
            "end": float(index + 1),
            "text": content,
        }
        if speaker:
            segment["speaker"] = speaker
        segments.append(segment)
    return {
        "format": "plain_text",
        "has_timestamps": False,
        "segments": segments,
        "warnings": ["普通纯文本不包含可靠时间戳；分析仍会使用全部正文。"],
    }


def _split_long_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for segment in segments:
        content = str(segment.get("text") or "")
        pieces = [
            content[index : index + MAX_IMPORTED_SEGMENT_CHARS]
            for index in range(0, len(content), MAX_IMPORTED_SEGMENT_CHARS)
        ]
        for piece in pieces:
            result.append({**segment, "id": f"import-{len(result) + 1}", "text": piece})
    return result


def parse_transcript_bytes(data: bytes, filename: str) -> dict[str, Any]:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in SUPPORTED_TRANSCRIPT_SUFFIXES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="仅支持 .txt 和 .vtt 文件",
        )
    if len(data) > MAX_TRANSCRIPT_IMPORT_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="文件不能超过 5 MB",
        )
    if not data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="文件内容为空"
        )

    text = _decode_transcript(data).replace("\x00", "").strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="文件内容为空"
        )

    looks_like_vtt = bool(
        _TIMESTAMP_RE.search(text)
    ) or text.lstrip().upper().startswith("WEBVTT")
    parsed = _parse_webvtt(text) if looks_like_vtt else _parse_plain_text(text)
    parsed["segments"] = _split_long_segments(parsed["segments"])
    if not parsed["segments"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="文件中没有可导入的有效转写内容",
        )
    parsed["text"] = "\n".join(segment["text"] for segment in parsed["segments"])
    parsed["speakers"] = sorted(
        {
            str(segment["speaker"])
            for segment in parsed["segments"]
            if segment.get("speaker") is not None
        }
    )
    return parsed


async def parse_transcript_upload(file: UploadFile) -> dict[str, Any]:
    data = await file.read(MAX_TRANSCRIPT_IMPORT_SIZE + 1)
    return parse_transcript_bytes(data, file.filename or "")
