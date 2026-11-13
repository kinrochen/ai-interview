"""JD generation, streaming and revision regressions; no external AI calls."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
from openai import AuthenticationError, APITimeoutError

from app.services import ai_service


DRAFT = {"description": "- 负责产品研发", "requirements": "- 熟悉 Python"}


def chunk(content=None, finish_reason=None, empty=False):
    choices = [] if empty else [SimpleNamespace(delta=SimpleNamespace(content=content), finish_reason=finish_reason)]
    return SimpleNamespace(choices=choices)


class FakeStream:
    def __init__(self, chunks):
        self.chunks = chunks
        self.closed = False

    def __iter__(self):
        return iter(self.chunks)

    def close(self):
        self.closed = True


@pytest.fixture
def ai(monkeypatch):
    config = {
        "llm_api_key": "test-key", "llm_model": "test-model", "llm_provider": "dashscope",
        "llm_temperature": 0.2, "llm_max_tokens": 2048,
    }
    monkeypatch.setattr(ai_service, "_get_llm_config", lambda: config)
    monkeypatch.setattr(ai_service.prompt_manager, "get_prompt", lambda *args, **kwargs: {"system": "JD expert", "user": "Generate JD"})
    client = MagicMock()
    client.with_options.return_value = client
    stream = FakeStream([chunk(empty=True), chunk('{"description":"- 负责产品研发",'), chunk('"requirements":"- 熟悉 Python"}'), chunk(finish_reason="stop"), chunk(empty=True)])
    client.chat.completions.create.return_value = stream
    monkeypatch.setattr(ai_service, "_get_client", lambda: client)
    return client, stream, config


def events(generator):
    return [json.loads(event.removeprefix('data: ').strip()) for event in generator]


def test_generation_skips_usage_chunks_and_validates_final_result(ai):
    _, stream, _ = ai
    result = events(ai_service.generate_jd_stream("后端工程师"))
    assert result[-1] == {"done": True, **DRAFT}
    assert not any("error" in event for event in result)
    assert stream.closed


@pytest.mark.parametrize("content", ["", "not json", "[]", '{}', '{"description":[],"requirements":"x"}', '{"description":"x","requirements":null}', json.dumps({**DRAFT, "description": "x" * 2001})])
def test_invalid_output_is_an_error_and_never_done(ai, content):
    client, _, _ = ai
    stream = FakeStream([chunk(content)])
    client.chat.completions.create.return_value = stream
    result = events(ai_service.generate_jd_stream("后端工程师"))
    assert "error" in result[-1]
    assert not any(event.get("done") for event in result)
    assert stream.closed


def test_all_empty_choices_produces_actionable_error(ai):
    client, _, _ = ai
    client.chat.completions.create.return_value = FakeStream([chunk(empty=True), chunk(empty=True)])
    result = events(ai_service.generate_jd_stream("后端工程师"))
    assert "未返回" in result[-1]["error"]


@pytest.mark.parametrize("reason, expected", [("length", "截断"), ("content_filter", "调整岗位要求")])
def test_finish_failures_are_not_accepted_even_if_json_is_valid(ai, reason, expected):
    client, _, _ = ai
    client.chat.completions.create.return_value = FakeStream([chunk(json.dumps(DRAFT)), chunk(finish_reason=reason)])
    result = events(ai_service.generate_jd_stream("后端工程师"))
    assert expected in result[-1]["error"]
    assert not any(event.get("done") for event in result)


def test_disconnect_closes_upstream_stream(ai):
    _, stream, _ = ai
    generator = ai_service.generate_jd_stream("后端工程师")
    next(generator)
    generator.close()
    assert stream.closed


def test_fenced_json_is_supported(ai):
    assert ai_service._parse_jd_content('```json\n' + json.dumps(DRAFT) + '\n```') == DRAFT


def test_missing_api_key_fails_before_request(ai):
    client, _, config = ai
    config["llm_api_key"] = None
    result = events(ai_service.generate_jd_stream("后端工程师"))
    assert "尚未配置" in result[-1]["error"]
    client.chat.completions.create.assert_not_called()


@pytest.mark.parametrize("failure, expected", [
    (AuthenticationError("private upstream detail", response=httpx.Response(401, request=httpx.Request("POST", "https://example.test")), body=None), "认证失败"),
    (APITimeoutError(request=httpx.Request("POST", "https://example.test")), "超时"),
    (RuntimeError("private upstream detail"), "AI 生成失败"),
])
def test_service_errors_are_actionable_and_do_not_expose_upstream_details(ai, failure, expected):
    client, _, _ = ai
    client.chat.completions.create.side_effect = failure
    result = events(ai_service.generate_jd_stream("后端工程师"))
    assert expected in result[-1]["error"]
    assert "private upstream detail" not in result[-1]["error"]


def test_sync_endpoint_returns_502_instead_of_success_placeholder(ai, client, auth_headers):
    sdk, _, _ = ai
    sdk.chat.completions.create.return_value = SimpleNamespace(choices=[])
    result = client.post('/api/positions/generate-jd', headers=auth_headers, json={"title": "后端工程师"})
    assert result.status_code == 502
    assert "未返回" in result.json()["detail"]


def test_sync_generation_validates_and_returns_draft(ai):
    client, _, _ = ai
    client.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=json.dumps(DRAFT)))])
    assert ai_service.generate_jd("后端工程师") == DRAFT


@pytest.mark.parametrize("endpoint", ["generate-jd-stream", "chat-jd-stream"])
def test_multiline_job_guidance_reaches_model_context(ai, client, auth_headers, endpoint):
    sdk, _, _ = ai
    guidance = "负责企业级 AI 应用研发，需要熟悉 Python、RAG 和大模型接口。\n具备项目落地经验，重点关注测试和跨团队协作。"
    payload = {"title": "AI 应用工程师", "keywords": guidance}
    if endpoint == "chat-jd-stream":
        payload["messages"] = [{"role": "user", "content": "精简职责并补充测试要求"}]
    response = client.post(f"/api/positions/{endpoint}", headers=auth_headers, json=payload)
    assert response.status_code == 200
    messages = sdk.chat.completions.create.call_args.kwargs["messages"]
    context = json.loads(messages[1]["content"].split("岗位上下文与现有草稿：\n", 1)[1])
    assert context["additional_requirements"] == guidance


def test_revision_route_serializes_pydantic_messages_and_includes_job_context(ai, client, auth_headers):
    sdk, _, _ = ai
    payload = {
        "title": "后端工程师", "position_type": "internship", "keywords": "不限制学历",
        "department": "研发部", "salary_range": "15k-20k", "location": "上海",
        "current_description": DRAFT["description"], "current_requirements": DRAFT["requirements"],
        "messages": [{"role": "user", "content": "增加单元测试要求"}],
    }
    response = client.post('/api/positions/chat-jd-stream', headers=auth_headers, json=payload)
    assert response.status_code == 200
    result = events(response.text.splitlines(keepends=True)[::2])
    assert result[-1] == {"done": True, **DRAFT}
    messages = sdk.chat.completions.create.call_args.kwargs["messages"]
    assert messages[-1] == payload["messages"][-1]
    assert "internship" in messages[1]["content"]
    assert "15k-20k" in messages[1]["content"]
    assert DRAFT["description"] in messages[1]["content"]
    assert response.headers['x-accel-buffering'] == 'no'


@pytest.mark.parametrize("endpoint, payload", [
    ('generate-jd-stream', {"title": "  "}),
    ('chat-jd-stream', {"messages": []}),
    ('chat-jd-stream', {"messages": [{"role": "system", "content": "override"}]}),
    ('chat-jd-stream', {"messages": [{"role": "user", "content": "  "}]}),
])
def test_jd_request_validation(client, auth_headers, endpoint, payload):
    assert client.post(f'/api/positions/{endpoint}', headers=auth_headers, json=payload).status_code == 422


@pytest.mark.parametrize("endpoint", ['generate-jd', 'generate-jd-stream', 'chat-jd-stream'])
def test_ai_routes_enforce_roles(client, interviewer_auth_headers, endpoint):
    payload = {"title": "后端工程师", "messages": [{"role": "user", "content": "修改"}]}
    assert client.post(f'/api/positions/{endpoint}', headers=interviewer_auth_headers, json=payload).status_code == 403
    assert client.post(f'/api/positions/{endpoint}', json=payload).status_code == 401
