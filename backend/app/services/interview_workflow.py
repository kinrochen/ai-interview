"""Interview lifecycle, private notes, idempotent recording and evidence review."""

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import String, or_

from app.models.models import (
    Interview,
    InterviewPanel,
    InterviewStatus,
    InterviewResult,
    InterviewAnalysisTask,
    Resume,
    ResumeStatus,
    ScreeningResult,
    Offer,
    OfferStatus,
    RecruitmentEvent,
    User,
    UserRole,
)
from app.services.recruitment_operations import utc

STORAGE = Path(
    os.getenv("INTERVIEW_PRIVATE_STORAGE", "private_storage/interviews")
).resolve()
DIMENSIONS = {
    "technical_fit": ("技术匹配", 35),
    "problem_solving": ("问题解决", 20),
    "learning_ability": ("学习能力", 15),
    "engineering_mindset": ("工程意识", 15),
    "collaboration": ("沟通协作", 10),
    "culture_fit": ("团队匹配", 5),
}


def assigned_ids(row):
    ids = {str(member) for member in (row.panel_members or [])}
    ids.update(str(panel.interviewer_id) for panel in row.panels)
    if row.interviewer_id:
        ids.add(str(row.interviewer_id))
    normalized = set()
    for item in ids:
        try:
            normalized.add(str(UUID(item)))
        except (ValueError, TypeError):
            continue
    return normalized


def visible_query(db, user):
    query = db.query(Interview)
    if user.role == UserRole.INTERVIEWER:
        # Panel rows are canonical for new schedules. JSON supports legacy assignments.
        query = query.filter(
            or_(
                Interview.interviewer_id == user.id,
                Interview.id.in_(
                    db.query(InterviewPanel.interview_id).filter_by(
                        interviewer_id=user.id
                    )
                ),
                Interview.panel_members.cast(String).like(f"%{user.id}%"),
            )
        )
    return query


def interview_access(db, interview_id, user, *, lock=False, member=False):
    query = db.query(Interview).filter_by(id=interview_id)
    row = query.with_for_update().first() if lock else query.first()
    if not row:
        raise HTTPException(404, "面试不存在")
    is_member = str(user.id) in assigned_ids(row)
    if (member and not is_member) or (
        user.role == UserRole.INTERVIEWER and not is_member
    ):
        raise HTTPException(403, "需要本场面试成员权限")
    return row


def require_editable(row):
    if row.final_decision_at or row.legacy_completed:
        raise HTTPException(409, "面试已经完成最终决策，证据与评价已归档")
    if row.status == InterviewStatus.CANCELLED:
        raise HTTPException(409, "面试已经取消")


def own_panel(db, row, user):
    panel = (
        db.query(InterviewPanel)
        .filter_by(interview_id=row.id, interviewer_id=user.id)
        .first()
    )
    if not panel:
        panel = InterviewPanel(interview_id=row.id, interviewer_id=user.id)
        db.add(panel)
        db.flush()
    return panel


def questions_revision(row):
    content = json.dumps(row.questions, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def serialize(db, row, user):
    ended = row.lifecycle_state == "ended" or row.legacy_completed
    users = {
        str(u.id): u.full_name or u.email
        for u in db.query(User)
        .filter(User.id.in_([UUID(i) for i in assigned_ids(row)]))
        .all()
    }
    reviews = []
    for panel in row.panels:
        can_read = ended or panel.interviewer_id == user.id
        reviews.append(
            {
                "interviewer_id": str(panel.interviewer_id),
                "name": users.get(str(panel.interviewer_id), "面试官"),
                "note": panel.interview_note if can_read else None,
                "supplements": panel.note_supplements if can_read else None,
                "scores": panel.human_scores if can_read else None,
                "comments": panel.human_comments if can_read else None,
                "recommendation": panel.human_recommendation if can_read else None,
                "submitted_at": panel.human_review_submitted_at,
                "history": panel.human_review_history if can_read else None,
                "legacy_submitted": panel.is_submitted,
                "question_scores": (panel.scores or {}) if can_read else None,
                "question_comments": (panel.comments or {}) if can_read else None,
            }
        )
    known = {r["interviewer_id"] for r in reviews}
    reviews.extend(
        {"interviewer_id": i, "name": users.get(i, "面试官"), "submitted_at": None}
        for i in assigned_ids(row) - known
    )
    tasks = (
        db.query(InterviewAnalysisTask)
        .filter_by(interview_id=row.id)
        .order_by(InterviewAnalysisTask.revision.desc())
        .limit(5)
        .all()
    )
    from app.services.audio_service import get_transcription_config, is_asr_configured

    return {
        "asr_configured": is_asr_configured(get_transcription_config(db)),
        "id": str(row.id),
        "candidate_name": row.resume.candidate_name if row.resume else "候选人",
        "position_title": row.position.title if row.position else "",
        "resume": {
            "id": str(row.resume.id),
            "file_path": row.resume.file_path,
            "raw_text": row.resume.raw_text,
            "parsed_data": row.resume.parsed_data,
        } if row.resume else None,
        "position": {
            "description": row.position.description,
            "requirements": row.position.requirements,
        } if row.position else None,
        "round": row.round,
        "scheduled_at": row.interview_time,
        "started_at": row.started_at,
        "ended_at": row.ended_at,
        "state": row.lifecycle_state,
        "status": row.status.value,
        "legacy_completed": row.legacy_completed,
        "questions": row.questions or [],
        "questions_pending": row.questions is None,
        "questions_revision": questions_revision(row),
        "is_member": str(user.id) in assigned_ids(row),
        "can_start": str(user.id) in assigned_ids(row)
        or (not assigned_ids(row) and user.role in {UserRole.ADMIN, UserRole.HR}),
        "recording_owner_id": (
            str(row.recording_owner_id) if row.recording_owner_id else None
        ),
        "recording_heartbeat_at": row.recording_heartbeat_at,
        "recording_session_id": row.recording_session_id,
        "chunk_count": len(row.recording_chunks or []),
        "recording_active": bool(
            row.recording_session_id
            and row.recording_heartbeat_at
            and utc(row.recording_heartbeat_at)
            > datetime.now(timezone.utc) - timedelta(seconds=45)
        ),
        "pending_recording_sessions": [
            {
                "id": item["id"],
                "owner_id": item["owner_id"],
                "owner_name": users.get(item["owner_id"], "录音成员"),
            }
            for item in (row.recording_sessions or [])
            if not item.get("released_at") and not item.get("sealed_at")
        ],
        "audio_available": bool(row.recording_audio_path),
        "transcript": row.transcript_data,
        "analysis_status": row.ai_analysis_status,
        "analysis_error": row.ai_analysis_error,
        "analysis_revision": row.analysis_revision,
        "analysis": row.ai_analysis,
        "reviews": reviews,
        "final_decision_at": row.final_decision_at,
        "result": row.result.value,
        "decision_history": row.decision_history or [],
        "tasks": [
            {
                "id": str(t.id),
                "kind": t.kind,
                "status": t.status,
                "attempts": t.attempts,
                "error": t.error,
                "revision": t.revision,
            }
            for t in tasks
        ],
    }


def require_current_questions(row, revision):
    if row.questions is None:
        raise HTTPException(409, "面试题仍在生成，请稍后刷新")
    if revision != questions_revision(row):
        raise HTTPException(409, "面试题已更新，请刷新题目后重新保存")


def shift_question_entries(entries, deleted_index):
    result = {}
    for key, value in (entries or {}).items():
        if not str(key).isdigit():
            result[key] = value
        elif int(key) < deleted_index:
            result[key] = value
        elif int(key) > deleted_index:
            result[str(int(key) - 1)] = value
    return result


def change_question(db, row, user, action, index, question, revision):
    require_editable(row)
    if str(user.id) not in assigned_ids(row) and user.role not in {
        UserRole.ADMIN, UserRole.HR
    }:
        raise HTTPException(403, "需要本场面试成员权限")
    if row.lifecycle_state not in {"scheduled", "in_progress"}:
        raise HTTPException(409, "面试结束后题目已归档")
    require_current_questions(row, revision)
    questions = list(row.questions)
    if action != "add" and (index is None or index >= len(questions)):
        raise HTTPException(422, "面试题不存在")
    if action != "delete":
        content = (question or {}).get("content") or (question or {}).get("question")
        if not isinstance(content, str) or not content.strip():
            raise HTTPException(422, "请填写问题内容")
    if action == "add":
        questions.append(question)
    elif action == "update":
        questions[index] = question
    else:
        questions.pop(index)
        for record in [row, *row.panels]:
            for field in ("scores", "comments", "audio_records", "transcripts"):
                entries = getattr(record, field)
                if entries:
                    setattr(record, field, shift_question_entries(entries, index))
    from app.services.interview_service import update_interview_questions

    return update_interview_questions(db, row.id, questions)


def save_question_review(db, row, user, index, score, comments, revision):
    require_editable(row)
    if row.lifecycle_state != "in_progress":
        raise HTTPException(409, "面试进行中可保存逐题记录")
    require_current_questions(row, revision)
    if index >= len(row.questions):
        raise HTTPException(422, "面试题不存在")
    panel = own_panel(db, row, user)
    scores, notes = dict(panel.scores or {}), dict(panel.comments or {})
    key = str(index)
    if score is None:
        scores.pop(key, None)
    else:
        scores[key] = score
    notes[key] = comments
    panel.scores, panel.comments = scores, notes
    db.commit()


def take_over(db, row, user):
    require_editable(row)
    if user.role not in {UserRole.HR, UserRole.ADMIN}:
        raise HTTPException(403, "HR 或管理员可以接手未分配成员的面试")
    if assigned_ids(row):
        raise HTTPException(409, "本场面试已有指定成员")
    row.panel_members = [str(user.id)]
    own_panel(db, row, user)


def start(db, row, user):
    require_editable(row)
    if row.lifecycle_state not in {"scheduled", "in_progress"}:
        raise HTTPException(409, "面试已经结束")
    if str(user.id) not in assigned_ids(row):
        take_over(db, row, user)
    if row.lifecycle_state == "scheduled":
        row.started_at = datetime.now(timezone.utc)
        row.lifecycle_state = "in_progress"
        row.status = InterviewStatus.IN_PROGRESS
    db.commit()


def claim_recording(db, row, user, session_id):
    require_editable(row)
    if row.lifecycle_state != "in_progress":
        raise HTTPException(409, "开始面试后可以录音")
    now = datetime.now(timezone.utc)
    active = row.recording_heartbeat_at and utc(
        row.recording_heartbeat_at
    ) > now - timedelta(seconds=45)
    if (
        active
        and row.recording_session_id
        and (
            row.recording_session_id != session_id or row.recording_owner_id != user.id
        )
    ):
        raise HTTPException(409, "当前有成员正在录音，停止录音或等待连接租约释放后重试")
    sessions = row.recording_sessions or []
    existing = next((item for item in sessions if item["id"] == str(session_id)), None)
    if existing and existing["owner_id"] != str(user.id):
        raise HTTPException(403, "需要原录音成员恢复这个录音会话")
    if existing and existing.get("released_at"):
        raise HTTPException(409, "该录音会话已保存，请开始新的录音")
    if not existing and len(sessions) >= 10000:
        raise HTTPException(413, "录音会话数量已达上限")
    if not existing:
        sessions = sessions + [
            {
                "id": str(session_id),
                "owner_id": str(user.id),
                "sequence": len(sessions),
                "started_at": now.isoformat(),
                "released_at": None,
            }
        ]
    row.recording_sessions = sessions
    row.recording_owner_id, row.recording_session_id = user.id, session_id
    row.recording_heartbeat_at = now
    db.commit()


def check_session(row, user, session_id):
    require_editable(row)
    if (
        row.lifecycle_state != "in_progress"
        or row.recording_owner_id != user.id
        or row.recording_session_id != session_id
    ):
        raise HTTPException(409, "录音会话已改变，请重新连接")


def release_recording(db, row, user, session_id):
    check_session(row, user, session_id)
    now = datetime.now(timezone.utc).isoformat()
    row.recording_sessions = [
        {**item, "released_at": now} if item["id"] == str(session_id) else item
        for item in (row.recording_sessions or [])
    ]
    row.recording_session_id, row.recording_owner_id = None, None
    db.commit()


def append_chunk(db, row, user, session_id, index, data, content_type):
    check_session(row, user, session_id)
    if not data or len(data) > 20 * 1024 * 1024 or index < 0 or index >= 10000:
        raise HTTPException(413, "录音分片为空或超出限制")
    chunks = row.recording_chunks or []
    digest = hashlib.sha256(data).hexdigest()
    previous = next(
        (c for c in chunks if c["session"] == str(session_id) and c["index"] == index),
        None,
    )
    if previous:
        if previous["sha256"] != digest:
            raise HTTPException(409, "相同序号的录音内容不一致")
        row.recording_heartbeat_at = datetime.now(timezone.utc)
        db.commit()
        return {"chunk_count": len(chunks)}
    if len(chunks) >= 10000:
        raise HTTPException(413, "单场录音最多 10000 个分片")
    if sum(c["size"] for c in chunks) + len(data) > 2 * 1024**3:
        raise HTTPException(413, "单场录音最多 2 GB")
    folder = STORAGE / str(row.id) / str(session_id)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{index:06d}.chunk"
    temp = folder / f"{uuid4()}.tmp"
    try:
        temp.write_bytes(data)
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)
    row.recording_chunks = chunks + [
        {
            "session": str(session_id),
            "index": index,
            "sha256": digest,
            "size": len(data),
            "path": str(target),
            "mime": content_type,
        }
    ]
    row.recording_heartbeat_at = datetime.now(timezone.utc)
    db.commit()
    return {"chunk_count": len(row.recording_chunks)}


def queue_analysis(db, row, kind):
    row.analysis_revision = (row.analysis_revision or 0) + 1
    row.ai_analysis, row.ai_analysis_error, row.ai_analysis_status = (
        None,
        None,
        "queued",
    )
    now = datetime.now(timezone.utc)
    db.add(
        InterviewAnalysisTask(
            interview_id=row.id,
            revision=row.analysis_revision,
            kind=kind,
            status="queued",
            attempts=0,
            created_at=now,
            updated_at=now,
        )
    )


def end(db, row, user, expected_chunks, force=False):
    require_editable(row)
    if row.lifecycle_state == "ended":
        return
    if row.lifecycle_state != "in_progress":
        raise HTTPException(409, "面试尚未开始")
    active = (
        row.recording_session_id
        and row.recording_heartbeat_at
        and utc(row.recording_heartbeat_at)
        > datetime.now(timezone.utc) - timedelta(seconds=45)
    )
    if active and not (force and user.role == UserRole.ADMIN):
        raise HTTPException(409, "请先停止并上传录音，再结束面试")
    unfinished = [
        item for item in (row.recording_sessions or []) if not item.get("released_at")
    ]
    if unfinished and not (force and user.role == UserRole.ADMIN):
        raise HTTPException(
            409, "录音会话尚未确认保存，请原录音成员恢复上传并确认保存后再结束"
        )
    chunks = row.recording_chunks or []
    if expected_chunks is not None and expected_chunks != len(chunks):
        raise HTTPException(409, "录音尚未全部上传，请重试")
    incomplete = False
    sessions = {c["session"] for c in chunks}
    for session in sessions:
        indices = sorted(c["index"] for c in chunks if c["session"] == session)
        if indices != list(range(len(indices))):
            if not (force and user.role == UserRole.ADMIN):
                raise HTTPException(409, "录音存在缺失分片，请恢复上传")
            incomplete = True
    row.lifecycle_state, row.status, row.ended_at = (
        "ended",
        InterviewStatus.ANALYZING,
        datetime.now(timezone.utc),
    )
    if force and user.role == UserRole.ADMIN and not assigned_ids(row):
        take_over(db, row, user)
    if force and user.role == UserRole.ADMIN:
        row.recording_sessions = [
            (
                {
                    **item,
                    "sealed_at": row.ended_at.isoformat(),
                    "closed_by": str(user.id),
                }
                if not item.get("released_at")
                else item
            )
            for item in (row.recording_sessions or [])
        ]
        db.add(
            RecruitmentEvent(
                position_id=row.position_id,
                resume_id=row.resume_id,
                subject_type="interviews",
                subject_id=row.id,
                event_type="recording_end_forced",
                cycle=row.position.recruitment_cycle if row.position else 1,
                actor_id=user.id,
                occurred_at=row.ended_at,
                details={
                    "chunks": len(chunks),
                    "unconfirmed_sessions": [item["id"] for item in unfinished],
                    "missing_chunks": incomplete,
                },
            )
        )
    row.recording_session_id, row.recording_owner_id = None, None
    if incomplete:
        row.ai_analysis_status = "recording_incomplete"
        row.ai_analysis_error = "录音分片缺失，请导入完整转写后分析"
    elif chunks:
        queue_analysis(db, row, "asr")
    else:
        row.ai_analysis_status = "no_audio"
    db.commit()


def save_note(db, row, user, text, supplement=False):
    require_editable(row)
    panel = own_panel(db, row, user)
    if supplement:
        if row.lifecycle_state != "ended" or not text.strip():
            raise HTTPException(409, "结束面试后可以补充有效记录")
        panel.note_supplements = (panel.note_supplements or []) + [
            {"text": text.strip(), "at": datetime.now(timezone.utc).isoformat()}
        ]
    else:
        if row.lifecycle_state != "in_progress":
            raise HTTPException(409, "面试进行中可以编辑笔记")
        panel.interview_note = text
    db.commit()


def submit_review(db, row, user, scores, comments, recommendation):
    require_editable(row)
    if row.lifecycle_state != "ended":
        raise HTTPException(409, "结束面试后可以提交人工评价")
    if set(scores) != set(DIMENSIONS) or any(
        not isinstance(v, int) or isinstance(v, bool) or not 0 <= v <= 10
        for v in scores.values()
    ):
        raise HTTPException(422, "请填写全部六个维度的 0–10 分评分")
    if not comments.strip() or recommendation not in {
        "passed",
        "rejected",
        "waitlist",
        "next_round",
        "hired",
    }:
        raise HTTPException(422, "请填写评价依据与建议")
    panel = own_panel(db, row, user)
    now = datetime.now(timezone.utc)
    panel.human_scores, panel.human_comments, panel.human_recommendation = (
        scores,
        comments.strip(),
        recommendation,
    )
    panel.human_review_submitted_at = panel.human_review_submitted_at or now
    panel.human_review_updated_at = now
    panel.human_review_history = (panel.human_review_history or []) + [
        {
            "scores": scores,
            "comments": comments.strip(),
            "recommendation": recommendation,
            "at": now.isoformat(),
        }
    ]
    db.commit()


def decide(db, row, user, result, reason):
    if user.role not in {UserRole.ADMIN, UserRole.HR}:
        raise HTTPException(403, "需要 HR 或管理员权限")
    if (
        row.legacy_completed
        or row.status == InterviewStatus.CANCELLED
        or row.lifecycle_state != "ended"
    ):
        raise HTTPException(409, "当前面试无法决策")
    members = assigned_ids(row)
    submitted = {
        str(p.interviewer_id) for p in row.panels if p.human_review_submitted_at
    }
    if not members or not members.issubset(submitted):
        raise HTTPException(409, "请等待全部面试官提交人工评价")
    if (
        result not in {"passed", "rejected", "waitlist", "next_round", "hired"}
        or not reason.strip()
    ):
        raise HTTPException(422, "请选择决策并填写依据")
    now = datetime.now(timezone.utc)
    row.decision_history = (row.decision_history or []) + [
        {
            "old": row.result.value,
            "result": result,
            "reason": reason.strip(),
            "actor": str(user.id),
            "at": now.isoformat(),
        }
    ]
    row.result, row.status = InterviewResult(result), InterviewStatus.COMPLETED
    row.final_decision_at, row.final_decision_by = now, user.id
    if row.ai_analysis_status in {"queued", "transcribing", "analyzing", "retry_wait"}:
        row.analysis_revision = (row.analysis_revision or 0) + 1
        row.ai_analysis_status = "superseded"
    resume = db.get(Resume, row.resume_id)
    if resume and resume.position_id == row.position_id:
        # A decision correction applies only while no later interview/offer has started.
        later = (
            db.query(Interview)
            .filter(
                Interview.resume_id == row.resume_id,
                Interview.round > row.round,
                Interview.status != InterviewStatus.CANCELLED,
            )
            .first()
        )
        if later:
            raise HTTPException(409, "候选人已进入后续轮次，请在后续面试中决策")
        active_offer = (
            db.query(Offer)
            .filter(
                Offer.resume_id == row.resume_id,
                Offer.position_id == row.position_id,
                Offer.status.in_(
                    [
                        OfferStatus.DRAFT,
                        OfferStatus.PENDING,
                        OfferStatus.SENT,
                        OfferStatus.ACCEPTED,
                        OfferStatus.DEPARTED,
                    ]
                ),
            )
            .first()
        )
        if active_offer or resume.status in {
            ResumeStatus.OFFER_ACCEPTED,
            ResumeStatus.ONBOARDING,
            ResumeStatus.COMPLETED,
            ResumeStatus.DEPARTED,
        }:
            raise HTTPException(409, "候选人已进入 Offer 或入职流程")
        resume.status = {
            "passed": ResumeStatus.INTERVIEW_PASSED,
            "hired": ResumeStatus.OFFER_PENDING,
            "next_round": ResumeStatus.PENDING_INTERVIEW,
            "rejected": ResumeStatus.INTERVIEW_FAILED,
            "waitlist": ResumeStatus.WAITLIST,
        }[result]
        resume.screening_result = {
            "rejected": ScreeningResult.REJECTED,
            "waitlist": ScreeningResult.WAITLIST,
        }.get(result, ScreeningResult.PASSED)
    reviews = [p for p in row.panels if p.human_review_submitted_at]
    row.total_score = round(
        sum(
            sum(p.human_scores[key] * weight for key, (_, weight) in DIMENSIONS.items())
            / 100
            for p in reviews
        )
        / len(reviews)
    )
    db.commit()
