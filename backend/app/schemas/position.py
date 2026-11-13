from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Literal
from uuid import UUID
from datetime import datetime
from app.models.models import PositionStatus, PositionUrgency, PositionType

class PositionBase(BaseModel):
    title: str
    description: str
    requirements: Optional[str] = None
    salary_range: Optional[str] = None
    location: Optional[str] = None
    department: Optional[str] = None
    status: PositionStatus = PositionStatus.OPEN
    urgency: PositionUrgency = PositionUrgency.MEDIUM
    position_type: PositionType = PositionType.FULL_TIME
    headcount: int = Field(default=1, ge=1)
    hiring_manager_id: Optional[UUID] = None

class PositionCreate(PositionBase):
    pass

class PositionUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    requirements: Optional[str] = None
    salary_range: Optional[str] = None
    location: Optional[str] = None
    department: Optional[str] = None
    status: Optional[PositionStatus] = None
    urgency: Optional[PositionUrgency] = None
    position_type: Optional[PositionType] = None
    headcount: Optional[int] = Field(default=None, ge=1)
    hiring_manager_id: Optional[UUID] = None

class PositionResponse(PositionBase):
    recruitment_cycle: int = 1
    deleted_at: Optional[datetime] = None
    id: UUID
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class PositionStats(BaseModel):
    total_resumes: int = 0
    pending_screening: int = 0
    pending_interview: int = 0
    interview_completed: int = 0
    offer_pending: int = 0
    offer_accepted: int = 0
    rejected: int = 0

class PositionWithStats(PositionResponse):
    stats: PositionStats = PositionStats()
    hiring_manager_name: Optional[str] = None

class PositionPage(BaseModel):
    items: List[PositionWithStats]
    total: int

class PositionDetailResponse(PositionResponse):
    stats: PositionStats = PositionStats()
    hiring_manager_name: Optional[str] = None
    linked_question_banks: List['QuestionBankBrief'] = []

class QuestionBankBrief(BaseModel):
    id: UUID
    name: str
    category: str
    question_count: int = 0
    model_config = ConfigDict(from_attributes=True)

class JDContext(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(default="", max_length=200)
    department: Optional[str] = Field(default=None, max_length=200)
    location: Optional[str] = Field(default=None, max_length=200)
    salary_range: Optional[str] = Field(default=None, max_length=200)
    keywords: Optional[str] = Field(default=None, max_length=2000)
    position_type: Optional[PositionType] = None
    current_description: str = Field(default="", max_length=2000)
    current_requirements: str = Field(default="", max_length=2000)

class JDGenerateRequest(JDContext):
    title: str = Field(min_length=1, max_length=200)

class JDGenerateResponse(BaseModel):
    description: str
    requirements: str

class JDChatMessage(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=12000)

class JDChatRequest(JDContext):
    messages: List[JDChatMessage] = Field(min_length=1, max_length=40)
