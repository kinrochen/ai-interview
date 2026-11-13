"""Evidence-based recruitment deadlines using China business days."""

from datetime import datetime, timedelta, timezone
from collections import defaultdict
from sqlalchemy.orm import selectinload
from chinese_calendar import is_workday

from app.models.models import (
    RecruitmentEvent,
    RecruitmentQualityPolicy,
    Resume,
    ResumeStatus,
    Position,
    Interview,
    Offer,
)
from app.services.recruitment_operations import COMPANY_TZ, utc

DEFAULT_RULES = {
    "screening": 2,
    "assign_review": 2,
    "hr_decision": 1,
    "schedule": 2,
    "human_review": 1,
    "final_decision": 1,
    "offer_send": 2,
    "onboarding": 1,
}
STAGES = {
    "pending_screening": ("screening", "简历初筛"),
    "pending_review": ("assign_review", "分配部门初评"),
    "pending_dept_review": ("waiting_review", "等待部门评价"),
    "pending_hr_decision": ("hr_decision", "HR 综合决策"),
    "auto_rejected_pending_review": ("hr_decision", "复核 AI 淘汰建议"),
    "pending_interview": ("schedule", "安排面试"),
    "interview_passed": ("offer_send", "准备并发送 Offer"),
    "offer_pending": ("offer_send", "发送 Offer"),
    "offer_accepted": ("onboarding", "确认实际入职"),
    "onboarding": ("onboarding", "确认实际入职"),
    "completed": ("completed", "已入职"),
    "departed": ("completed", "已离职"),
    "rejected": ("completed", "已淘汰"),
    "interview_failed": ("completed", "面试未通过"),
    "offer_rejected": ("completed", "Offer 已拒绝"),
    "waitlist": ("waiting", "备选跟进"),
}


def deadline(start, days):
    if not start:
        return None
    current = utc(start).astimezone(COMPANY_TZ)
    try:
        for _ in range(days):
            current += timedelta(days=1)
            while not is_workday(current.date()):
                current += timedelta(days=1)
    except NotImplementedError:
        return None
    return current.astimezone(timezone.utc)


def quality_context(db, resumes):
    ids = [resume.id for resume in resumes]
    events = defaultdict(list)
    for event in (
        db.query(RecruitmentEvent)
        .filter(RecruitmentEvent.resume_id.in_(ids))
        .order_by(RecruitmentEvent.occurred_at)
        .all()
    ):
        events[event.resume_id].append(event)
    interviews = {}
    for row in (
        db.query(Interview)
        .options(selectinload(Interview.panels))
        .filter(Interview.resume_id.in_(ids))
        .order_by(Interview.round.desc(), Interview.created_at.desc())
        .all()
    ):
        interviews.setdefault((row.resume_id, row.position_id), row)
    offers = {}
    for row in (
        db.query(Offer)
        .filter(Offer.resume_id.in_(ids))
        .order_by(Offer.created_at.desc())
        .all()
    ):
        offers.setdefault((row.resume_id, row.position_id), row)
    return {
        "events": events,
        "interviews": interviews,
        "offers": offers,
        "policies": db.query(RecruitmentQualityPolicy).all(),
    }


def policy(db, position_id=None, at=None, context=None):
    if context is not None:
        eligible = [
            row
            for row in context["policies"]
            if not at or utc(row.created_at) <= utc(at)
        ]
        global_policy = max(
            (p for p in eligible if p.position_id is None),
            key=lambda p: p.version,
            default=None,
        )
        override = max(
            (p for p in eligible if position_id and p.position_id == position_id),
            key=lambda p: p.version,
            default=None,
        )
        chosen = override or global_policy
        return {
            "rules": {**DEFAULT_RULES, **(chosen.rules if chosen else {})},
            "version": chosen.version if chosen else 0,
            "source": (
                "position" if override else "global" if global_policy else "default"
            ),
        }
    query = db.query(RecruitmentQualityPolicy)
    if at:
        query = query.filter(RecruitmentQualityPolicy.created_at <= utc(at))
    global_policy = (
        query.filter(RecruitmentQualityPolicy.position_id.is_(None))
        .order_by(RecruitmentQualityPolicy.version.desc())
        .first()
    )
    override = (
        query.filter_by(position_id=position_id)
        .order_by(RecruitmentQualityPolicy.version.desc())
        .first()
        if position_id
        else None
    )
    chosen = override or global_policy
    return {
        "rules": {**DEFAULT_RULES, **(chosen.rules if chosen else {})},
        "version": chosen.version if chosen else 0,
        "source": "position" if override else "global" if global_policy else "default",
    }


def candidate_flow(db, resume, position, now=None, context=None):
    now = now or datetime.now(timezone.utc)
    if context is not None:
        events = [
            e
            for e in context["events"][resume.id]
            if e.position_id == position.id
            and e.cycle == (resume.recruitment_cycle or 1)
        ]
    else:
        events = (
            db.query(RecruitmentEvent)
            .filter_by(
                resume_id=resume.id,
                position_id=position.id,
                cycle=resume.recruitment_cycle or 1,
            )
            .order_by(RecruitmentEvent.occurred_at)
            .all()
        )
    stage, label = STAGES.get(resume.status.value, ("waiting", "等待跟进"))
    start, owner, link = None, position.hiring_manager_id, f"/resumes/{resume.id}"
    changes = [
        e for e in events if e.subject_type == "resumes" and "status" in e.details
    ]
    current = next(
        (
            e
            for e in reversed(changes)
            if e.details["status"]["new"] == resume.status.value
        ),
        None,
    )
    if current:
        start = current.occurred_at
    elif resume.status == ResumeStatus.PENDING_SCREENING:
        start = resume.flow_started_at
    if context is not None:
        interview = context["interviews"].get((resume.id, position.id))
        offer = context["offers"].get((resume.id, position.id))
    else:
        interview = (
            db.query(Interview)
            .filter_by(resume_id=resume.id, position_id=position.id)
            .order_by(Interview.round.desc(), Interview.created_at.desc())
            .first()
        )
        offer = (
            db.query(Offer)
            .filter_by(resume_id=resume.id, position_id=position.id)
            .order_by(Offer.created_at.desc())
            .first()
        )
    if (
        stage == "schedule"
        and interview
        and utc(interview.created_at)
        >= utc(resume.flow_started_at or resume.created_at)
    ):
        link = "/interviews"
        if (
            interview.lifecycle_state == "ended"
            and not interview.final_decision_at
            and not interview.legacy_completed
        ):
            link = f"/interviews/{interview.id}/score"
            members = {str(m) for m in (interview.panel_members or [])} | {
                str(p.interviewer_id) for p in interview.panels
            }
            if interview.interviewer_id:
                members.add(str(interview.interviewer_id))
            pending = [
                m
                for m in members
                if not any(
                    str(p.interviewer_id) == m and p.human_review_submitted_at
                    for p in interview.panels
                )
            ]
            if pending:
                stage, label, start = (
                    "human_review",
                    "提交面试人工评价",
                    interview.ended_at,
                )
                owner = pending[0] if len(pending) == 1 else None
            else:
                stage, label = "final_decision", "面试最终决策"
                start = max(
                    (
                        p.human_review_submitted_at
                        for p in interview.panels
                        if p.human_review_submitted_at
                    ),
                    default=interview.ended_at,
                )
        elif interview.status.value in {"scheduled", "in_progress"}:
            link = f"/interviews/{interview.id}/score"
            stage, label, start = (
                "waiting_interview",
                "等待已安排的面试",
                interview.interview_time,
            )
            if start and utc(start) < now and interview.status.value == "scheduled":
                stage, label = "schedule", "确认面试进展"
    if stage == "offer_send" and offer:
        link = "/offers"
        if offer.status.value == "sent":
            stage, label, start = "waiting_offer", "等待候选人答复", offer.sent_at
        elif offer.status.value == "accepted":
            stage, label = "onboarding", "确认实际入职"
            start = offer.onboard_date
    if stage == "onboarding" and offer:
        link, start = "/offers", offer.onboard_date
    rules = policy(db, position.id, start, context)["rules"]
    due = deadline(start, rules[stage]) if stage in rules else None
    state = (
        "completed"
        if stage == "completed"
        else (
            "waiting"
            if stage not in rules
            else "unknown" if due is None else "overdue" if due < now else "on_track"
        )
    )
    history = []
    for index, event in enumerate(changes):
        status = event.details["status"]["new"]
        key, title = STAGES.get(status, ("waiting", status))
        end = changes[index + 1].occurred_at if index + 1 < len(changes) else None
        phase_rules = policy(db, position.id, event.occurred_at, context)["rules"]
        due_at = deadline(event.occurred_at, phase_rules[key]) if key in rules else None
        history.append(
            {
                "label": title,
                "started_at": event.occurred_at,
                "completed_at": end,
                "due_at": due_at,
                "on_time": utc(end) <= due_at if end and due_at else None,
            }
        )
    return {
        "id": str(resume.id),
        "candidate_name": resume.candidate_name,
        "position_id": str(position.id),
        "position_title": position.title,
        "cycle": resume.recruitment_cycle or 1,
        "status": resume.status.value,
        "stage": stage,
        "stage_label": label,
        "state": state,
        "started_at": start,
        "due_at": due,
        "owner_id": str(owner) if owner else None,
        "owner_ids": (
            pending if stage == "human_review" else [str(owner)] if owner else []
        ),
        "link": link,
        "history": history,
        "evidence": [
            {
                "id": str(e.id),
                "type": e.event_type,
                "subject": e.subject_type,
                "at": e.occurred_at,
                "actor_id": str(e.actor_id) if e.actor_id else None,
                "details": e.details,
            }
            for e in events
        ],
    }
