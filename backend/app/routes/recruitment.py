"""Single-company workbench, calendar, lifecycle, HC and process quality APIs."""

from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, StrictInt
from sqlalchemy.orm import Session

from app.config.database import get_db
from app.core.security import get_current_user_dep
from app.models.models import (
    DepartmentReview,
    Interview,
    InterviewPanel,
    InterviewStatus,
    Position,
    RecruitmentEvent,
    RecruitmentQualityPolicy,
    Resume,
    User,
    UserRole,
)
from app.services import recruitment_operations as ops
from app.services.interview_workflow import visible_query, assigned_ids
from app.services.recruitment_quality import (
    DEFAULT_RULES,
    candidate_flow,
    policy,
    quality_context,
)

router = APIRouter(prefix="/recruitment", tags=["recruitment"])


def managers(user):
    if user.role not in {UserRole.ADMIN, UserRole.HR}:
        raise HTTPException(403, "需要 HR 或管理员权限")


class PositionAction(BaseModel):
    action: Literal[
        "pause", "resume", "close", "cancel", "reopen", "archive", "restore"
    ]
    reason: str = Field(default="", max_length=2000)
    new_cycle: bool = False


class Onboarding(BaseModel):
    actual_date: date


class Departure(Onboarding):
    reason: str = Field(min_length=1, max_length=2000)
    release_hc: bool = True


class QualityRules(BaseModel):
    rules: dict[str, StrictInt]
    position_id: UUID | None = None


class Followup(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.post("/positions/{position_id}/action")
def position_action(
    position_id: UUID,
    body: PositionAction,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    return ops.change_position(
        db, position_id, user, body.action, body.reason, body.new_cycle
    )


@router.get("/positions/{position_id}/hc")
def progress(
    position_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    managers(user)
    position = db.get(Position, position_id)
    if not position:
        raise HTTPException(404, "岗位不存在")
    history = (
        db.query(RecruitmentEvent)
        .filter_by(position_id=position_id, resume_id=None)
        .order_by(RecruitmentEvent.occurred_at.desc())
        .limit(100)
        .all()
    )
    return {
        **ops.position_progress(db, position),
        "archived": bool(position.deleted_at),
        "history": [
            {"at": e.occurred_at, "type": e.event_type, "details": e.details}
            for e in history
        ],
    }


@router.post("/offers/{offer_id}/onboarding")
def onboard(
    offer_id: UUID,
    body: Onboarding,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    return ops.confirm_onboarding(db, offer_id, user, body.actual_date)


@router.post("/offers/{offer_id}/departure")
def depart(
    offer_id: UUID,
    body: Departure,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    return ops.record_departure(
        db, offer_id, user, body.actual_date, body.reason, body.release_hc
    )


@router.get("/archived-positions")
def archived(db: Session = Depends(get_db), user: User = Depends(get_current_user_dep)):
    if user.role != UserRole.ADMIN:
        raise HTTPException(403, "需要管理员权限")
    rows = (
        db.query(Position)
        .filter(Position.deleted_at.is_not(None))
        .order_by(Position.deleted_at.desc())
        .all()
    )
    return [
        {
            "id": str(p.id),
            "title": p.title,
            "archived_at": p.deleted_at,
            "cycle": p.recruitment_cycle,
        }
        for p in rows
    ]


@router.get("/calendar")
def calendar(
    start: datetime,
    end: datetime,
    mine: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    start, end = ops.utc(start), ops.utc(end)
    if end <= start or end - start > timedelta(days=62):
        raise HTTPException(422, "请选择 62 天以内的有效日期范围")
    query = visible_query(db, user).filter(
        Interview.interview_time < end,
        (
            (Interview.interview_end_time.is_not(None))
            & (Interview.interview_end_time > start)
        )
        | (
            (Interview.interview_end_time.is_(None))
            & (Interview.interview_time >= start - timedelta(hours=1))
        ),
    )
    rows = query.order_by(Interview.interview_time).all()
    if mine:
        rows = [r for r in rows if str(user.id) in assigned_ids(r)]
    return [
        {
            "id": str(r.id),
            "candidate_name": r.resume.candidate_name if r.resume else "候选人",
            "position_title": r.position.title if r.position else "",
            "start": r.interview_time,
            "end": r.interview_end_time
            or ops.utc(r.interview_time) + timedelta(hours=1),
            "estimated_end": r.interview_end_time is None,
            "status": r.status.value,
            "state": r.lifecycle_state,
            "round": r.round,
            "location": r.interview_location,
            "type": r.interview_type,
        }
        for r in rows
    ]


@router.get("/workbench")
def workbench(
    db: Session = Depends(get_db), user: User = Depends(get_current_user_dep)
):
    now = datetime.now(timezone.utc)
    assigned = visible_query(db, user).order_by(Interview.interview_time).all()
    assigned = [r for r in assigned if str(user.id) in assigned_ids(r)]
    upcoming = [
        r
        for r in assigned
        if r.status == InterviewStatus.SCHEDULED
        and r.interview_time
        and ops.utc(r.interview_time) >= now
    ]
    pending = [
        r
        for r in assigned
        if r.lifecycle_state == "ended"
        and not r.final_decision_at
        and not r.legacy_completed
        and not any(
            p.interviewer_id == user.id and p.human_review_submitted_at
            for p in r.panels
        )
    ]
    in_progress = [r for r in assigned if r.lifecycle_state == "in_progress"]
    reviews = (
        db.query(DepartmentReview)
        .filter_by(reviewer_id=user.id, is_completed=False)
        .order_by(DepartmentReview.created_at)
        .all()
    )

    def item(row):
        return {
            "id": str(row.id),
            "candidate_name": row.resume.candidate_name if row.resume else "候选人",
            "position_title": row.position.title if row.position else "",
            "time": row.interview_time,
            "round": row.round,
        }

    return {
        "counts": {
            "upcoming": len(upcoming),
            "in_progress": len(in_progress),
            "pending_reviews": len(pending),
            "department_reviews": len(reviews),
        },
        "upcoming": [item(r) for r in upcoming[:10]],
        "in_progress": [item(r) for r in in_progress],
        "pending_reviews": [item(r) for r in pending],
        "department_reviews": [
            {
                "id": str(r.id),
                "resume_id": str(r.resume_id),
                "candidate_name": r.resume.candidate_name if r.resume else "候选人",
                "assigned_at": ops.utc(r.created_at),
            }
            for r in reviews
        ],
    }


@router.get("/quality/policy")
def get_policy(
    position_id: UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    managers(user)
    return policy(db, position_id)


@router.put("/quality/policy")
def set_policy(
    body: QualityRules,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    if body.position_id:
        ops.locked_position(db, body.position_id, user)
    elif user.role != UserRole.ADMIN:
        raise HTTPException(403, "管理员可以配置全局时限")
    if set(body.rules) != set(DEFAULT_RULES) or any(
        isinstance(v, bool) or not 1 <= v <= 60 for v in body.rules.values()
    ):
        raise HTTPException(422, "请填写全部阶段的 1–60 个工作日时限")
    # Serialize policy versions with the owning row, or the administrator for globals.
    db.query(User).order_by(User.id).with_for_update().first()
    previous = (
        db.query(RecruitmentQualityPolicy)
        .filter_by(position_id=body.position_id)
        .order_by(RecruitmentQualityPolicy.version.desc())
        .first()
    )
    version = (previous.version if previous else 0) + 1
    db.add(
        RecruitmentQualityPolicy(
            position_id=body.position_id,
            version=version,
            rules=body.rules,
            created_by=user.id,
            created_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    return policy(db, body.position_id)


@router.get("/quality/options")
def quality_options(
    db: Session = Depends(get_db), user: User = Depends(get_current_user_dep)
):
    managers(user)
    return {
        "positions": [
            {"value": str(p.id), "label": p.title}
            for p in db.query(Position)
            .filter(Position.deleted_at.is_(None))
            .order_by(Position.title)
            .all()
        ],
        "owners": [
            {"value": str(u.id), "label": u.full_name or u.email}
            for u in db.query(User)
            .filter_by(is_active=True)
            .order_by(User.full_name)
            .all()
        ],
    }


@router.get("/quality")
def quality(
    q: str = "",
    state: str = "",
    mine: bool = False,
    position_id: UUID | None = None,
    owner_id: UUID | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    managers(user)
    query = (
        db.query(Resume, Position)
        .join(Position, Resume.position_id == Position.id)
        .filter(
            Position.deleted_at.is_(None),
            Resume.recruitment_cycle == Position.recruitment_cycle,
        )
    )
    if q.strip():
        query = query.filter(Resume.candidate_name.ilike(f"%{q.strip()}%"))
    if position_id:
        query = query.filter(Position.id == position_id)
    if from_date and to_date and to_date < from_date:
        raise HTTPException(422, "结束日期需要晚于或等于开始日期")
    if from_date:
        query = query.filter(
            Resume.created_at
            >= datetime.combine(from_date, time.min, ops.COMPANY_TZ).astimezone(
                timezone.utc
            )
        )
    if to_date:
        query = query.filter(
            Resume.created_at
            < datetime.combine(
                to_date + timedelta(days=1), time.min, ops.COMPANY_TZ
            ).astimezone(timezone.utc)
        )
    candidates = query.order_by(Resume.created_at.desc()).all()
    context = quality_context(db, [r for r, _ in candidates])
    rows = [candidate_flow(db, r, p, context=context) for r, p in candidates]
    if mine:
        rows = [r for r in rows if str(user.id) in r["owner_ids"]]
    if owner_id:
        rows = [r for r in rows if str(owner_id) in r["owner_ids"]]
    counts = {
        key: sum(row["state"] == key for row in rows)
        for key in ["on_track", "overdue", "unknown", "waiting", "completed"]
    }
    phases = [h for row in rows for h in row["history"] if h["on_time"] is not None]
    if state:
        rows = [r for r in rows if r["state"] == state]
    names = {str(u.id): u.full_name or u.email for u in db.query(User).all()}
    for row in rows:
        row["owner_name"] = (
            "、".join(names.get(owner, "面试官") for owner in row["owner_ids"])
            or "待明确负责人"
        )
    return {
        "items": rows[(page - 1) * page_size : page * page_size],
        "total": len(rows),
        "counts": counts,
        "eligible_phases": len(phases),
        "on_time_phases": sum(h["on_time"] for h in phases),
    }


@router.post("/quality/{resume_id}/followups")
def followup(
    resume_id: UUID,
    body: Followup,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_dep),
):
    resume = db.get(Resume, resume_id)
    if not resume:
        raise HTTPException(404, "简历不存在")
    position = ops.locked_position(db, resume.position_id, user)
    ops.record_event(
        db, position, user, "followup", {"text": body.text.strip()}, resume_id=resume.id
    )
    db.commit()
    return {"success": True}
