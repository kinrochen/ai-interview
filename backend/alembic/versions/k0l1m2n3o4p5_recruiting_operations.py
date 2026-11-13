"""Recruitment operations and interview evidence, preserving legacy records."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "k0l1m2n3o4p5"
down_revision = "j9k0l1m2n3o4"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            for name, values in {
                "positionstatus": ["PAUSED", "CANCELLED"],
                "resumestatus": ["DEPARTED"],
                "offerstatus": ["DEPARTED"],
            }.items():
                for value in values:
                    op.execute(
                        sa.text(f"ALTER TYPE {name} ADD VALUE IF NOT EXISTS '{value}'")
                    )
    time = sa.DateTime(timezone=True)
    fields = {
        "positions": [
            ("recruitment_cycle", sa.Integer(), "1"),
            ("cycle_started_at", time, None),
            ("deleted_at", time, None),
        ],
        "resumes": [
            ("recruitment_cycle", sa.Integer(), "1"),
            ("flow_started_at", time, None),
            ("parse_revision", sa.Integer(), "1"),
        ],
        "interviews": [
            ("interview_end_time", time, None),
            ("ended_at", time, None),
            ("lifecycle_state", sa.String(24), "scheduled"),
            ("recording_owner_id", UUID(), None),
            ("recording_session_id", UUID(), None),
            ("recording_heartbeat_at", time, None),
            ("recording_chunks", sa.JSON(), None),
            ("recording_audio_path", sa.Text(), None),
            ("transcript_data", sa.JSON(), None),
            ("analysis_revision", sa.Integer(), "0"),
            ("ai_analysis_status", sa.String(24), "pending"),
            ("ai_analysis", sa.JSON(), None),
            ("ai_analysis_error", sa.Text(), None),
            ("legacy_completed", sa.Boolean(), sa.false()),
            ("final_decision_at", time, None),
            ("final_decision_by", UUID(), None),
            ("decision_history", sa.JSON(), None),
        ],
        "interview_panels": [
            ("interview_note", sa.Text(), None),
            ("note_supplements", sa.JSON(), None),
            ("human_review_history", sa.JSON(), None),
            ("human_scores", sa.JSON(), None),
            ("human_comments", sa.Text(), None),
            ("human_recommendation", sa.String(24), None),
            ("human_review_submitted_at", time, None),
            ("human_review_updated_at", time, None),
        ],
        "offers": [
            ("actual_onboarded_at", time, None),
            ("onboarding_recorded_at", time, None),
            ("onboarding_confirmed_by", UUID(), None),
            ("departed_at", time, None),
            ("departure_reason", sa.Text(), None),
            ("departure_released_hc", sa.Boolean(), None),
        ],
        "system_configs": [
            ("asr_provider", sa.String(32), None),
            ("asr_base_url", sa.Text(), None),
            ("asr_model", sa.String(128), None),
            ("asr_api_key", sa.Text(), None),
        ],
    }
    for table, columns in fields.items():
        existing = {c["name"] for c in sa.inspect(bind).get_columns(table)}
        for name, kind, default in columns:
            if name not in existing:
                op.add_column(
                    table,
                    sa.Column(
                        name, kind, nullable=default is None, server_default=default
                    ),
                )
    # These tables are new and use only stable scalar/FK columns.
    from app.models.models import (
        RecruitmentSlot,
        RecruitmentEvent,
        RecruitmentQualityPolicy,
        InterviewAnalysisTask,
    )

    for model in (
        RecruitmentSlot,
        RecruitmentEvent,
        RecruitmentQualityPolicy,
        InterviewAnalysisTask,
    ):
        model.__table__.create(bind, checkfirst=True)
    op.execute(
        "UPDATE positions SET cycle_started_at = created_at WHERE cycle_started_at IS NULL"
    )
    op.execute(
        "UPDATE resumes SET flow_started_at = created_at WHERE flow_started_at IS NULL"
    )
    op.execute(
        "UPDATE interviews SET lifecycle_state = CASE WHEN status IN ('completed', 'analyzing') THEN 'ended' ELSE CAST(status AS VARCHAR) END"
    )
    op.execute(
        "UPDATE interviews SET legacy_completed = true WHERE status = 'completed'"
    )
    positions = bind.execute(
        sa.text("SELECT id, headcount, recruitment_cycle FROM positions")
    ).mappings()
    from uuid import UUID as PythonUUID, uuid4
    from datetime import datetime, timezone

    table = RecruitmentSlot.__table__
    for position in positions:
        for number in range(1, (position["headcount"] or 1) + 1):
            bind.execute(
                table.insert().values(
                    id=uuid4(),
                    position_id=PythonUUID(str(position["id"])),
                    cycle=position["recruitment_cycle"],
                    number=number,
                    status="active",
                    created_at=datetime.now(timezone.utc),
                )
            )


def downgrade():
    raise RuntimeError(
        "This migration contains operational history. Restore the database backup to roll back."
    )
