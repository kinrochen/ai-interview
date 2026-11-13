import os
from http import HTTPStatus
import dashscope
from dashscope.audio.asr import Recognition
from dotenv import load_dotenv
from pydub import AudioSegment
import json
import tempfile
import logging

load_dotenv()

logger = logging.getLogger(__name__)

dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")


class ASRConfigurationError(ValueError):
    pass


def get_asr_config_record(db):
    from app.models.models import SystemConfig

    return (
        db.query(SystemConfig)
        .order_by(SystemConfig.asr_provider.is_(None), SystemConfig.id.asc())
        .first()
    )


def get_transcription_config(db):
    config = get_asr_config_record(db)
    provider = (
        (config.asr_provider if config else None)
        or os.getenv("ASR_PROVIDER")
        or "dashscope"
    )
    return {
        "provider": provider,
        "url": (config.asr_base_url if config else None)
        or os.getenv("ASR_BASE_URL")
        or "",
        "key": (config.asr_api_key if config else None)
        or os.getenv("ASR_API_KEY")
        or (os.getenv("DASHSCOPE_API_KEY") if provider == "dashscope" else None),
        "model": (config.asr_model if config else None)
        or os.getenv("ASR_MODEL")
        or (
            "paraformer-realtime-v2"
            if provider == "dashscope"
            else "paraformer-offline"
        ),
    }


def is_asr_configured(config):
    if config["provider"] == "dashscope":
        return bool(config["key"])
    return bool(config["url"] and config["model"])


def transcribe_audio(
    audio_file_path: str,
    enable_diarization: bool = True,
    *,
    api_key: str | None = None,
    model: str = "paraformer-realtime-v2",
) -> dict:
    """
    Transcribe audio file using DashScope ASR SDK (FunASR).
    支持说话人分离，返回结构化的转写结果。

    Returns:
        dict: {
            "text": "完整转写文本",
            "segments": [
                {"speaker": "未识别说话人", "text": "...", "start": 0, "end": 5.2},
                ...
            ]
        }
    """
    if not os.path.exists(audio_file_path):
        return {"text": "", "segments": []}

    wav_path = None
    try:
        sound = AudioSegment.from_file(audio_file_path)
        sound = sound.set_frame_rate(16000).set_channels(1)

        fd, wav_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        sound.export(wav_path, format="wav")

        recognition = Recognition(
            model=model,
            api_key=api_key or os.getenv("DASHSCOPE_API_KEY"),
            format="wav",
            sample_rate=16000,
            language_hints=["zh", "en"],
            callback=None,
        )

        result = recognition.call(wav_path)

        if os.path.exists(wav_path):
            os.remove(wav_path)

        if result.status_code == HTTPStatus.OK:
            sentences = result.get_sentence()

            if not sentences:
                logger.warning(f"ASR Result empty: {result}")
                return {"text": "", "segments": []}

            segments = []
            full_text = ""

            if isinstance(sentences, list):
                for idx, s in enumerate(sentences):
                    if isinstance(s, dict):
                        text = s.get("text", "")
                        start = s.get("begin_time", 0) / 1000.0
                        end = s.get("end_time", 0) / 1000.0
                        speaker = s.get("speaker") or "未识别说话人"

                        segments.append(
                            {
                                "speaker": speaker,
                                "text": text,
                                "start": round(start, 2),
                                "end": round(end, 2),
                            }
                        )
                        full_text += text + " "

            elif isinstance(sentences, dict) and "text" in sentences:
                text = sentences.get("text", "")
                full_text = text
                segments.append(
                    {
                        "speaker": "未识别说话人",
                        "text": text,
                        "start": 0,
                        "end": len(sound) / 1000.0,
                    }
                )
            else:
                full_text = str(sentences)
                segments.append(
                    {
                        "speaker": "未识别说话人",
                        "text": full_text,
                        "start": 0,
                        "end": len(sound) / 1000.0,
                    }
                )

            return {"text": full_text.strip(), "segments": segments}
        else:
            logger.error(f"ASR Error: {result.message}")
            return {"text": f"[语音转写失败: {result.message}]", "segments": []}

    except Exception as e:
        logger.error(f"Transcription process failed: {e}")
        return {"text": f"[语音转写异常: {str(e)}]", "segments": []}

    finally:
        if wav_path and os.path.exists(wav_path):
            os.remove(wav_path)


def transcribe_audio_simple(audio_file_path: str) -> str:
    """
    简单转写，只返回文本（向后兼容）
    """
    result = transcribe_audio(audio_file_path)
    return result.get("text", "")


def format_transcript_for_display(transcript_data: dict) -> str:
    """
    格式化转写结果用于显示
    """
    if isinstance(transcript_data, str):
        return transcript_data

    segments = transcript_data.get("segments", [])
    if not segments:
        return transcript_data.get("text", "")

    lines = []
    for seg in segments:
        speaker = seg.get("speaker", "说话人")
        text = seg.get("text", "")
        timestamp = f"[{seg.get('start', 0):.1f}s]"
        lines.append(f"{timestamp} {speaker}: {text}")

    return "\n".join(lines)
