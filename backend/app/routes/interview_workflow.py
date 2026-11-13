from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
    Query,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, StrictInt
from sqlalchemy.orm import Session

from app.config.database import get_db
from app.core.security import get_current_user_dep
from app.models.models import User, UserRole, SystemConfig
from app.services import interview_workflow as workflow
from app.services.audio_service import (
    get_transcription_config,
    get_asr_config_record,
    is_asr_configured,
)
from app.services.transcript_import_service import parse_transcript_upload

router = APIRouter(prefix="/interview-workflow", tags=["interview-workflow"])


class Note(BaseModel):
    text: str = Field(max_length=20000)
    supplement: bool = False


class RecordingSession(BaseModel):
    session_id: UUID


class EndInterview(BaseModel):
    expected_chunks: int | None = Field(default=None, ge=0)
    force: bool = False


class Review(BaseModel):
    scores: dict[str, StrictInt]
    comments: str = Field(min_length=1, max_length=20000)
    recommendation: str


class Decision(BaseModel):
    result: str
    reason: str = Field(min_length=1, max_length=5000)


class ASRSettings(BaseModel):
    provider: Literal["dashscope", "openai_compatible"]
    base_url: str = Field(default="", max_length=2000)
    model: str = Field(default="", max_length=128)
    api_key: str | None = Field(default=None, max_length=2000)


class QuestionChange(BaseModel):
    action: Literal["add", "update", "delete"]
    index: int | None = Field(default=None, ge=0)
    question: dict | None = None
    expected_revision: str


class QuestionReview(BaseModel):
    index: int = Field(ge=0)
    score: StrictInt | None = Field(default=None, ge=0, le=10)
    comments: str = Field(default="", max_length=5000)
    expected_revision: str


@router.get("/settings/asr")
def asr_settings(
    db: Session = Depends(get_db), user: User = Depends(get_current_user_dep)
):
    if user.role != UserRole.ADMIN:
        raise HTTPException(403, "需要管理员权限")
    config = get_transcription_config(db)
    return {
        "provider": config["provider"],
        "base_url": config["url"],
        "model": config["model"],
        "has_api_key": bool(config["key"]),
        "configured": is_asr_configured(config),
    }


@router.put("/settings/asr")
def update_asr(
    body: ASRSettings,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    if user.role != UserRole.ADMIN:
        raise HTTPException(403, "需要管理员权限")
    if body.provider == "openai_compatible" and (
        not body.base_url.startswith(("https://", "http://")) or not body.model.strip()
    ):
        raise HTTPException(422, "请填写有效服务地址和模型名称")
    db.query(User).order_by(User.id).with_for_update().first()
    config = get_asr_config_record(db)
    if not config:
        config = SystemConfig()
        db.add(config)
    config.asr_provider, config.asr_base_url, config.asr_model = (
        body.provider,
        body.base_url.strip(),
        body.model.strip(),
    )
    if body.api_key is not None:
        config.asr_api_key = body.api_key.strip()
    db.commit()
    return {"success": True}


@router.get("/{interview_id}")
def detail(
    interview_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(db, interview_id, user)
    return workflow.serialize(db, row, user)


@router.post("/{interview_id}/start")
def start(
    interview_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(db, interview_id, user, lock=True)
    workflow.start(db, row, user)
    return {"success": True}


@router.patch("/{interview_id}/questions")
def change_question(
    interview_id: UUID,
    body: QuestionChange,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(db, interview_id, user, lock=True)
    workflow.change_question(
        db, row, user, body.action, body.index, body.question, body.expected_revision
    )
    return workflow.serialize(db, row, user)


@router.put("/{interview_id}/question-review")
def question_review(
    interview_id: UUID,
    body: QuestionReview,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(db, interview_id, user, lock=True, member=True)
    workflow.save_question_review(
        db, row, user, body.index, body.score, body.comments, body.expected_revision
    )
    return {"success": True}


@router.post("/{interview_id}/take-over")
def take_over(
    interview_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(db, interview_id, user, lock=True)
    workflow.take_over(db, row, user)
    db.commit()
    return {"success": True}


@router.put("/{interview_id}/note")
def note(
    interview_id: UUID,
    body: Note,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(db, interview_id, user, lock=True, member=True)
    workflow.save_note(db, row, user, body.text, body.supplement)
    return {"success": True}


@router.post("/{interview_id}/recording/claim")
def claim(
    interview_id: UUID,
    body: RecordingSession,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(db, interview_id, user, lock=True, member=True)
    workflow.claim_recording(db, row, user, body.session_id)
    return {"success": True}


@router.post("/{interview_id}/recording/heartbeat")
def heartbeat(
    interview_id: UUID,
    body: RecordingSession,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(db, interview_id, user, lock=True, member=True)
    workflow.check_session(row, user, body.session_id)
    row.recording_heartbeat_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True}


@router.post("/{interview_id}/recording/release")
def release(
    interview_id: UUID,
    body: RecordingSession,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(db, interview_id, user, lock=True, member=True)
    workflow.release_recording(db, row, user, body.session_id)
    return {"success": True}


@router.post("/{interview_id}/recording/chunks")
async def chunk(
    interview_id: UUID,
    session_id: UUID,
    index: int = Query(ge=0),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    data = await file.read(20 * 1024 * 1024 + 1)
    row = workflow.interview_access(db, interview_id, user, lock=True, member=True)
    return workflow.append_chunk(
        db, row, user, session_id, index, data, file.content_type
    )


@router.post("/{interview_id}/end")
def end(
    interview_id: UUID,
    body: EndInterview,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(
        db,
        interview_id,
        user,
        lock=True,
        member=not (body.force and user.role == UserRole.ADMIN),
    )
    workflow.end(db, row, user, body.expected_chunks, body.force)
    return {"success": True}


@router.post("/{interview_id}/transcript")
async def import_transcript(
    interview_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    transcript = await parse_transcript_upload(file)
    row = workflow.interview_access(db, interview_id, user, lock=True)
    workflow.require_editable(row)
    if row.lifecycle_state != "ended":
        raise HTTPException(409, "结束面试后可以导入转写")
    row.transcript_data = transcript
    workflow.queue_analysis(db, row, "analysis")
    db.commit()
    return {"success": True, "warnings": transcript["warnings"]}


@router.post("/{interview_id}/analysis/retry")
def retry(
    interview_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(db, interview_id, user, lock=True)
    workflow.require_editable(row)
    if row.lifecycle_state != "ended" or not (
        row.transcript_data or row.recording_chunks
    ):
        raise HTTPException(409, "请先结束面试并录音或导入转写")
    if row.ai_analysis_status == "recording_incomplete" and not row.transcript_data:
        raise HTTPException(409, "请先导入完整转写后分析")
    if row.ai_analysis_status in {"queued", "analyzing", "transcribing", "retry_wait"}:
        raise HTTPException(409, "分析任务正在执行，请等待结果")
    workflow.queue_analysis(db, row, "analysis" if row.transcript_data else "asr")
    db.commit()
    return {"success": True}


@router.put("/{interview_id}/review")
def review(
    interview_id: UUID,
    body: Review,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(db, interview_id, user, lock=True, member=True)
    workflow.submit_review(
        db, row, user, body.scores, body.comments, body.recommendation
    )
    return {"success": True}


@router.post("/{interview_id}/decision")
def decision(
    interview_id: UUID,
    body: Decision,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(db, interview_id, user, lock=True)
    first_decision = row.final_decision_at is None
    workflow.decide(db, row, user, body.result, body.reason)
    if first_decision and body.result in {"hired", "rejected", "next_round"}:
        from app.services.interview_service import send_result_notification_background

        background_tasks.add_task(send_result_notification_background, row.id)
    return {"success": True}


@router.get("/{interview_id}/audio")
def audio(
    interview_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    row = workflow.interview_access(db, interview_id, user)
    if not row.recording_audio_path:
        raise HTTPException(404, "录音尚未合成")
    path = Path(row.recording_audio_path).resolve()
    if not path.is_relative_to(workflow.STORAGE) or not path.exists():
        raise HTTPException(404, "录音文件不存在")
    return FileResponse(
        path,
        media_type="audio/wav",
        filename="interview.wav",
        headers={"Cache-Control": "private, no-store"},
    )
