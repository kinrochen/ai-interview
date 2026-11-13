from openai import (
    OpenAI, APIConnectionError, APITimeoutError, AuthenticationError,
    PermissionDeniedError, RateLimitError, BadRequestError,
)
import logging
import os
from typing import Dict, Any
import json
from dotenv import load_dotenv
from app.utils.prompt_manager import prompt_manager
from app.config.database import SessionLocal
from app.models.models import SystemConfig

load_dotenv()

_DEFAULT_PROVIDER = os.getenv("LLM_PROVIDER", "dashscope")
_DEFAULT_BASE_URL = os.getenv("OPENAI_BASE_URL") or os.getenv("LLM_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_MODEL = os.getenv("OPENAI_MODEL") or os.getenv("LLM_MODEL") or "qwen3.5-plus"
_DEFAULT_TEMPERATURE = 0.2
_DEFAULT_BASE_URL_BY_PROVIDER = {
    "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "openai": "https://api.openai.com/v1",
    "openai_compatible": None,
}

_client_cache = None
_client_cache_key = None


def _get_llm_config() -> Dict[str, Any]:
    db = SessionLocal()
    try:
        cfg = db.query(SystemConfig).first()
        llm_provider = (cfg.llm_provider if cfg else None) or _DEFAULT_PROVIDER
        llm_base_url = (cfg.llm_base_url if cfg else None) or _DEFAULT_BASE_URL_BY_PROVIDER.get(llm_provider) or _DEFAULT_BASE_URL
        llm_model = (cfg.llm_model if cfg else None) or _DEFAULT_MODEL
        llm_temperature = (cfg.llm_temperature if cfg and cfg.llm_temperature is not None else None)
        llm_temperature = _DEFAULT_TEMPERATURE if llm_temperature is None else llm_temperature
        llm_max_tokens = cfg.llm_max_tokens if cfg else None
        llm_api_key = (cfg.llm_api_key if cfg else None) or os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY")
        return {
            "llm_provider": llm_provider,
            "llm_base_url": llm_base_url,
            "llm_model": llm_model,
            "llm_temperature": llm_temperature,
            "llm_max_tokens": llm_max_tokens,
            "llm_api_key": llm_api_key,
        }
    finally:
        db.close()


def _get_client() -> OpenAI:
    global _client_cache, _client_cache_key
    cfg = _get_llm_config()
    key = (cfg.get("llm_base_url"), cfg.get("llm_api_key"))
    if _client_cache is not None and _client_cache_key == key:
        return _client_cache
    _client_cache_key = key
    _client_cache = OpenAI(
        api_key=cfg.get("llm_api_key"),
        base_url=cfg.get("llm_base_url"),
    )
    return _client_cache

def _get_extra_body() -> Dict[str, Any]:
    cfg = _get_llm_config()
    if cfg.get("llm_provider") == "dashscope":
        return {"enable_thinking": False}
    return {}

def analyze_resume(resume_text: str, position_description: str, other_positions: str = "") -> Dict[str, Any]:
    prompt_data = prompt_manager.get_prompt(
        "analyze_resume",
        resume_text=resume_text,
        position_description=position_description,
        other_positions=other_positions
    )

    if not prompt_data.get("user"):
        print("Failed to load prompt for analyze_resume")
        return {}

    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"]}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {'role': 'system', 'content': prompt_data['system']},
                {'role': 'user', 'content': prompt_data['user']}
            ],
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        result = json.loads(completion.choices[0].message.content)
        return result
    except Exception as e:
        print(f"AI analysis failed: {e}")
        return {}

def generate_resume_markdown(resume_text: str) -> str:
    prompt_data = prompt_manager.get_prompt(
        "generate_resume_markdown", 
        resume_text=resume_text
    )
    
    if not prompt_data.get("user"):
        return resume_text
        
    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"]}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {'role': 'system', 'content': prompt_data['system']},
                {'role': 'user', 'content': prompt_data['user']}
            ],
            extra_body=_get_extra_body(),
            **extra,
        )
        content = completion.choices[0].message.content
        # Remove potential markdown code block markers
        content = content.replace("```markdown", "").replace("```", "").strip()
        return content
    except Exception as e:
        print(f"Markdown generation failed: {e}")
        return resume_text

def generate_interview_questions(
    resume_data: Dict,
    position_description: str,
    question_bank_content: str = "",
    count: int = 5,
    interview_category: str = "technical"
) -> list:
    # 面试类型描述映射
    category_descriptions = {
        "hr": "HR面试，主要考察候选人的综合素质、沟通能力、团队协作、职业规划、薪资期望等",
        "technical": "技术面试，主要考察候选人的专业技能、技术深度、问题解决能力、项目经验等",
        "manager": "主管面试，主要考察候选人的业务理解、团队管理、项目把控、跨部门协作等能力",
        "ceo": "CEO面试，主要考察候选人的战略思维、价值观匹配、行业洞察、长期发展潜力等",
        "comprehensive": "综合面试，全面考察候选人的技术能力、综合素质、发展潜力等各方面"
    }

    category_desc = category_descriptions.get(interview_category, category_descriptions["technical"])

    prompt_data = prompt_manager.get_prompt(
        "generate_interview_questions",
        resume_data=json.dumps(resume_data, ensure_ascii=False),
        position_description=position_description,
        question_bank_content=question_bank_content,
        count=count,
        interview_category=category_desc
    )

    if not prompt_data.get("user"):
        return []

    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"]}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {'role': 'system', 'content': prompt_data['system']},
                {'role': 'user', 'content': prompt_data['user']}
            ],
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        result = json.loads(completion.choices[0].message.content)
        if isinstance(result, list):
            return result
        return result.get("questions", [])
    except Exception as e:
        print(f"Question generation failed: {e}")
        return []

def generate_interview_evaluation(
    questions: list, 
    scores: Dict[str, Any], 
    total_score: int,
    panel_details: str = "",
    transcripts: str = "" # New parameter for candidate audio transcripts
) -> Dict[str, str]:
    prompt_data = prompt_manager.get_prompt(
        "generate_interview_evaluation", 
        questions=json.dumps(questions, ensure_ascii=False), 
        scores=json.dumps(scores, ensure_ascii=False),
        total_score=total_score,
        panel_details=panel_details,
        transcripts=transcripts
    )
    
    if not prompt_data.get("user"):
        return {"evaluation": "生成评价失败", "suggestion": "waitlist"}
        
    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"]}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {'role': 'system', 'content': prompt_data['system']},
                {'role': 'user', 'content': prompt_data['user']}
            ],
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        result = json.loads(completion.choices[0].message.content)
        return result
    except Exception as e:
        print(f"Evaluation generation failed: {e}")
        return {"evaluation": "生成评价失败", "suggestion": "waitlist"}


def generate_interview_evaluation_from_transcript(
    transcript: str,
    interviewer_evaluation: str,
    interviewer_score: int
) -> Dict[str, str]:
    """
    根据录音转写和面试官评价生成综合评价
    """
    prompt_data = prompt_manager.get_prompt(
        "generate_interview_evaluation_from_transcript",
        transcript=transcript,
        interviewer_evaluation=interviewer_evaluation,
        interviewer_score=interviewer_score
    )
    
    if not prompt_data.get("user"):
        return {"evaluation": interviewer_evaluation, "suggestion": "waitlist"}
        
    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"]}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {'role': 'system', 'content': prompt_data['system']},
                {'role': 'user', 'content': prompt_data['user']}
            ],
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        result = json.loads(completion.choices[0].message.content)
        return result
    except Exception as e:
        print(f"Evaluation from transcript generation failed: {e}")
        return {"evaluation": interviewer_evaluation, "suggestion": "waitlist"}


def generate_coding_test_evaluation(
    title: str,
    description: str,
    language: str,
    code: str,
    run_result: Dict[str, Any],
) -> Dict[str, Any]:
    prompt_data = prompt_manager.get_prompt(
        "generate_coding_test_evaluation",
        title=title,
        description=description,
        language=language,
        code=code,
        run_result=json.dumps(run_result, ensure_ascii=False),
    )

    if not prompt_data.get("user"):
        return {"evaluation": "生成评价失败"}

    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"]}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {"role": "system", "content": prompt_data["system"]},
                {"role": "user", "content": prompt_data["user"]},
            ],
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        result = json.loads(completion.choices[0].message.content)
        return result
    except Exception as e:
        print(f"Coding evaluation generation failed: {e}")
        return {"evaluation": "生成评价失败"}

# JD generation shares validation and stream handling across generation and revision.
logger = logging.getLogger(__name__)
JD_TEXT_LIMIT = 2000


class JDGenerationError(ValueError):
    """An actionable JD failure that is safe to show to the user."""


def _parse_jd_content(content: str) -> Dict[str, str]:
    if not isinstance(content, str) or not content.strip():
        raise JDGenerationError("AI 未返回岗位内容，请重试或检查模型配置")
    text = content.strip()
    if text.startswith("```") and text.endswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        result = json.loads(text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise JDGenerationError("AI 返回的内容格式不完整，请重新生成") from exc
    if not isinstance(result, dict):
        raise JDGenerationError("AI 返回的内容格式不正确，请重新生成")
    draft = {}
    for field, label in (("description", "岗位职责"), ("requirements", "任职要求")):
        value = result.get(field)
        if not isinstance(value, str) or not value.strip():
            raise JDGenerationError(f"AI 返回的{label}为空或格式不正确，请重新生成")
        if len(value.strip()) > JD_TEXT_LIMIT:
            raise JDGenerationError(f"AI 返回的{label}超过 {JD_TEXT_LIMIT} 字，请补充精简要求后重试")
        draft[field] = value.strip()
    return draft


def _jd_error_message(exc: Exception) -> str:
    if isinstance(exc, JDGenerationError):
        return str(exc)
    if isinstance(exc, (AuthenticationError, PermissionDeniedError)):
        return "AI 服务认证失败，请在系统设置中检查 API 密钥和模型权限"
    if isinstance(exc, RateLimitError):
        return "AI 服务请求受限或额度不足，请稍后重试或检查服务额度"
    if isinstance(exc, APITimeoutError):
        return "AI 生成超时，请稍后重试或精简要求"
    if isinstance(exc, APIConnectionError):
        return "无法连接 AI 服务，请检查网络和系统设置中的模型服务地址"
    if isinstance(exc, BadRequestError):
        return "AI 服务不接受当前请求，请检查模型是否支持 JSON 输出及生成参数"
    return "AI 生成失败，请稍后重试；若持续失败，请检查系统设置中的模型配置"


def _jd_messages(
    title: str = "", department: str = "", location: str = "",
    salary_range: str = "", keywords: str = "", position_type: str = None,
    current_description: str = "", current_requirements: str = "",
) -> list:
    prompt = prompt_manager.get_prompt(
        "generate_jd", title=title, department=department or "未指定",
        location=location or "未指定", salary_range=salary_range or "未指定",
        keywords=keywords or "无特殊要求",
        position_type=position_type or "未指定",
        current_description=current_description,
        current_requirements=current_requirements,
    )
    if not prompt.get("user"):
        raise JDGenerationError("JD 提示词未配置，请在系统设置中检查提示词")
    context = {
        "title": title, "department": department, "location": location,
        "salary_range": salary_range, "position_type": position_type,
        "additional_requirements": keywords,
        "current_description": current_description,
        "current_requirements": current_requirements,
    }
    return [
        {"role": "system", "content": (prompt.get("system", "") + "\n"
            "返回完整 JSON 对象，description 和 requirements 都必须是非空 Markdown 字符串，"
            "每项不超过 2000 字。根据最新修改意见更新现有草稿，保留未要求修改的有效内容。"
            "岗位类型、地点、薪资及补充要求以提供的信息为准，不得编造公司福利或薪资承诺。"
            "未指定的学历和工作年限不要自行设为硬性门槛；不要添加与岗位能力无关的限制。")},
        {"role": "user", "content": prompt["user"] + "\n\n岗位上下文与现有草稿：\n" + json.dumps(context, ensure_ascii=False)},
    ]


def _jd_completion_options() -> dict:
    cfg = _get_llm_config()
    if not cfg.get("llm_api_key"):
        raise JDGenerationError("尚未配置 AI 服务，请先在系统设置中填写模型和 API 密钥")
    options = {
        "model": cfg["llm_model"], "temperature": cfg["llm_temperature"],
        "response_format": {"type": "json_object"},
        "extra_body": {"enable_thinking": False} if cfg.get("llm_provider") == "dashscope" else {},
    }
    if cfg.get("llm_max_tokens") is not None:
        options["max_tokens"] = cfg["llm_max_tokens"]
    return options


def _check_jd_finish_reason(reason: str) -> None:
    if reason == "length":
        raise JDGenerationError("AI 输出被截断，请提高系统设置中的最大输出长度，或精简生成要求后重试")
    if reason == "content_filter":
        raise JDGenerationError("AI 服务未能返回该内容，请调整岗位要求后重试")


def generate_jd(
    title: str, department: str = "", location: str = "",
    salary_range: str = "", keywords: str = "", position_type: str = None,
    current_description: str = "", current_requirements: str = "",
) -> Dict[str, str]:
    try:
        messages = _jd_messages(title, department, location, salary_range, keywords,
                                position_type, current_description, current_requirements)
        options = _jd_completion_options()
        completion = _get_client().with_options(timeout=90, max_retries=0).chat.completions.create(
            messages=messages, **options,
        )
        if not completion.choices:
            raise JDGenerationError("AI 未返回岗位内容，请重试或检查模型配置")
        choice = completion.choices[0]
        _check_jd_finish_reason(choice.finish_reason)
        return _parse_jd_content(choice.message.content)
    except Exception as exc:
        logger.exception("JD generation failed")
        raise JDGenerationError(_jd_error_message(exc)) from exc


def _jd_event(data: dict) -> str:
    return "data: " + json.dumps(data, ensure_ascii=False) + "\n\n"


def _stream_jd(messages: list):
    stream = None
    try:
        options = _jd_completion_options()
        stream = _get_client().with_options(timeout=90, max_retries=0).chat.completions.create(
            messages=messages, stream=True, **options,
        )
        parts = []
        for chunk in stream:
            # Usage-only and heartbeat chunks may legitimately have no choices.
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            _check_jd_finish_reason(choice.finish_reason)
            content = choice.delta.content if choice.delta else None
            if isinstance(content, str) and content:
                parts.append(content)
                yield _jd_event({"content": content})
        result = _parse_jd_content("".join(parts))
        yield _jd_event({"done": True, **result})
    except Exception as exc:
        logger.exception("JD stream failed")
        yield _jd_event({"error": _jd_error_message(exc)})
    finally:
        # GeneratorExit on disconnect must also release the upstream connection.
        if stream is not None:
            try:
                stream.close()
            except Exception:
                logger.warning("Failed to close JD upstream stream", exc_info=True)


def generate_jd_stream(
    title: str, department: str = "", location: str = "",
    salary_range: str = "", keywords: str = "", position_type: str = None,
    current_description: str = "", current_requirements: str = "",
):
    try:
        messages = _jd_messages(title, department, location, salary_range, keywords,
                                position_type, current_description, current_requirements)
    except Exception as exc:
        logger.exception("JD prompt preparation failed")
        yield _jd_event({"error": _jd_error_message(exc)})
        return
    yield from _stream_jd(messages)


def chat_jd_stream(
    messages: list, current_description: str = "", current_requirements: str = "",
    title: str = "", department: str = "", location: str = "",
    salary_range: str = "", keywords: str = "", position_type: str = None,
):
    try:
        formatted = _jd_messages(title, department, location, salary_range, keywords,
                                 position_type, current_description, current_requirements)
        formatted[0]["content"] += "\n按用户最新意见返回完整的更新结果；只提问时仍保留当前草稿。"
        formatted.extend(messages)
    except Exception as exc:
        logger.exception("JD revision preparation failed")
        yield _jd_event({"error": _jd_error_message(exc)})
        return
    yield from _stream_jd(formatted)


def generate_text(prompt: str) -> str:
    """
    通用文本生成函数，用于生成面试评价等文本内容
    """
    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"]}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]

        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {'role': 'user', 'content': prompt}
            ],
            extra_body=_get_extra_body(),
            **extra,
        )
        return completion.choices[0].message.content
    except Exception as e:
        print(f"Text generation failed: {e}")
        return ""
