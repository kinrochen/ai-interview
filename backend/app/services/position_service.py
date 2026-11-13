from sqlalchemy.orm import Session, joinedload
from datetime import datetime, timezone
from app.services.recruitment_operations import sync_slots
from sqlalchemy import func
from app.models.models import Position, Resume, ResumeStatus, QuestionBank, User
from app.schemas.position import PositionCreate, PositionUpdate, PositionStats, PositionWithStats, QuestionBankBrief, PositionPage
from uuid import UUID
from typing import List
from app.services.ai_service import generate_jd
from fastapi import HTTPException

def create_position(db: Session, position: PositionCreate):
    # 验证外键 hiring_manager_id 是否存在
    if position.hiring_manager_id:
        hiring_manager = db.query(User).filter(User.id == position.hiring_manager_id).first()
        if not hiring_manager:
            raise HTTPException(
                status_code=400,
                detail=f"招聘经理 (hiring_manager_id: {position.hiring_manager_id}) 不存在"
            )

    db_position = Position(**position.model_dump())
    db.add(db_position)
    db.flush()
    db_position.cycle_started_at = datetime.now(timezone.utc)
    sync_slots(db, db_position)
    db.commit()
    db.refresh(db_position)
    return db_position

def get_positions(db: Session, skip: int = 0, limit: int = 100, status: str = None, title: str = None):
    query = db.query(Position).filter(Position.deleted_at.is_(None))
    if status:
        query = query.filter(Position.status == status)
    if title:
        query = query.filter(Position.title.ilike(f"%{title}%"))
    return query.order_by(Position.created_at.desc()).offset(skip).limit(limit).all()

def _positions_query(db: Session, status: str = None, title: str = None):
    query = db.query(Position).filter(Position.deleted_at.is_(None))
    if status:
        query = query.filter(Position.status == status)
    if title:
        query = query.filter(Position.title.ilike(f"%{title}%"))
    return query


def get_positions_page(db: Session, skip: int = 0, limit: int = 10, status: str = None, title: str = None) -> PositionPage:
    total = _positions_query(db, status, title).count()
    return PositionPage(items=get_positions_with_stats(db, skip, limit, status, title), total=total)


def get_positions_with_stats(db: Session, skip: int = 0, limit: int = 100, status: str = None, title: str = None) -> List[PositionWithStats]:
    positions = (_positions_query(db, status, title).options(joinedload(Position.hiring_manager))
                 .order_by(Position.created_at.desc(), Position.id.desc()).offset(skip).limit(limit).all())
    stats = _get_stats_for_positions(db, [pos.id for pos in positions])
    return [PositionWithStats(
        **{column.name: getattr(pos, column.name) for column in pos.__table__.columns},
        stats=stats[pos.id],
        hiring_manager_name=pos.hiring_manager.full_name if pos.hiring_manager else None,
    ) for pos in positions]


def get_position(db: Session, position_id: UUID):
    return db.query(Position).filter(Position.id == position_id, Position.deleted_at.is_(None)).first()

def _get_stats_for_positions(db: Session, position_ids: list) -> dict:
    if not position_ids:
        return {}
    counts = {position_id: {} for position_id in position_ids}
    rows = (db.query(Resume.position_id, Resume.status, func.count(Resume.id))
            .join(Position, Position.id == Resume.position_id)
            .filter(Resume.position_id.in_(position_ids), Resume.recruitment_cycle == Position.recruitment_cycle)
            .group_by(Resume.position_id, Resume.status).all())
    for position_id, resume_status, count in rows:
        counts[position_id][resume_status] = count
    return {position_id: _stats_from_counts(values) for position_id, values in counts.items()}


def get_position_stats(db: Session, position_id: UUID) -> PositionStats:
    return _get_stats_for_positions(db, [position_id])[position_id]


def _stats_from_counts(counts: dict) -> PositionStats:
    def count_statuses(statuses):
        return sum(counts.get(status, 0) for status in statuses)

    return PositionStats(
        total_resumes=sum(counts.values()),
        pending_screening=count_statuses([
            ResumeStatus.PENDING_SCREENING, 
            ResumeStatus.PENDING_REVIEW,
            ResumeStatus.PENDING_DEPT_REVIEW,
            ResumeStatus.PENDING_HR_DECISION,
            ResumeStatus.AUTO_REJECTED_PENDING_REVIEW,
        ]),
        pending_interview=counts.get(ResumeStatus.PENDING_INTERVIEW, 0),
        interview_completed=count_statuses([
            ResumeStatus.INTERVIEW_PASSED, 
            ResumeStatus.INTERVIEW_FAILED,
            ResumeStatus.OFFER_PENDING,
            ResumeStatus.OFFER_ACCEPTED,
            ResumeStatus.OFFER_REJECTED,
            ResumeStatus.ONBOARDING,
            ResumeStatus.COMPLETED
        ]),
        offer_pending=counts.get(ResumeStatus.OFFER_PENDING, 0),
        offer_accepted=count_statuses([
            ResumeStatus.OFFER_ACCEPTED,
            ResumeStatus.ONBOARDING,
            ResumeStatus.COMPLETED
        ]),
        rejected=count_statuses([
            ResumeStatus.REJECTED,
            ResumeStatus.INTERVIEW_FAILED,
            ResumeStatus.OFFER_REJECTED
        ])
    )

def get_linked_question_banks(db: Session, position_id: UUID) -> List[QuestionBankBrief]:
    banks = db.query(QuestionBank).filter(QuestionBank.position_id == position_id).all()
    result = []
    for bank in banks:
        question_count = len(bank.questions) if bank.questions else 0
        result.append(QuestionBankBrief(
            id=bank.id,
            name=bank.name,
            category=bank.category.value if bank.category else "other",
            question_count=question_count
        ))
    return result

def update_position(db: Session, position_id: UUID, position: PositionUpdate):
    db_position = db.query(Position).filter(Position.id == position_id, Position.deleted_at.is_(None)).with_for_update().first()
    if not db_position:
        return None
    
    update_data = position.model_dump(exclude_unset=True)
    manager_id = update_data.get("hiring_manager_id")
    if manager_id and not db.query(User).filter(User.id == manager_id).first():
        raise HTTPException(status_code=400, detail="招聘负责人不存在，请重新选择")
    for key, value in update_data.items():
        setattr(db_position, key, value)
    sync_slots(db, db_position)
    db.commit()
    db.refresh(db_position)
    return db_position

def delete_position(db: Session, position_id: UUID):
    db_position = db.query(Position).filter(Position.id == position_id, Position.deleted_at.is_(None)).with_for_update().first()
    if not db_position:
        return None

    # 检查是否有关联的简历
    related_resumes = db.query(Resume).filter(Resume.position_id == position_id).count()
    if related_resumes > 0:
        raise HTTPException(
            status_code=400,
            detail=f"无法删除该岗位，存在 {related_resumes} 份关联简历"
        )

    # 检查是否有关联的题库
    related_banks = db.query(QuestionBank).filter(QuestionBank.position_id == position_id).count()
    if related_banks > 0:
        raise HTTPException(
            status_code=400,
            detail=f"无法删除该岗位，存在 {related_banks} 个关联题库"
        )

    db_position.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return db_position

def generate_position_jd(title: str, department: str = None, location: str = None, salary_range: str = None, keywords: str = None, **context) -> dict:
    return generate_jd(
        title=title,
        department=department,
        location=location,
        salary_range=salary_range,
        keywords=keywords,
        **context,
    )
