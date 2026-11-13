"""Transactional change history shared by recruiting operations and quality reports."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.models.models import (
    DepartmentReview,
    Interview,
    InterviewPanel,
    Offer,
    Position,
    RecruitmentEvent,
    Resume,
)

TRACKED_FIELDS = {
    Position: (
        "status",
        "headcount",
        "hiring_manager_id",
        "deleted_at",
        "recruitment_cycle",
    ),
    Resume: ("status", "position_id", "screening_result", "hr_review"),
    DepartmentReview: ("is_completed", "recommendation"),
    Interview: (
        "status",
        "interview_time",
        "interview_end_time",
        "lifecycle_state",
        "final_decision_at",
        "result",
        "analysis_revision",
    ),
    InterviewPanel: (
        "is_submitted",
        "human_review_submitted_at",
        "human_review_updated_at",
    ),
    Offer: (
        "status",
        "sent_at",
        "accepted_at",
        "actual_onboarded_at",
        "departed_at",
        "onboard_date",
        "valid_until",
    ),
}


def value(item):
    if item is None or isinstance(item, (int, float, bool)):
        return item
    return getattr(item, "value", str(item))


@event.listens_for(Session, "before_flush")
def capture_business_changes(session, _context, _instances):
    now = datetime.now(timezone.utc)
    for record in list(session.new) + list(session.dirty):
        fields = TRACKED_FIELDS.get(type(record))
        if not fields:
            continue
        state = inspect(record)
        changes = {}
        for field in fields:
            history = state.attrs[field].history
            if history.has_changes():
                changes[field] = {
                    "old": value(history.deleted[0]) if history.deleted else None,
                    "new": value(getattr(record, field)),
                }
        if not changes and record not in session.new:
            continue
        if record.id is None:
            record.id = uuid4()
        position_id = (
            record.id
            if isinstance(record, Position)
            else getattr(record, "position_id", None)
        )
        resume_id = (
            record.id
            if isinstance(record, Resume)
            else getattr(record, "resume_id", None)
        )
        if isinstance(record, DepartmentReview):
            resume = session.get(Resume, record.resume_id)
            position_id = resume.position_id if resume else None
        if isinstance(record, InterviewPanel):
            interview = session.get(Interview, record.interview_id)
            if interview:
                position_id, resume_id = interview.position_id, interview.resume_id
        position = (
            record
            if isinstance(record, Position)
            else session.get(Position, position_id) if position_id else None
        )
        cycle = (position.recruitment_cycle or 1) if position else 1
        if isinstance(record, Resume):
            moved = (
                "position_id" in changes and changes["position_id"]["old"] is not None
            )
            restored = changes.get("status", {}).get("old") in {
                "rejected",
                "interview_failed",
                "offer_rejected",
                "completed",
                "departed",
                "waitlist",
            } and changes.get("status", {}).get("new") in {
                "pending_screening",
                "pending_review",
            }
            if record in session.new or moved or restored:
                record.recruitment_cycle = cycle
                record.flow_started_at = now
        session.info.setdefault("recruitment_events", []).append(
            RecruitmentEvent(
                position_id=position_id,
                resume_id=resume_id,
                subject_type=record.__tablename__,
                subject_id=record.id,
                event_type="created" if record in session.new else "updated",
                cycle=cycle,
                actor_id=session.info.get("actor_id"),
                occurred_at=now,
                details=changes,
            )
        )


@event.listens_for(Session, "after_flush_postexec")
def persist_business_changes(session, _context):
    # Referenced business rows now exist. The subsequent flush remains in the same transaction.
    session.add_all(session.info.pop("recruitment_events", []))


@event.listens_for(Session, "after_rollback")
def discard_rolled_back_changes(session):
    session.info.pop("recruitment_events", None)
