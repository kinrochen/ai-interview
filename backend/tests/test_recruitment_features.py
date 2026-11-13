from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import patch

import pytest
from fastapi import HTTPException, BackgroundTasks
from app.models.models import (
    Interview,
    InterviewPanel,
    InterviewStatus,
    InterviewResult,
    InterviewAnalysisTask,
    Offer,
    OfferStatus,
    PositionStatus,
    RecruitmentSlot,
    RecruitmentEvent,
    Resume,
    ResumeStatus,
)
from app.services import (
    recruitment_operations as ops,
    interview_workflow as workflow,
    interview_jobs as jobs,
)
from app.services.recruitment_quality import candidate_flow, deadline
from app.services.resume_identity import resolve_identity
from app.services.transcript_import_service import parse_transcript_bytes


def make_interview(db, position, resume, member):
    row = Interview(
        position_id=position.id,
        resume_id=resume.id,
        panel_members=[str(member.id)],
        interview_time=datetime.now(timezone.utc),
        status=InterviewStatus.SCHEDULED,
    )
    db.add(row)
    db.commit()
    db.add(InterviewPanel(interview_id=row.id, interviewer_id=member.id))
    db.commit()
    return row


def make_offer(db, position, resume):
    row = Offer(
        position_id=position.id,
        resume_id=resume.id,
        status=OfferStatus.ACCEPTED,
        candidate_name="候选人",
        candidate_email="test@example.com",
        position_title=position.title,
        accepted_at=datetime.now(timezone.utc) - timedelta(days=2),
    )
    db.add(row)
    db.commit()
    return row


def test_onboarding_is_idempotent_and_closes_when_filled(
    db, test_position, test_resume, test_admin
):
    test_position.headcount = 1
    db.commit()
    row = make_offer(db, test_position, test_resume)
    today = datetime.now(ops.COMPANY_TZ).date()
    result = ops.confirm_onboarding(db, row.id, test_admin, today)
    assert result["progress"]["occupied"] == 1
    assert test_position.status == PositionStatus.CLOSED
    ops.confirm_onboarding(db, row.id, test_admin, today)
    assert db.query(RecruitmentSlot).filter_by(status="occupied").count() == 1
    with pytest.raises(HTTPException):
        ops.confirm_onboarding(db, row.id, test_admin, today - timedelta(days=1))


def test_hc_prevents_overbooking_and_shrinking(
    db, test_position, test_resume, test_admin
):
    test_position.headcount = 1
    db.commit()
    row = make_offer(db, test_position, test_resume)
    today = datetime.now(ops.COMPANY_TZ).date()
    ops.confirm_onboarding(db, row.id, test_admin, today)
    second = Resume(position_id=test_position.id, candidate_name="第二位")
    db.add(second)
    db.commit()
    other = make_offer(db, test_position, second)
    with pytest.raises(HTTPException):
        ops.confirm_onboarding(db, other.id, test_admin, today)
    db.rollback()
    test_position.headcount = 2
    ops.sync_slots(db, test_position)
    db.commit()
    ops.confirm_onboarding(db, other.id, test_admin, today)
    test_position.headcount = 1
    with pytest.raises(HTTPException):
        ops.sync_slots(db, test_position)


@pytest.mark.parametrize("release", [True, False])
def test_departure_retains_history(db, test_position, test_resume, test_admin, release):
    row = make_offer(db, test_position, test_resume)
    today = datetime.now(ops.COMPANY_TZ).date()
    ops.confirm_onboarding(db, row.id, test_admin, today)
    result = ops.record_departure(db, row.id, test_admin, today, "个人原因", release)
    assert row.status == OfferStatus.DEPARTED
    assert test_resume.status == ResumeStatus.DEPARTED
    assert result["progress"]["employed"] == 0
    assert result["progress"]["occupied"] == (0 if release else 1)
    assert (
        db.query(RecruitmentSlot)
        .filter(RecruitmentSlot.onboarded_at.is_not(None))
        .count()
        == 1
    )


def test_lifecycle_new_cycle_and_archive(
    client, db, test_position, auth_headers, admin_auth_headers
):
    test_position.status = PositionStatus.PUBLISHED
    db.commit()
    url = f"/api/recruitment/positions/{test_position.id}/action"
    assert (
        client.post(
            url, headers=auth_headers, json={"action": "pause", "reason": "审批"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            url, headers=auth_headers, json={"action": "cancel", "reason": "取消需求"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            url, headers=auth_headers, json={"action": "reopen", "reason": "补招"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            url,
            headers=admin_auth_headers,
            json={"action": "reopen", "reason": "新一轮", "new_cycle": True},
        ).status_code
        == 200
    )
    assert test_position.recruitment_cycle == 2
    assert (
        client.post(
            url,
            headers=admin_auth_headers,
            json={"action": "archive", "reason": "归档"},
        ).status_code
        == 200
    )
    assert client.get("/api/positions/page", headers=auth_headers).json()["total"] == 0
    assert (
        client.post(
            url,
            headers=admin_auth_headers,
            json={"action": "restore", "reason": "恢复"},
        ).status_code
        == 200
    )


def test_recording_idempotency_and_session_lease(
    db, test_position, test_resume, test_interviewer, test_user, tmp_path
):
    row = make_interview(db, test_position, test_resume, test_interviewer)
    with patch.object(workflow, "STORAGE", tmp_path):
        workflow.start(db, row, test_interviewer)
        sid = uuid4()
        workflow.claim_recording(db, row, test_interviewer, sid)
        workflow.append_chunk(
            db, row, test_interviewer, sid, 0, b"container", "audio/webm"
        )
        workflow.append_chunk(
            db, row, test_interviewer, sid, 0, b"container", "audio/webm"
        )
        assert len(row.recording_chunks) == 1
        with pytest.raises(HTTPException):
            workflow.append_chunk(
                db, row, test_interviewer, sid, 0, b"different", "audio/webm"
            )
        with pytest.raises(HTTPException):
            workflow.claim_recording(db, row, test_user, uuid4())
        with pytest.raises(HTTPException):
            workflow.end(db, row, test_interviewer, 1)
        workflow.release_recording(db, row, test_interviewer, sid)
        workflow.end(db, row, test_interviewer, 1)
        assert db.query(InterviewAnalysisTask).one().kind == "asr"


def test_recording_missing_chunk_prevents_end(
    db, test_position, test_resume, test_interviewer, tmp_path
):
    row = make_interview(db, test_position, test_resume, test_interviewer)
    with patch.object(workflow, "STORAGE", tmp_path):
        workflow.start(db, row, test_interviewer)
        sid = uuid4()
        workflow.claim_recording(db, row, test_interviewer, sid)
        workflow.append_chunk(
            db, row, test_interviewer, sid, 1, b"missing-zero", "audio/webm"
        )
        row.recording_session_id = None
        db.commit()
        with pytest.raises(HTTPException):
            workflow.end(db, row, test_interviewer, 1)
        assert row.lifecycle_state == "in_progress"


def test_private_notes_and_append_only_supplements(
    db, test_position, test_resume, test_interviewer, test_user
):
    row = make_interview(db, test_position, test_resume, test_interviewer)
    workflow.start(db, row, test_interviewer)
    workflow.save_note(db, row, test_interviewer, "私有笔记")
    assert workflow.serialize(db, row, test_user)["reviews"][0]["note"] is None
    workflow.end(db, row, test_interviewer, 0)
    assert workflow.serialize(db, row, test_user)["reviews"][0]["note"] == "私有笔记"
    with pytest.raises(HTTPException):
        workflow.save_note(db, row, test_interviewer, "覆盖")
    workflow.save_note(db, row, test_interviewer, "补充", True)
    assert db.query(InterviewPanel).one().note_supplements[0]["text"] == "补充"


def test_final_decision_requires_reviews_and_hr(
    db, test_position, test_resume, test_interviewer, test_admin
):
    row = make_interview(db, test_position, test_resume, test_interviewer)
    workflow.start(db, row, test_interviewer)
    workflow.end(db, row, test_interviewer, 0)
    with pytest.raises(HTTPException):
        workflow.decide(db, row, test_admin, "passed", "综合意见")
    workflow.submit_review(
        db,
        row,
        test_interviewer,
        {k: 8 for k in workflow.DIMENSIONS},
        "依据完整",
        "passed",
    )
    with pytest.raises(HTTPException):
        workflow.decide(db, row, test_interviewer, "passed", "综合意见")
    workflow.decide(db, row, test_admin, "passed", "综合意见")
    assert row.result == InterviewResult.PASSED
    assert test_resume.status == ResumeStatus.INTERVIEW_PASSED
    with pytest.raises(HTTPException):
        workflow.save_note(db, row, test_interviewer, "迟到修改", True)
    workflow.decide(db, row, test_admin, "waitlist", "复核修正")
    assert len(row.decision_history) == 2


def test_only_grounded_quotes_are_scored():
    result = jobs.validated_findings(
        {
            "dimensions": [
                {
                    "key": "technical_fit",
                    "score": 9,
                    "assessment": "依据",
                    "evidence": [{"segment_id": "s1", "quote": "Redis 集群"}],
                },
                {
                    "key": "collaboration",
                    "score": 9,
                    "evidence": [{"segment_id": "s1", "quote": "百人团队"}],
                },
            ]
        },
        [{"id": "s1", "text": "我使用过 Redis 集群", "start": 12, "end": 18}],
    )
    assert result[0]["score"] == 9
    assert result[0]["evidence"][0]["start"] == 12
    assert result[1]["score"] is None


def test_analysis_covers_long_transcript():
    import json

    transcript = {
        "segments": [{"id": str(i), "text": "技术经验" * 3000} for i in range(3)]
    }

    def response(prompt):
        data = json.loads(prompt.split("\n转写 ")[1])
        return json.dumps(
            {
                "dimensions": [
                    {
                        "key": "technical_fit",
                        "score": 8,
                        "assessment": "经验",
                        "evidence": [
                            {"segment_id": data[0]["id"], "quote": "技术经验"}
                        ],
                    }
                ]
            }
        )

    with patch(
        "app.services.ai_service.generate_text", side_effect=response
    ) as generate:
        result = jobs.analyze(transcript, "工程师")
    assert generate.call_count == 3
    assert result["segments_analyzed"] == 3


def test_old_analysis_revision_cannot_overwrite(
    db, test_position, test_resume, test_interviewer
):
    row = make_interview(db, test_position, test_resume, test_interviewer)
    workflow.queue_analysis(db, row, "analysis")
    db.commit()
    job = jobs.claim(db)
    row_id = row.id
    workflow.queue_analysis(db, row, "analysis")
    db.commit()
    with patch.object(jobs, "SessionLocal", lambda: db):
        jobs.finish(job, analysis={"bad": "old result"})
    assert db.query(Interview).filter_by(id=row_id).one().ai_analysis is None
    assert (
        db.query(InterviewAnalysisTask).filter_by(revision=1).one().status
        == "superseded"
    )


def test_calendar_and_detail_enforce_assignment(
    client,
    db,
    test_position,
    test_resume,
    test_interviewer,
    test_user,
    interviewer_auth_headers,
    auth_headers,
):
    mine = make_interview(db, test_position, test_resume, test_interviewer)
    other = make_interview(db, test_position, test_resume, test_user)
    start = datetime.now(timezone.utc) - timedelta(hours=1)
    end = start + timedelta(days=1)
    response = client.get(
        "/api/recruitment/calendar",
        params={"start": start.isoformat(), "end": end.isoformat()},
        headers=interviewer_auth_headers,
    )
    assert response.status_code == 200
    assert [r["id"] for r in response.json()] == [str(mine.id)]
    assert response.json()[0]["estimated_end"] is True
    assert (
        client.get(
            "/api/recruitment/calendar",
            params={
                "start": start.isoformat(),
                "end": (end + timedelta(days=90)).isoformat(),
            },
            headers=auth_headers,
        ).status_code
        == 422
    )
    assert (
        client.get(
            f"/api/interview-workflow/{other.id}", headers=interviewer_auth_headers
        ).status_code
        == 403
    )


def test_workbench_own_pending_review(
    client, db, test_position, test_resume, test_interviewer, interviewer_auth_headers
):
    row = make_interview(db, test_position, test_resume, test_interviewer)
    workflow.start(db, row, test_interviewer)
    workflow.end(db, row, test_interviewer, 0)
    response = client.get(
        "/api/recruitment/workbench", headers=interviewer_auth_headers
    )
    assert response.status_code == 200
    assert response.json()["counts"]["pending_reviews"] == 1


def test_quality_requires_evidence_for_legacy_stage(db, test_position, test_resume):
    test_resume.status = ResumeStatus.PENDING_HR_DECISION
    db.commit()
    row = candidate_flow(db, test_resume, test_position)
    assert row["due_at"] is not None
    db.query(RecruitmentEvent).delete()
    db.commit()
    assert candidate_flow(db, test_resume, test_position)["state"] == "unknown"


def test_workdays_include_official_makeup_day():
    start = datetime(2026, 9, 19, 9, tzinfo=ops.COMPANY_TZ)
    assert (
        deadline(start, 1).astimezone(ops.COMPANY_TZ).date().isoformat() == "2026-09-20"
    )
    assert deadline(datetime(2040, 1, 1, tzinfo=timezone.utc), 1) is None


@pytest.mark.parametrize(
    "filename,data,timestamps",
    [
        ("a.txt", "候选人：三年开发经验".encode(), False),
        (
            "a.vtt",
            b"WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nCandidate: Python\n",
            True,
        ),
        ("a.txt", "候选人：中文转写".encode("gb18030"), False),
    ],
)
def test_transcript_import(filename, data, timestamps):
    result = parse_transcript_bytes(data, filename)
    assert result["has_timestamps"] == timestamps
    assert result["segments"]


def test_resume_identity_preserves_manual_values_and_rejects_hallucination():
    existing = SimpleNamespace(
        candidate_name="张明", email="manual@example.com", contact=None
    )
    text = "姓名：李青\n手机 13812345678\n邮箱 li@example.com"
    result = resolve_identity(
        text, {"candidate_name": "虚构姓名", "email": "fake@example.com"}, existing
    )
    assert result == {
        "candidate_name": "张明",
        "email": "manual@example.com",
        "contact": "13812345678",
    }
    existing.candidate_name, existing.email = "解析中...", None
    assert resolve_identity(text, {}, existing)["candidate_name"] == "李青"


def test_resume_failure_reaches_queue_and_preserves_name(
    db, test_resume, test_position
):
    from app.services import resume_service

    payload = {
        "resume_id": test_resume.id,
        "position_id": test_position.id,
        "revision": test_resume.parse_revision,
    }
    name = test_resume.candidate_name
    with patch.object(resume_service, "SessionLocal", lambda: db), patch.object(
        resume_service, "read_file_content", return_value="姓名：候选人"
    ), patch.object(resume_service, "analyze_resume", return_value=None):
        with pytest.raises(ValueError):
            resume_service.process_resume_task(payload)
        resume_service.on_resume_parse_failure(payload, "network")
    assert db.get(Resume, payload["resume_id"]).candidate_name == name
    assert db.get(Resume, payload["resume_id"]).parse_status == "failed"


def test_reparse_preserves_identity_and_changes_revision(db, test_resume):
    from app.services.resume_service import reparse_resume

    name, revision = test_resume.candidate_name, test_resume.parse_revision
    test_resume.email = "human@example.com"
    db.commit()
    reparse_resume(db, test_resume.id, BackgroundTasks())
    assert test_resume.candidate_name == name
    assert test_resume.email == "human@example.com"
    assert test_resume.parse_revision == revision + 1


def test_additive_migration_preserves_completed_legacy_interview(tmp_path):
    import importlib.util
    from pathlib import Path
    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from app.models.models import Base
    from app.models.models import User, Position, Resume, SystemConfig

    migration_file = (
        Path(__file__).parents[1]
        / "alembic/versions/k0l1m2n3o4p5_recruiting_operations.py"
    )
    spec = importlib.util.spec_from_file_location(
        "recruiting_migration", migration_file
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    metadata = sa.MetaData()
    for table in Base.metadata.sorted_tables:
        table.to_metadata(metadata)
    additions = {
        "positions": {"recruitment_cycle", "cycle_started_at", "deleted_at"},
        "resumes": {"recruitment_cycle", "flow_started_at", "parse_revision"},
        "interviews": {
            "interview_end_time",
            "ended_at",
            "lifecycle_state",
            "recording_owner_id",
            "recording_session_id",
            "recording_heartbeat_at",
            "recording_chunks",
            "recording_sessions",
            "recording_audio_path",
            "transcript_data",
            "analysis_revision",
            "ai_analysis_status",
            "ai_analysis",
            "ai_analysis_error",
            "legacy_completed",
            "final_decision_at",
            "final_decision_by",
            "decision_history",
        },
        "interview_panels": {
            "interview_note",
            "note_supplements",
            "human_review_history",
            "human_scores",
            "human_comments",
            "human_recommendation",
            "human_review_submitted_at",
            "human_review_updated_at",
        },
        "offers": {
            "actual_onboarded_at",
            "onboarding_recorded_at",
            "onboarding_confirmed_by",
            "departed_at",
            "departure_reason",
            "departure_released_hc",
        },
        "system_configs": {"asr_provider", "asr_base_url", "asr_model", "asr_api_key"},
    }
    engine = sa.create_engine(f"sqlite:///{tmp_path}/legacy.sqlite")
    with engine.begin() as conn:
        for model in (
            User,
            Position,
            Resume,
            Interview,
            InterviewPanel,
            Offer,
            SystemConfig,
        ):
            table = metadata.tables[model.__tablename__]
            for name in additions.get(table.name, set()):
                table._columns.remove(table.c[name])
            table.create(conn)
        pid, rid, iid = uuid4(), uuid4(), uuid4()
        conn.execute(
            metadata.tables["positions"]
            .insert()
            .values(id=pid, title="历史岗位", description="保留职责", headcount=2)
        )
        conn.execute(
            metadata.tables["resumes"]
            .insert()
            .values(id=rid, position_id=pid, candidate_name="历史候选人")
        )
        conn.execute(
            metadata.tables["interviews"]
            .insert()
            .values(
                id=iid,
                position_id=pid,
                resume_id=rid,
                status=InterviewStatus.COMPLETED,
                result=InterviewResult.PASSED,
                evaluation="原报告",
            )
        )
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()
            session_spec = importlib.util.spec_from_file_location(
                "recording_sessions_migration",
                migration_file.with_name("k1m2n3o4p5q6_recording_sessions.py"),
            )
            session_migration = importlib.util.module_from_spec(session_spec)
            session_spec.loader.exec_module(session_migration)
            session_migration.upgrade()
        row = conn.execute(
            sa.text(
                "SELECT lifecycle_state, legacy_completed, ended_at, final_decision_at, evaluation FROM interviews"
            )
        ).one()
        assert row[0] == "ended" and row[1]
        assert row[2] is None and row[3] is None
        assert row[4] == "原报告"
        assert conn.scalar(sa.text("SELECT count(*) FROM recruitment_slots")) == 2


def test_recording_sessions_with_separate_headers_are_decoded_separately(db, tmp_path):
    from pydub import AudioSegment

    parts = []
    for index in range(2):
        source = tmp_path / f"{index}.webm"
        AudioSegment.silent(duration=200).export(source, format="webm")
        parts.append({"session": str(index), "index": 0, "path": str(source)})
    with patch.object(jobs, "STORAGE", tmp_path):
        output = jobs.assemble_recording(uuid4(), parts)
    assert len(AudioSegment.from_file(output)) >= 400


def test_asr_settings_accepts_dashscope_key_and_never_returns_it(
    client, admin_auth_headers, auth_headers
):
    endpoint = "/api/interview-workflow/settings/asr"
    body = {
        "provider": "dashscope",
        "model": "paraformer-realtime-v2",
        "api_key": "synthetic-secret-key",
    }
    assert client.put(endpoint, headers=auth_headers, json=body).status_code == 403
    assert (
        client.put(endpoint, headers=admin_auth_headers, json=body).status_code == 200
    )
    result = client.get(endpoint, headers=admin_auth_headers)
    assert result.json()["configured"] is True
    assert result.json()["has_api_key"] is True
    assert "synthetic-secret-key" not in result.text


def test_asr_failure_preserves_playable_audio_and_stops_missing_configuration_retries(
    db, test_position, test_resume, test_interviewer, tmp_path
):
    from sqlalchemy.orm import sessionmaker

    TestingSessionLocal = sessionmaker(bind=db.get_bind(), autoflush=False)
    from app.services.audio_service import ASRConfigurationError

    row = make_interview(db, test_position, test_resume, test_interviewer)
    row.lifecycle_state = "ended"
    workflow.queue_analysis(db, row, "asr")
    db.commit()
    row_id = row.id
    output = str(tmp_path / "recording.wav")
    with patch.object(jobs, "SessionLocal", TestingSessionLocal), patch.object(
        jobs, "assemble_recording", return_value=output
    ), patch.object(
        jobs, "transcribe", side_effect=ASRConfigurationError("请配置语音服务")
    ):
        jobs.run_once()
    db.expire_all()
    saved = db.get(Interview, row_id)
    assert saved.recording_audio_path == output
    assert saved.ai_analysis_status == "failed"
    task = db.query(InterviewAnalysisTask).one()
    assert task.status == "failed" and task.attempts == 1
    assert saved.ai_analysis_error == "请配置语音服务"


def test_successful_asr_survives_llm_failure_and_retry(
    db, test_position, test_resume, test_interviewer, tmp_path
):
    from sqlalchemy.orm import sessionmaker

    TestingSessionLocal = sessionmaker(bind=db.get_bind(), autoflush=False)

    row = make_interview(db, test_position, test_resume, test_interviewer)
    row.lifecycle_state = "ended"
    workflow.queue_analysis(db, row, "asr")
    db.commit()
    row_id = row.id
    transcript = {
        "text": "技术经历",
        "has_timestamps": True,
        "segments": [{"id": "s1", "text": "技术经历", "start": 0, "end": 1}],
    }
    with patch.object(jobs, "SessionLocal", TestingSessionLocal), patch.object(
        jobs, "assemble_recording", return_value=str(tmp_path / "a.wav")
    ), patch.object(jobs, "transcribe", return_value=transcript), patch.object(
        jobs, "analyze", side_effect=ValueError("AI 暂时不可用")
    ):
        jobs.run_once()
    db.expire_all()
    task = db.query(InterviewAnalysisTask).one()
    assert task.kind == "analysis" and task.status == "retry_wait"
    assert db.get(Interview, row_id).transcript_data == transcript
    task.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    with patch.object(jobs, "SessionLocal", TestingSessionLocal), patch.object(
        jobs, "transcribe"
    ) as transcribe, patch.object(jobs, "analyze", return_value={"dimensions": []}):
        jobs.run_once()
        transcribe.assert_not_called()
    db.expire_all()
    assert db.get(Interview, row_id).ai_analysis_status == "completed"


def test_quality_query_count_stays_bounded_for_many_candidates(
    client, db, test_position, auth_headers
):
    from sqlalchemy import event

    db.add_all(
        [
            Resume(position_id=test_position.id, candidate_name=f"候选人 {index}")
            for index in range(25)
        ]
    )
    db.commit()
    queries = []

    def count_query(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            queries.append(statement)

    event.listen(db.bind, "before_cursor_execute", count_query)
    try:
        result = client.get(
            "/api/recruitment/quality?page_size=10", headers=auth_headers
        )
    finally:
        event.remove(db.bind, "before_cursor_execute", count_query)
    assert result.status_code == 200
    assert result.json()["total"] == 25
    assert len(result.json()["items"]) == 10
    assert len(queries) <= 9


def test_asr_model_and_configured_key_are_passed_to_dashscope(tmp_path):
    config = {
        "provider": "dashscope",
        "key": "synthetic-secret",
        "model": "paraformer-realtime-v2",
        "url": "",
    }
    with patch(
        "app.services.audio_service.transcribe_audio",
        return_value={
            "text": "回答内容",
            "segments": [{"text": "回答内容", "start": 0, "end": 1}],
        },
    ) as service:
        result = jobs.transcribe(str(tmp_path / "a.wav"), config)
    service.assert_called_once_with(
        str(tmp_path / "a.wav"),
        api_key="synthetic-secret",
        model="paraformer-realtime-v2",
    )
    assert result["segments"][0]["id"] == "asr-1"


def test_completed_task_ignores_duplicate_failure_callback(
    db, test_position, test_resume, test_interviewer
):
    from sqlalchemy.orm import sessionmaker

    sessions = sessionmaker(bind=db.get_bind(), autoflush=False)
    row = make_interview(db, test_position, test_resume, test_interviewer)
    workflow.queue_analysis(db, row, "analysis")
    db.commit()
    row_id = row.id
    job = jobs.claim(db)
    with patch.object(jobs, "SessionLocal", sessions):
        jobs.finish(job, analysis={"dimensions": []})
        jobs.finish(job, error=ValueError("late duplicate failure"))
    db.expire_all()
    assert db.get(Interview, row_id).ai_analysis_status == "completed"
    assert db.query(InterviewAnalysisTask).one().status == "completed"


def test_recruitment_timeline_uses_actual_onboarding_and_company_date(
    db, test_position, test_resume
):
    from app.services.dashboard_service import get_timeline_analytics
    from datetime import time

    row = make_offer(db, test_position, test_resume)
    today = datetime.now(ops.COMPANY_TZ).date()
    row.actual_onboarded_at = datetime.combine(
        today, time.min, ops.COMPANY_TZ
    ).astimezone(timezone.utc)
    db.commit()
    data = get_timeline_analytics(db, days=7)
    points = data["timeline"]
    assert len(points) == 7
    assert sum(point["hires"] for point in points) == 1
    assert (
        next(point for point in points if point["date"] == today.isoformat())["hires"]
        == 1
    )


def test_recording_session_order_survives_recovery_after_another_member(
    db, test_position, test_resume, test_interviewer, test_user, tmp_path
):
    row = make_interview(db, test_position, test_resume, test_interviewer)
    first, second = uuid4(), uuid4()
    with patch.object(workflow, "STORAGE", tmp_path):
        workflow.start(db, row, test_interviewer)
        workflow.claim_recording(db, row, test_interviewer, first)
        row.recording_heartbeat_at = datetime.now(timezone.utc) - timedelta(seconds=60)
        db.commit()
        workflow.claim_recording(db, row, test_user, second)
        workflow.append_chunk(
            db, row, test_user, second, 0, b"second-session-arrived-first", "audio/webm"
        )
        workflow.release_recording(db, row, test_user, second)
        workflow.claim_recording(db, row, test_interviewer, first)
        workflow.append_chunk(
            db,
            row,
            test_interviewer,
            first,
            0,
            b"first-session-recovered-later",
            "audio/webm",
        )
        workflow.release_recording(db, row, test_interviewer, first)
    assert [item["id"] for item in row.recording_sessions] == [str(first), str(second)]
    assert [item["sequence"] for item in row.recording_sessions] == [0, 1]
    assert row.recording_chunks[0]["session"] == str(second)
    assert row.recording_chunks[1]["session"] == str(first)


def test_unconfirmed_expired_recording_requires_owner_or_explicit_admin_end(
    db, test_position, test_resume, test_interviewer, test_admin
):
    row = make_interview(db, test_position, test_resume, test_interviewer)
    workflow.start(db, row, test_interviewer)
    workflow.claim_recording(db, row, test_interviewer, uuid4())
    row.recording_heartbeat_at = datetime.now(timezone.utc) - timedelta(seconds=60)
    db.commit()
    with pytest.raises(HTTPException):
        workflow.end(db, row, test_interviewer, 0)
    workflow.end(db, row, test_admin, 0, force=True)
    assert row.lifecycle_state == "ended"
    assert row.recording_sessions[0]["closed_by"] == str(test_admin.id)
    assert (
        db.query(RecruitmentEvent).filter_by(event_type="recording_end_forced").count()
        == 1
    )


def test_assembler_orders_sessions_by_claim_order_not_upload_order(tmp_path):
    from pydub import AudioSegment

    first = tmp_path / "first.webm"
    second = tmp_path / "second.webm"
    AudioSegment.silent(duration=200).export(first, format="webm")
    from pydub.generators import Sine

    Sine(440).to_audio_segment(duration=200).export(second, format="webm")
    chunks = [
        {"session": "second", "index": 0, "path": str(second)},
        {"session": "first", "index": 0, "path": str(first)},
    ]
    sessions = [{"id": "first", "sequence": 0}, {"id": "second", "sequence": 1}]
    with patch.object(jobs, "STORAGE", tmp_path):
        audio = AudioSegment.from_file(
            jobs.assemble_recording(uuid4(), chunks, sessions)
        )
    assert audio[:150].rms == 0
    assert audio[250:350].rms > 100


def test_unassigned_interview_can_be_taken_over_and_completed(
    db, test_position, test_resume, test_admin
):
    row = Interview(
        position_id=test_position.id,
        resume_id=test_resume.id,
        panel_members=[],
        status=InterviewStatus.SCHEDULED,
    )
    db.add(row)
    db.commit()
    workflow.start(db, row, test_admin)
    assert workflow.assigned_ids(row) == {str(test_admin.id)}
    workflow.end(db, row, test_admin, 0)
    workflow.submit_review(
        db,
        row,
        test_admin,
        {key: 8 for key in workflow.DIMENSIONS},
        "完成现场评价",
        "passed",
    )
    workflow.decide(db, row, test_admin, "passed", "综合决策")
    assert row.result == InterviewResult.PASSED


def test_unassigned_ended_interview_requires_staff_to_take_over(
    db, test_position, test_resume, test_interviewer, test_admin
):
    row = Interview(
        position_id=test_position.id,
        resume_id=test_resume.id,
        panel_members=[],
        lifecycle_state="ended",
    )
    db.add(row)
    db.commit()
    with pytest.raises(HTTPException):
        workflow.take_over(db, row, test_interviewer)
    workflow.take_over(db, row, test_admin)
    db.commit()
    assert workflow.assigned_ids(row) == {str(test_admin.id)}
    with pytest.raises(HTTPException):
        workflow.take_over(db, row, test_admin)


def test_workspace_exposes_original_resume_and_question_context(
    db, test_position, test_resume, test_interviewer, test_user
):
    row = make_interview(db, test_position, test_resume, test_interviewer)
    test_resume.raw_text = "候选人原始简历\n项目经历"
    test_resume.file_path = "uploads/resumes/candidate.pdf"
    test_resume.parsed_data = {"school": "测试大学"}
    row.questions = [{"title": "项目经验", "content": "介绍你的项目", "follow_up": ["如何验证结果"]}]
    row.panels[0].scores = {"0": 0}
    row.panels[0].comments = {"0": "需要追问"}
    db.commit()
    own = workflow.serialize(db, row, test_interviewer)
    assert own["resume"]["raw_text"] == test_resume.raw_text
    assert own["resume"]["file_path"].endswith("candidate.pdf")
    assert own["position"]["requirements"] == test_position.requirements
    assert own["questions"][0]["follow_up"] == ["如何验证结果"]
    assert own["reviews"][0]["question_scores"] == {"0": 0}
    assert workflow.serialize(db, row, test_user)["reviews"][0]["question_comments"] is None
    row.lifecycle_state = "ended"
    db.commit()
    assert workflow.serialize(db, row, test_user)["reviews"][0]["question_comments"] == {"0": "需要追问"}


def test_question_changes_preserve_metadata_and_reindex_existing_records(
    client, db, test_position, test_resume, test_interviewer, interviewer_auth_headers
):
    row = make_interview(db, test_position, test_resume, test_interviewer)
    row.questions = ["历史字符串题目", {"content": "保留题目", "source": "question_bank"}]
    row.scores = {"0": 6, "1": 9}
    row.comments = {"cancel_reason": "历史备注", "1": "第二题"}
    row.panels[0].scores = {"0": 0, "1": 8}
    row.panels[0].comments = {"1": "第二题回答"}
    row.panels[0].transcripts = {"1": "第二题转写", "full": "整场转写"}
    db.commit()
    base = f"/api/interview-workflow/{row.id}"
    revision = workflow.questions_revision(row)
    response = client.patch(base + "/questions", headers=interviewer_auth_headers, json={
        "action": "add", "question": {"content": "补充题目", "reference_answer": "参考要点"},
        "expected_revision": revision,
    })
    assert response.status_code == 200
    added = response.json()
    assert added["questions"][0] == "历史字符串题目"
    assert added["questions"][1]["source"] == "question_bank"
    assert added["questions_revision"] != revision
    deleted = client.patch(base + "/questions", headers=interviewer_auth_headers, json={
        "action": "delete", "index": 0, "expected_revision": added["questions_revision"],
    })
    assert deleted.status_code == 200
    db.refresh(row)
    assert row.scores == {"0": 9}
    assert row.comments == {"cancel_reason": "历史备注", "0": "第二题"}
    assert row.panels[0].scores == {"0": 8}
    assert row.panels[0].comments == {"0": "第二题回答"}
    assert row.panels[0].transcripts == {"0": "第二题转写", "full": "整场转写"}


def test_question_record_is_a_private_draft_and_does_not_end_interview(
    client, db, test_position, test_resume, test_interviewer,
    interviewer_auth_headers, auth_headers, admin_auth_headers
):
    row = make_interview(db, test_position, test_resume, test_interviewer)
    row.questions = [{"content": "第一题"}]
    db.commit()
    base = f"/api/interview-workflow/{row.id}"
    payload = {"index": 0, "score": 0, "comments": "回答要点\n待核实内容", "expected_revision": workflow.questions_revision(row)}
    assert client.put(base + "/question-review", headers=interviewer_auth_headers, json=payload).status_code == 409
    workflow.start(db, row, test_interviewer)
    assert client.put(base + "/question-review", headers=auth_headers, json=payload).status_code == 403
    assert client.put(base + "/question-review", headers=interviewer_auth_headers, json=payload).status_code == 200
    db.refresh(row)
    assert row.lifecycle_state == "in_progress"
    assert not row.panels[0].is_submitted
    assert row.panels[0].human_review_submitted_at is None
    assert row.panels[0].scores == {"0": 0}
    admin_view = client.get(base, headers=admin_auth_headers).json()
    assert admin_view["reviews"][0]["question_scores"] is None
    assert client.put(base + "/question-review", headers=interviewer_auth_headers, json={**payload, "score": 1.5}).status_code == 422
    assert client.put(base + "/question-review", headers=interviewer_auth_headers, json={**payload, "score": None}).status_code == 200
    db.refresh(row.panels[0])
    assert row.panels[0].scores == {}


def test_question_revision_conflicts_and_ended_edits_keep_saved_content(
    client, db, test_position, test_resume, test_interviewer, interviewer_auth_headers
):
    row = make_interview(db, test_position, test_resume, test_interviewer)
    row.questions = [{"content": "原问题"}]
    db.commit()
    workflow.start(db, row, test_interviewer)
    base = f"/api/interview-workflow/{row.id}"
    stale = workflow.questions_revision(row)
    row.questions = [{"content": "其他成员更新的问题"}]
    db.commit()
    change = {"action": "update", "index": 0, "question": {"content": "迟到修改"}, "expected_revision": stale}
    assert client.patch(base + "/questions", headers=interviewer_auth_headers, json=change).status_code == 409
    assert client.put(base + "/question-review", headers=interviewer_auth_headers, json={"index": 0, "score": 8, "expected_revision": stale}).status_code == 409
    workflow.end(db, row, test_interviewer, 0)
    change["expected_revision"] = workflow.questions_revision(row)
    assert client.patch(base + "/questions", headers=interviewer_auth_headers, json=change).status_code == 409
    assert client.put(base + "/question-review", headers=interviewer_auth_headers, json={"index": 0, "score": 8, "expected_revision": change["expected_revision"]}).status_code == 409
    db.refresh(row)
    assert row.questions[0]["content"] == "其他成员更新的问题"


def test_generating_questions_leave_resume_available_and_prevent_edits(
    client, db, test_position, test_resume, test_interviewer, interviewer_auth_headers
):
    row = make_interview(db, test_position, test_resume, test_interviewer)
    row.questions = None
    db.commit()
    base = f"/api/interview-workflow/{row.id}"
    view = client.get(base, headers=interviewer_auth_headers).json()
    assert view["questions_pending"] is True
    assert view["resume"]["id"] == str(test_resume.id)
    assert client.patch(base + "/questions", headers=interviewer_auth_headers, json={
        "action": "add", "question": {"content": "手动补题"}, "expected_revision": view["questions_revision"],
    }).status_code == 409
