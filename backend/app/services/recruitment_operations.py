"""Single-company position lifecycle, HC allocation and onboarding."""

from datetime import date, datetime, time, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func

from app.models.models import (
    Interview,
    InterviewPanel,
    InterviewStatus,
    DepartmentReview,
    Offer,
    OfferStatus,
    Position,
    PositionStatus,
    RecruitmentSlot,
    RecruitmentEvent,
    Resume,
    ResumeStatus,
    UserRole,
)

COMPANY_TZ = timezone(timedelta(hours=8))


def utc(value):
    return (
        value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value
    )


def require_manager(position, user):
    if user.role == UserRole.ADMIN:
        return
    if user.role != UserRole.HR or (
        position.hiring_manager_id and position.hiring_manager_id != user.id
    ):
        raise HTTPException(403, "需要岗位招聘负责人或管理员权限")


def locked_position(db, position_id, user, *, include_deleted=False):
    row = (
        db.query(Position).filter(Position.id == position_id).with_for_update().first()
    )
    if not row or (row.deleted_at and not include_deleted):
        raise HTTPException(404, "岗位不存在")
    require_manager(row, user)
    return row


def sync_slots(db, position):
    cycle = position.recruitment_cycle or 1
    slots = (
        db.query(RecruitmentSlot)
        .filter_by(position_id=position.id, cycle=cycle)
        .order_by(RecruitmentSlot.number)
        .all()
    )
    active = [slot for slot in slots if slot.status in {"active", "occupied"}]
    desired = position.headcount or 1
    if desired < len([slot for slot in active if slot.status == "occupied"]):
        raise HTTPException(409, "招聘人数不能少于本轮已入职占用的名额")
    for slot in reversed([slot for slot in active if slot.status == "active"]):
        if len(active) <= desired:
            break
        slot.status = "cancelled"
        active.remove(slot)
    next_number = max((slot.number for slot in slots), default=0) + 1
    for offset in range(max(0, desired - len(active))):
        slot = RecruitmentSlot(
            id=uuid4(),
            position_id=position.id,
            cycle=cycle,
            number=next_number + offset,
            status="active",
        )
        db.add(slot)
        slots.append(slot)
    db.flush()
    return slots


def record_event(db, position, user, event_type, details, *, resume_id=None):
    db.add(
        RecruitmentEvent(
            position_id=position.id,
            resume_id=resume_id,
            subject_type="positions",
            subject_id=position.id,
            event_type=event_type,
            cycle=position.recruitment_cycle or 1,
            actor_id=user.id,
            occurred_at=datetime.now(timezone.utc),
            details=details,
        )
    )


def change_position(db, position_id, user, action, reason, new_cycle=False):
    position = locked_position(
        db, position_id, user, include_deleted=action == "restore"
    )
    reason = (reason or "").strip()
    if action in {"pause", "cancel", "reopen", "archive", "restore"} and not reason:
        raise HTTPException(422, "请填写本次操作原因")
    previous = position.status.value
    transitions = {
        "pause": ({PositionStatus.PUBLISHED}, PositionStatus.PAUSED),
        "resume": ({PositionStatus.PAUSED}, PositionStatus.PUBLISHED),
        "close": (
            {PositionStatus.OPEN, PositionStatus.PUBLISHED, PositionStatus.PAUSED},
            PositionStatus.CLOSED,
        ),
        "cancel": (
            {PositionStatus.OPEN, PositionStatus.PUBLISHED, PositionStatus.PAUSED},
            PositionStatus.CANCELLED,
        ),
    }
    if action in transitions:
        allowed, target = transitions[action]
        if position.status not in allowed:
            raise HTTPException(409, "岗位当前状态已改变，请刷新后重试")
        position.status = target
    elif action in {"reopen", "restore"}:
        if user.role != UserRole.ADMIN:
            raise HTTPException(403, "管理员可以恢复或重开岗位")
        if action == "reopen" and position.status not in {
            PositionStatus.CLOSED,
            PositionStatus.CANCELLED,
        }:
            raise HTTPException(409, "当前岗位无需重开")
        if action == "restore" and not position.deleted_at:
            raise HTTPException(409, "当前岗位无需恢复")
        position.deleted_at = None
        position.status = PositionStatus.OPEN
        if new_cycle:
            position.recruitment_cycle = (position.recruitment_cycle or 1) + 1
            position.cycle_started_at = datetime.now(timezone.utc)
            sync_slots(db, position)
    elif action == "archive":
        position.deleted_at = datetime.now(timezone.utc)
    else:
        raise HTTPException(422, "未知岗位操作")
    record_event(
        db,
        position,
        user,
        f"position_{action}",
        {
            "old": previous,
            "new": position.status.value,
            "reason": reason,
            "new_cycle": new_cycle,
        },
    )
    db.commit()
    return {
        "id": str(position.id),
        "status": position.status.value,
        "cycle": position.recruitment_cycle,
    }


def position_progress(db, position):
    slots = (
        db.query(RecruitmentSlot)
        .filter_by(position_id=position.id, cycle=position.recruitment_cycle or 1)
        .order_by(RecruitmentSlot.number)
        .all()
    )
    names = {
        r.id: r.candidate_name
        for r in db.query(Resume)
        .filter(Resume.id.in_([s.resume_id for s in slots if s.resume_id]))
        .all()
    }
    occupied = sum(slot.status == "occupied" for slot in slots)
    return {
        "position_id": str(position.id),
        "cycle": position.recruitment_cycle or 1,
        "target": position.headcount or 1,
        "occupied": occupied,
        "available": max(0, (position.headcount or 1) - occupied),
        "employed": sum(
            slot.status == "occupied" and slot.departed_at is None for slot in slots
        ),
        "cumulative_onboarded": sum(slot.onboarded_at is not None for slot in slots),
        "slots": [
            {
                "id": str(s.id),
                "number": s.number,
                "status": s.status,
                "candidate_name": names.get(s.resume_id),
                "onboarded_at": s.onboarded_at,
                "departed_at": s.departed_at,
            }
            for s in slots
        ],
    }


def confirm_onboarding(db, offer_id, user, actual_date):
    offer = db.query(Offer).filter_by(id=offer_id).first()
    if not offer:
        raise HTTPException(404, "Offer 不存在")
    position = locked_position(db, offer.position_id, user)
    db.refresh(offer)
    if offer.actual_onboarded_at:
        if utc(offer.actual_onboarded_at).astimezone(COMPANY_TZ).date() != actual_date:
            raise HTTPException(409, "已登记入职，请核对原记录")
        return {"success": True, "progress": position_progress(db, position)}
    if offer.status != OfferStatus.ACCEPTED:
        raise HTTPException(409, "已接受的 Offer 可以确认实际入职")
    if actual_date > datetime.now(COMPANY_TZ).date():
        raise HTTPException(422, "实际入职日期不能晚于今天")
    if (
        offer.accepted_at
        and actual_date < utc(offer.accepted_at).astimezone(COMPANY_TZ).date()
    ):
        raise HTTPException(422, "实际入职日期不能早于 Offer 接受日期")
    resume = db.get(Resume, offer.resume_id)
    if (
        not resume
        or resume.position_id != position.id
        or (resume.recruitment_cycle or 1) != (position.recruitment_cycle or 1)
    ):
        raise HTTPException(409, "候选人与当前岗位招聘轮次不一致")
    slots = sync_slots(db, position)
    if any(slot.resume_id == resume.id for slot in slots):
        raise HTTPException(409, "候选人已占用本轮招聘名额")
    slot = next((slot for slot in slots if slot.status == "active"), None)
    if slot is None:
        raise HTTPException(409, "本轮招聘名额已满")
    now = datetime.now(timezone.utc)
    offer.actual_onboarded_at = datetime.combine(
        actual_date, time.min, COMPANY_TZ
    ).astimezone(timezone.utc)
    offer.onboarding_recorded_at = now
    offer.onboarding_confirmed_by = user.id
    slot.status, slot.resume_id, slot.offer_id = "occupied", resume.id, offer.id
    slot.onboarded_at = offer.actual_onboarded_at
    resume.status = ResumeStatus.COMPLETED
    if sum(s.status == "occupied" for s in slots) >= (position.headcount or 1):
        position.status = PositionStatus.CLOSED
        record_event(
            db, position, user, "position_filled", {"reason": "本轮名额全部确认入职"}
        )
    db.commit()
    return {"success": True, "progress": position_progress(db, position)}


def record_departure(db, offer_id, user, actual_date, reason, release_hc):
    offer = db.query(Offer).filter_by(id=offer_id).first()
    if not offer:
        raise HTTPException(404, "Offer 不存在")
    position = locked_position(db, offer.position_id, user, include_deleted=True)
    db.refresh(offer)
    if offer.departed_at:
        raise HTTPException(409, "已登记离职，请刷新查看")
    if not offer.actual_onboarded_at:
        raise HTTPException(409, "确认实际入职后可以登记离职")
    if (
        not reason.strip()
        or actual_date > datetime.now(COMPANY_TZ).date()
        or actual_date < utc(offer.actual_onboarded_at).astimezone(COMPANY_TZ).date()
    ):
        raise HTTPException(422, "请核对离职日期并填写原因")
    slot = (
        db.query(RecruitmentSlot)
        .filter_by(offer_id=offer.id, status="occupied")
        .first()
    )
    if not slot:
        raise HTTPException(409, "入职名额记录不存在")
    now = datetime.combine(actual_date, time.min, COMPANY_TZ).astimezone(timezone.utc)
    offer.departed_at, offer.departure_reason, offer.departure_released_hc = (
        now,
        reason.strip(),
        release_hc,
    )
    offer.status = OfferStatus.DEPARTED
    slot.departed_at = now
    if release_hc:
        slot.status = "historical"
        if slot.cycle == (position.recruitment_cycle or 1):
            sync_slots(db, position)
    resume = db.get(Resume, offer.resume_id)
    if resume and resume.position_id == offer.position_id:
        resume.status = ResumeStatus.DEPARTED
    record_event(
        db,
        position,
        user,
        "departure",
        {"offer_id": str(offer.id), "reason": reason, "release_hc": release_hc},
        resume_id=offer.resume_id,
    )
    db.commit()
    return {"success": True, "progress": position_progress(db, position)}
