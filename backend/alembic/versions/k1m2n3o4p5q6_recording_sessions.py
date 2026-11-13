"""Persist recording session order independently of chunk arrival."""

from alembic import op
import sqlalchemy as sa

revision = "k1m2n3o4p5q6"
down_revision = "k0l1m2n3o4p5"
branch_labels = None
depends_on = None


def upgrade():
    columns = {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("interviews")
    }
    if "recording_sessions" not in columns:
        op.add_column(
            "interviews", sa.Column("recording_sessions", sa.JSON(), nullable=True)
        )


def downgrade():
    raise RuntimeError(
        "Recording session history requires a database backup for rollback."
    )
