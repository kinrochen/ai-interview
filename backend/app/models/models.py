from sqlalchemy import Column, String, Boolean, DateTime, Text, Enum, JSON, Integer, ForeignKey, Float, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, ARRAY
import uuid
from datetime import datetime, timezone
from app.models.base import Base
import enum
from sqlalchemy.orm import relationship

class UserRole(str, enum.Enum):
    ADMIN = "admin"
    HR = "hr"
    INTERVIEWER = "interviewer"

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String)
    role = Column(Enum(UserRole), default=UserRole.HR)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class PositionStatus(str, enum.Enum):
    OPEN = "open"
    CLOSED = "closed"
    PUBLISHED = "published"
    PAUSED = "paused"
    CANCELLED = "cancelled"

class PositionUrgency(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"

class PositionType(str, enum.Enum):
    FULL_TIME = "full_time"
    PART_TIME = "part_time"
    CONTRACT = "contract"
    INTERNSHIP = "internship"

class Position(Base):
    __tablename__ = "positions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    requirements = Column(Text)
    salary_range = Column(String)
    location = Column(String)
    department = Column(String)
    status = Column(Enum(PositionStatus), default=PositionStatus.OPEN)
    urgency = Column(Enum(PositionUrgency), default=PositionUrgency.MEDIUM)
    position_type = Column(Enum(PositionType), default=PositionType.FULL_TIME)
    headcount = Column(Integer, default=1)
    hiring_manager_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    recruitment_cycle = Column(Integer, nullable=False, default=1, server_default="1")
    cycle_started_at = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    hiring_manager = relationship("User", foreign_keys=[hiring_manager_id])

class QuestionCategory(str, enum.Enum):
    TECHNICAL = "technical"
    MANAGEMENT = "management"
    HR = "hr"
    OTHER = "other"

class QuestionDifficulty(str, enum.Enum):
    JUNIOR = "junior"
    INTERMEDIATE = "intermediate"
    SENIOR = "senior"

class QuestionBank(Base):
    __tablename__ = "question_banks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    category = Column(Enum(QuestionCategory), default=QuestionCategory.TECHNICAL)
    difficulty = Column(Enum(QuestionDifficulty), default=QuestionDifficulty.INTERMEDIATE)
    tags = Column(ARRAY(String))
    questions = Column(JSON)
    source_file = Column(String)
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    position = relationship("Position")

class ScreeningResult(str, enum.Enum):
    PENDING = "pending"
    PASSED = "passed"
    REJECTED = "rejected"
    WAITLIST = "waitlist"

class ResumeStatus(str, enum.Enum):
    PENDING_SCREENING = "pending_screening"
    PENDING_REVIEW = "pending_review"
    PENDING_DEPT_REVIEW = "pending_dept_review"  # 待用人部门初评
    PENDING_HR_DECISION = "pending_hr_decision"  # 待HR综合决策
    AUTO_REJECTED_PENDING_REVIEW = "auto_rejected_pending_review"  # AI建议淘汰，待人工确认
    PENDING_INTERVIEW = "pending_interview"
    INTERVIEW_PASSED = "interview_passed"  # Initial interview passed
    INTERVIEW_FAILED = "interview_failed"
    OFFER_PENDING = "offer_pending"
    OFFER_ACCEPTED = "offer_accepted"
    OFFER_REJECTED = "offer_rejected"
    ONBOARDING = "onboarding"
    COMPLETED = "completed"
    REJECTED = "rejected"
    DEPARTED = "departed"
    WAITLIST = "waitlist"  # 备选

class RejectReasonCategory(str, enum.Enum):
    SKILLS_MISMATCH = "skills_mismatch"  # 技能不符合
    EXPERIENCE_INSUFFICIENT = "experience_insufficient"  # 经验不足
    EDUCATION_MISMATCH = "education_mismatch"  # 学历不符
    SALARY_EXPECTATION = "salary_expectation"  # 薪资期望不符
    CULTURE_FIT = "culture_fit"  # 文化匹配度低
    CANDIDATE_WITHDRAW = "candidate_withdraw"  # 候选人放弃
    OTHER = "other"  # 其他原因

class Resume(Base):
    __tablename__ = "resumes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_name = Column(String)
    contact = Column(String)
    email = Column(String, index=True)  # 添加索引用于查重
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id"))
    file_path = Column(String)
    raw_text = Column(Text)
    resume_markdown = Column(Text)
    parsed_data = Column(JSON)
    match_score = Column(Integer)
    parse_revision = Column(Integer, nullable=False, default=1, server_default="1")
    parse_status = Column(String, default="processing")
    parse_error = Column(Text)
    parsed_at = Column(DateTime)
    screening_result = Column(Enum(ScreeningResult), default=ScreeningResult.PENDING)
    ai_review = Column(Text)
    hr_review = Column(Text)
    status = Column(Enum(ResumeStatus), default=ResumeStatus.PENDING_SCREENING)
    stage = Column(String, default="new")  # For Kanban: new, screening, interview, offer, hired, rejected
    # 其他岗位匹配信息（用于候选人更适合其他岗位的情况）
    other_position_matches = Column(JSON, nullable=True)
    # 淘汰相关字段
    reject_reason_category = Column(Enum(RejectReasonCategory, values_callable=lambda obj: [e.value for e in obj]), nullable=True)
    reject_reason_detail = Column(Text, nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    rejected_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    position = relationship("Position")
    rejector = relationship("User", foreign_keys=[rejected_by])
    recruitment_cycle = Column(Integer, nullable=False, default=1, server_default="1")
    flow_started_at = Column(DateTime(timezone=True), nullable=True)
    department_reviews = relationship("DepartmentReview", back_populates="resume")

class ReviewRecommendation(str, enum.Enum):
    RECOMMEND = "recommend"  # 推荐
    NOT_RECOMMEND = "not_recommend"  # 不推荐
    PENDING = "pending"  # 待定

class DepartmentReview(Base):
    """用人部门评审记录"""
    __tablename__ = "department_reviews"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resume_id = Column(UUID(as_uuid=True), ForeignKey("resumes.id"), nullable=False)
    reviewer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    technical_score = Column(Integer)  # 技术评分 1-10
    experience_score = Column(Integer)  # 经验评分 1-10
    overall_score = Column(Integer)  # 综合评分 1-10
    recommendation = Column(String(20), nullable=True)  # 改用 String 类型避免枚举问题
    comment = Column(Text)  # 详细评价
    is_completed = Column(Boolean, default=False)  # 是否已完成评审
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    resume = relationship("Resume", back_populates="department_reviews")
    reviewer = relationship("User")

class InterviewResult(str, enum.Enum):
    PENDING = "pending"
    PASSED = "passed"
    REJECTED = "rejected"
    WAITLIST = "waitlist"
    HIRED = "hired"  # 录用
    NEXT_ROUND = "next_round"  # 进入下一轮

class InterviewStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    ANALYZING = "analyzing"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

class Interview(Base):
    __tablename__ = "interviews"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resume_id = Column(UUID(as_uuid=True), ForeignKey("resumes.id"))
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id"))
    interviewer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True) # Link to User
    interviewer = Column(String) # Keep for backward compatibility or display name
    round = Column(Integer, default=1) # Interview round
    interview_time = Column(DateTime(timezone=True))
    started_at = Column(DateTime(timezone=True), nullable=True) # 面试实际开始时间
    interview_type = Column(String, default="onsite")  # onsite, video, phone - 面试形式
    interview_category = Column(String, default="technical")  # hr, technical, manager, ceo, comprehensive - 面试类型
    interview_location = Column(String, nullable=True)  # 面试地点
    meeting_link = Column(String, nullable=True)  # 会议链接
    questions = Column(JSON)
    scores = Column(JSON)
    comments = Column(JSON)
    total_score = Column(Integer)
    panel_members = Column(JSON) # List of user IDs for the panel
    audio_records = Column(JSON) # Audio file paths per question (aggregated or primary)
    transcripts = Column(JSON) # Transcribed text per question (aggregated or primary)
    result = Column(Enum(InterviewResult, values_callable=lambda obj: [e.value for e in obj]), default=InterviewResult.PENDING)
    evaluation = Column(Text)
    suggestion = Column(Text)
    status = Column(Enum(InterviewStatus, values_callable=lambda obj: [e.value for e in obj]), default=InterviewStatus.SCHEDULED)
    created_at = Column(DateTime, default=datetime.utcnow)

    interview_end_time = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    lifecycle_state = Column(String(24), nullable=False, default="scheduled", server_default="scheduled")
    recording_owner_id = Column(UUID(as_uuid=True), nullable=True)
    recording_session_id = Column(UUID(as_uuid=True), nullable=True)
    recording_heartbeat_at = Column(DateTime(timezone=True), nullable=True)
    recording_sessions = Column(JSON, nullable=True)
    recording_chunks = Column(JSON, nullable=True)
    recording_audio_path = Column(Text, nullable=True)
    transcript_data = Column(JSON, nullable=True)
    analysis_revision = Column(Integer, nullable=False, default=0, server_default="0")
    ai_analysis_status = Column(String(24), nullable=False, default="pending", server_default="pending")
    ai_analysis = Column(JSON, nullable=True)
    ai_analysis_error = Column(Text, nullable=True)
    legacy_completed = Column(Boolean, nullable=False, default=False, server_default="false")
    final_decision_at = Column(DateTime(timezone=True), nullable=True)
    final_decision_by = Column(UUID(as_uuid=True), nullable=True)
    decision_history = Column(JSON, nullable=True)
    resume = relationship("Resume")
    position = relationship("Position")
    interviewer_user = relationship("User")
    panels = relationship("InterviewPanel", back_populates="interview")

class InterviewPanel(Base):
    __tablename__ = "interview_panels"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id = Column(UUID(as_uuid=True), ForeignKey("interviews.id"))
    interviewer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    scores = Column(JSON) # Individual scores
    comments = Column(JSON) # Individual comments
    audio_records = Column(JSON) # Audio file paths per question
    transcripts = Column(JSON) # Transcribed text per question
    total_score = Column(Integer)
    is_submitted = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    interview_note = Column(Text, nullable=True)
    note_supplements = Column(JSON, nullable=True)
    human_review_history = Column(JSON, nullable=True)
    human_scores = Column(JSON, nullable=True)
    human_comments = Column(Text, nullable=True)
    human_recommendation = Column(String(24), nullable=True)
    human_review_submitted_at = Column(DateTime(timezone=True), nullable=True)
    human_review_updated_at = Column(DateTime(timezone=True), nullable=True)
    interview = relationship("Interview", back_populates="panels")
    interviewer_user = relationship("User")

class OfferStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING = "pending"
    SENT = "sent"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    EXPIRED = "expired"
    WITHDRAWN = "withdrawn"
    DEPARTED = "departed"

class Offer(Base):
    __tablename__ = "offers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resume_id = Column(UUID(as_uuid=True), ForeignKey("resumes.id"), nullable=False)
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id"), nullable=False)
    candidate_name = Column(String, nullable=False)
    candidate_email = Column(String, nullable=False)
    
    salary_monthly = Column(Float)
    salary_annual = Column(Float)
    salary_structure = Column(Text)
    
    position_title = Column(String, nullable=False)
    department = Column(String)
    report_to = Column(String)
    
    work_location = Column(String)
    work_hours = Column(String)
    
    onboard_date = Column(DateTime)
    probation_months = Column(Integer, default=3)
    
    benefits = Column(Text)
    bonus = Column(Text)
    
    special_terms = Column(Text)
    notes = Column(Text)
    
    valid_until = Column(DateTime)
    status = Column(Enum(OfferStatus), default=OfferStatus.DRAFT)
    token = Column(String, unique=True, nullable=True)
    
    sent_at = Column(DateTime)
    accepted_at = Column(DateTime)
    rejected_at = Column(DateTime)
    rejected_reason = Column(Text)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    
    resume = relationship("Resume")
    position = relationship("Position")
    actual_onboarded_at = Column(DateTime(timezone=True), nullable=True)
    onboarding_recorded_at = Column(DateTime(timezone=True), nullable=True)
    onboarding_confirmed_by = Column(UUID(as_uuid=True), nullable=True)
    departed_at = Column(DateTime(timezone=True), nullable=True)
    departure_reason = Column(Text, nullable=True)
    departure_released_hc = Column(Boolean, nullable=True)
    creator = relationship("User")

class OfferTemplate(Base):
    __tablename__ = "offer_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id"), nullable=True)
    
    salary_monthly = Column(Float)
    salary_annual = Column(Float)
    salary_structure = Column(Text)
    
    department = Column(String)
    report_to = Column(String)
    
    work_location = Column(String)
    work_hours = Column(String)
    
    probation_months = Column(Integer, default=3)
    
    benefits = Column(Text)
    bonus = Column(Text)
    
    special_terms = Column(Text)
    notes = Column(Text)
    
    valid_days = Column(Integer, default=7)
    
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    
    position = relationship("Position")
    creator = relationship("User")

class CodingTestStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    CLOSED = "closed"

class CodingTestType(str, enum.Enum):
    ALGORITHM = "algorithm"
    CHOICE = "choice"
    ESSAY = "essay"

class CodingTest(Base):
    __tablename__ = "coding_tests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String, nullable=False)
    description = Column(Text)
    test_type = Column(String(20), default="algorithm")
    difficulty = Column(String, default="intermediate")
    language = Column(String, default="javascript")
    starter_code = Column(Text)
    test_cases = Column(JSON)
    time_limit_ms = Column(Integer, default=3000)
    memory_limit_mb = Column(Integer, default=256)
    public_token = Column(String, unique=True, index=True, nullable=False)
    status = Column(Enum(CodingTestStatus), default=CodingTestStatus.DRAFT)
    question_bank_id = Column(UUID(as_uuid=True), ForeignKey("question_banks.id"), nullable=True)
    questions = Column(JSON)
    question_generation_status = Column(String(20), default="pending")
    duration_minutes = Column(Integer, default=60)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    resume_id = Column(UUID(as_uuid=True), ForeignKey("resumes.id"), nullable=True)
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    creator = relationship("User")
    resume = relationship("Resume")
    position = relationship("Position")
    question_bank = relationship("QuestionBank")
    submissions = relationship("CodingSubmission", back_populates="coding_test")

class CodingSubmissionStatus(str, enum.Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    EVALUATED = "evaluated"

class CodingSubmission(Base):
    __tablename__ = "coding_submissions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    coding_test_id = Column(UUID(as_uuid=True), ForeignKey("coding_tests.id"))
    candidate_name = Column(String)
    candidate_email = Column(String)
    language = Column(String)
    code = Column(Text)
    answers = Column(JSON)
    run_result = Column(JSON)
    passed = Column(Boolean, default=False)
    score = Column(Integer, default=0)
    ai_evaluation = Column(Text)
    status = Column(Enum(CodingSubmissionStatus), default=CodingSubmissionStatus.DRAFT)
    created_at = Column(DateTime, default=datetime.utcnow)
    submitted_at = Column(DateTime)
    evaluated_at = Column(DateTime)

    coding_test = relationship("CodingTest", back_populates="submissions")

class SystemConfig(Base):
    __tablename__ = "system_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    llm_provider = Column(String, default="dashscope")
    llm_base_url = Column(String, default="https://dashscope.aliyuncs.com/compatible-mode/v1")
    llm_api_key = Column(String)
    llm_model = Column(String, default="qwen3.5-plus")
    llm_temperature = Column(Float, default=0.2)
    llm_max_tokens = Column(Integer)
    asr_provider = Column(String(32), nullable=True)
    asr_base_url = Column(Text, nullable=True)
    asr_model = Column(String(128), nullable=True)
    asr_api_key = Column(Text, nullable=True)
    # 邮件服务配置
    smtp_host = Column(String)
    smtp_port = Column(Integer, default=465)
    smtp_username = Column(String)
    smtp_password = Column(String)
    mail_from = Column(String)  # 发件人邮箱
    mail_from_name = Column(String, default="招聘系统")  # 发件人名称
    mail_enabled = Column(Boolean, default=False)  # 是否启用邮件通知
    # 前端URL配置（用于生成邮件中的链接）
    frontend_url = Column(String, default="http://localhost:5173")
    # 提示词配置（存储所有提示词的 JSON）
    prompt_configs = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RecruitmentSlot(Base):
    __tablename__ = "recruitment_slots"
    __table_args__ = (
        UniqueConstraint("position_id", "cycle", "number", name="uq_recruitment_slot_number"),
        UniqueConstraint("position_id", "cycle", "resume_id", name="uq_recruitment_slot_candidate"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id"), nullable=False, index=True)
    cycle = Column(Integer, nullable=False, default=1)
    number = Column(Integer, nullable=False)
    status = Column(String(24), nullable=False, default="active")
    resume_id = Column(UUID(as_uuid=True), ForeignKey("resumes.id"), nullable=True)
    offer_id = Column(UUID(as_uuid=True), ForeignKey("offers.id"), nullable=True)
    onboarded_at = Column(DateTime(timezone=True), nullable=True)
    departed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class RecruitmentEvent(Base):
    __tablename__ = "recruitment_events"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id", ondelete="SET NULL"), nullable=True, index=True)
    resume_id = Column(UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True, index=True)
    subject_type = Column(String(32), nullable=False)
    subject_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    event_type = Column(String(64), nullable=False, index=True)
    cycle = Column(Integer, nullable=False, default=1)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False, index=True)
    details = Column(JSON, nullable=False, default=dict)


class RecruitmentQualityPolicy(Base):
    __tablename__ = "recruitment_quality_policies"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id"), nullable=True)
    version = Column(Integer, nullable=False)
    rules = Column(JSON, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)


class InterviewAnalysisTask(Base):
    __tablename__ = "interview_analysis_tasks"
    __table_args__ = (UniqueConstraint("interview_id", "revision", name="uq_interview_analysis_revision"),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False, index=True)
    revision = Column(Integer, nullable=False)
    kind = Column(String(24), nullable=False)
    status = Column(String(24), nullable=False, default="queued", index=True)
    attempts = Column(Integer, nullable=False, default=0)
    next_attempt_at = Column(DateTime(timezone=True), nullable=True)
    claim_token = Column(String(64), nullable=True)
    locked_at = Column(DateTime(timezone=True), nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)

# Register history after all mapped classes exist.
from app.services import operational_audit  # noqa: E402, F401
