from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator
from typing import Any, Optional

import httpx

from app.config import settings
from app.services.prompts import AGENT_SYSTEM_PROMPT, RESEARCH_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

LANGUAGE_CODE_MAP = {
    "arabic": "ar",
    "chinese": "zh-CN",
    "english": "en",
    "french": "fr",
    "german": "de",
    "italian": "it",
    "japanese": "ja",
    "kazakh": "kk",
    "korean": "ko",
    "portuguese": "pt",
    "russian": "ru",
    "spanish": "es",
    "turkish": "tr",
    "ukrainian": "uk",
    "uzbek": "uz",
}


def _clip_document(document_context: str, limit: int = 5000) -> str:
    text = (document_context or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit] + "\n% ... document context truncated ..."


def _build_user_input(prompt: str, document_context: str = "") -> list[dict[str, Any]]:
    content = prompt.strip()
    clipped_context = _clip_document(document_context)
    if clipped_context:
        content += f"\n\nCurrent document context:\n```latex\n{clipped_context}\n```"
    return [{
        "role": "user",
        "content": [{"type": "input_text", "text": content}],
    }]


def _search_tool_type() -> str:
    return "browser_search" if settings.llm_provider == "groq" else "web_search"


def _function_tool(
    name: str,
    description: str,
    parameters: dict[str, Any],
) -> dict[str, Any]:
    return {
        "type": "function",
        "name": name,
        "description": description,
        "parameters": parameters,
    }


def _normalize_sources(raw_sources: list[dict[str, Any]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    sources: list[dict[str, str]] = []
    for source in raw_sources:
        url = str(source.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        sources.append({
            "title": str(source.get("title") or url).strip(),
            "url": url,
        })
    return sources


def _extract_text_and_sources(response_json: dict[str, Any]) -> tuple[str, list[dict[str, str]], list[str]]:
    text_parts: list[str] = []
    raw_sources: list[dict[str, Any]] = []
    tools_used: list[str] = []

    for item in response_json.get("output", []) or []:
        item_type = item.get("type")
        if item_type == "function_call":
            name = item.get("name")
            if isinstance(name, str) and name not in tools_used:
                tools_used.append(name)
        elif item_type in {"web_search_call", "browser_search_call"}:
            tool_name = "browser_search" if item_type == "browser_search_call" else "web_search"
            if tool_name not in tools_used:
                tools_used.append(tool_name)

        for part in item.get("content", []) or []:
            part_type = part.get("type")
            if part_type in {"output_text", "text"}:
                chunk = part.get("text")
                if isinstance(chunk, str) and chunk:
                    text_parts.append(chunk)
                for annotation in part.get("annotations", []) or []:
                    if annotation.get("type") == "url_citation":
                        raw_sources.append({
                            "title": annotation.get("title") or annotation.get("url"),
                            "url": annotation.get("url"),
                        })

    text = "".join(text_parts).strip() or str(response_json.get("output_text") or "").strip()
    return text, _normalize_sources(raw_sources), tools_used


def _normalize_language_code(language: str) -> str:
    cleaned = language.strip().lower()
    cleaned = re.sub(r"^(translate\s+(?:this|the following|to|into)\s+)+", "", cleaned).strip()
    cleaned = re.sub(r"^(to|into)\s+", "", cleaned).strip()
    cleaned = re.sub(r"\b(please|pls)\b", "", cleaned).strip()
    cleaned = cleaned.strip(".:,;!?\"'` ")
    if not cleaned:
        return ""
    cleaned = re.sub(r"\s+", " ", cleaned)
    return LANGUAGE_CODE_MAP.get(cleaned, cleaned)


def _detect_translation_request(prompt: str) -> Optional[dict[str, str]]:
    text = prompt.strip()
    lowered = text.lower()
    if "translate" not in lowered:
        return None

    quoted_match = re.search(
        r"""translate\s+["“](?P<text>.+?)["”]\s+(?:to|into)\s+(?P<lang>[A-Za-z\-]+)""",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if quoted_match:
        return {
            "text": quoted_match.group("text").strip(),
            "target_language": _normalize_language_code(quoted_match.group("lang")),
        }

    request_match = re.search(
        r"""translate(?:\s+the\s+following|\s+this|\s+this\s+text|\s+the\s+text)?\s+(?:to|into)\s+(?P<lang>[A-Za-z\-]+)\s*:?\s*(?P<text>[\s\S]+)$""",
        text,
        re.IGNORECASE,
    )
    if request_match:
        candidate_text = request_match.group("text").strip()
        if candidate_text:
            return {
                "text": candidate_text,
                "target_language": _normalize_language_code(request_match.group("lang")),
            }

    line_split = text.splitlines()
    if len(line_split) >= 2:
        first_line = line_split[0]
        first_line_match = re.search(
            r"""translate(?:\s+the\s+following|\s+this|\s+this\s+text)?\s+(?:to|into)\s+(?P<lang>[A-Za-z\-]+)""",
            first_line,
            re.IGNORECASE,
        )
        if first_line_match:
            candidate_text = "\n".join(line_split[1:]).strip()
            if candidate_text:
                return {
                    "text": candidate_text,
                    "target_language": _normalize_language_code(first_line_match.group("lang")),
                }

    return None


async def _responses_create(payload: dict[str, Any]) -> dict[str, Any]:
    if not settings.llm_api_key:
        raise RuntimeError(f"{settings.llm_api_key_env_name} is not configured.")

    async with httpx.AsyncClient(timeout=90.0) as http:
        response = await http.post(
            f"{settings.llm_base_url.rstrip('/')}/responses",
            headers={
                "Authorization": f"Bearer {settings.llm_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if response.status_code >= 400:
        detail = response.text.strip()
        raise RuntimeError(detail or f"{settings.llm_provider.title()} request failed with status {response.status_code}.")
    return response.json()


async def _responses_stream(payload: dict[str, Any]) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    if not settings.llm_api_key:
        raise RuntimeError(f"{settings.llm_api_key_env_name} is not configured.")

    async with httpx.AsyncClient(timeout=90.0) as http:
        async with http.stream(
            "POST",
            f"{settings.llm_base_url.rstrip('/')}/responses",
            headers={
                "Authorization": f"Bearer {settings.llm_api_key}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
            json={**payload, "stream": True},
        ) as response:
            if response.status_code >= 400:
                detail = (await response.aread()).decode(errors="ignore").strip()
                raise RuntimeError(detail or f"{settings.llm_provider.title()} request failed with status {response.status_code}.")

            event_name = ""
            data_lines: list[str] = []

            async for raw_line in response.aiter_lines():
                line = raw_line.strip()
                if not line:
                    if not data_lines and not event_name:
                        continue

                    raw = "\n".join(data_lines)
                    data_lines = []
                    current_event = event_name
                    event_name = ""

                    if not raw or raw == "[DONE]":
                        continue

                    try:
                        payload_json = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    yield current_event or str(payload_json.get("type") or ""), payload_json
                    continue

                if line.startswith("event:"):
                    event_name = line[6:].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[5:].strip())

            if data_lines or event_name:
                raw = "\n".join(data_lines)
                if raw and raw != "[DONE]":
                    try:
                        payload_json = json.loads(raw)
                    except json.JSONDecodeError:
                        return
                    yield event_name or str(payload_json.get("type") or ""), payload_json


def _tool_outputs_follow_up_input(
    prompt: str,
    document_context: str,
    tool_outputs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rendered_outputs: list[str] = []
    for output in tool_outputs:
        try:
            parsed = json.loads(str(output.get("output") or "{}"))
        except json.JSONDecodeError:
            parsed = {"raw": output.get("output")}
        rendered_outputs.append(json.dumps(parsed, ensure_ascii=True, indent=2))

    follow_up = (
        "Continue answering the user's request using the following tool results.\n\n"
        f"Original request:\n{prompt.strip()}\n\n"
        f"Tool results:\n{chr(10).join(rendered_outputs)}"
    )
    return _build_user_input(follow_up, document_context)


def _build_agent_tools() -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = []
    if settings.llm_provider != "groq":
        tools.append({"type": "web_search"})

    tools.extend([
        _function_tool(
            "research_topic",
            "Research a topic and return a short source-backed brief. Use this for documentation lookup, LaTeX references, academic research, or technical synthesis.",
            {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to research."},
                    "focus": {"type": "string", "description": "Optional focus or constraint for the research brief."},
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        ),
        _function_tool(
            "translate_text",
            "Translate text with Google Cloud Translation while preserving LaTeX commands and formatting exactly. Use ISO language codes like es, fr, de, kk, ru, or zh-CN.",
            {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "The text to translate."},
                    "target_language": {"type": "string", "description": "Target language code, for example es, fr, de, kk, ru, or zh-CN."},
                },
                "required": ["text", "target_language"],
                "additionalProperties": False,
            },
        ),
    ])
    return tools


async def _yield_chunked_text(text: str, chunk_size: int = 32) -> AsyncIterator[str]:
    for idx in range(0, len(text), chunk_size):
        yield text[idx: idx + chunk_size]
        await asyncio.sleep(0)


async def _build_agent_tool_outputs(
    response_json: dict[str, Any],
    *,
    prompt: str,
    document_context: str,
    sources: list[dict[str, str]],
    tools_used: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[str]]:
    function_calls = [
        item for item in (response_json.get("output", []) or [])
        if item.get("type") == "function_call"
    ]
    if not function_calls:
        return [], sources, tools_used

    tool_outputs: list[dict[str, Any]] = []
    for call in function_calls:
        name = call.get("name")
        arguments = call.get("arguments") or "{}"
        logger.info("agent function call emitted: name=%r arguments=%s", name, arguments)
        try:
            parsed_args = json.loads(arguments)
        except json.JSONDecodeError:
            parsed_args = {}

        result: dict[str, Any]
        if name == "research_topic":
            result = await _research_topic(
                str(parsed_args.get("query") or ""),
                str(parsed_args.get("focus") or ""),
            )
            sources = _normalize_sources(sources + result.get("sources", []))
        elif name == "translate_text":
            result = await _translate_text(
                str(parsed_args.get("text") or ""),
                str(parsed_args.get("target_language") or ""),
            )
        else:
            result = {"error": f"Unsupported tool: {name}"}

        if isinstance(name, str) and name not in tools_used:
            tools_used.append(name)

        tool_outputs.append({
            "type": "function_call_output",
            "call_id": call.get("call_id"),
            "output": json.dumps(result, ensure_ascii=True),
        })

    return tool_outputs, sources, tools_used


async def stream_tool_enabled_chat(
    prompt: str,
    document_context: str = "",
    result_holder: Optional[dict[str, Any]] = None,
) -> AsyncIterator[str]:
    logger.info("agent stream started chars=%d has_document_context=%s", len(prompt.strip()), bool(document_context.strip()))
    direct_translation = _detect_translation_request(prompt)
    if direct_translation:
        translation = await _translate_text(
            direct_translation["text"],
            direct_translation["target_language"],
        )
        content = translation.get("translation", "")
        tools_used = ["translate_text"]
        if result_holder is not None:
            result_holder.update({"content": content, "sources": [], "tools_used": tools_used})
        async for chunk in _yield_chunked_text(content):
            yield chunk
        return

    tools = _build_agent_tools()
    sources: list[dict[str, str]] = []
    tools_used: list[str] = []
    final_content = ""
    payload: dict[str, Any] = {
        "model": settings.llm_model,
        "instructions": AGENT_SYSTEM_PROMPT,
        "input": _build_user_input(prompt, document_context),
        "tools": tools,
    }

    for turn_index in range(5):
        streamed_chunks: list[str] = []
        output_items: list[dict[str, Any]] = []
        response_json: dict[str, Any] | None = None
        response_id: str | None = None

        try:
            async for event_type, event_payload in _responses_stream(payload):
                if event_type == "response.output_text.delta":
                    delta = str(event_payload.get("delta") or "")
                    if delta:
                        streamed_chunks.append(delta)
                        yield delta
                    continue

                if event_type == "response.output_item.done":
                    item = event_payload.get("item")
                    if isinstance(item, dict):
                        output_items.append(item)
                    continue

                if event_type == "response.completed":
                    candidate = event_payload.get("response")
                    response_json = candidate if isinstance(candidate, dict) else event_payload
                    continue

                if event_type in {"error", "response.failed"}:
                    message = (
                        str(event_payload.get("message") or "")
                        or str((event_payload.get("error") or {}).get("message") or "")
                        or str(event_payload.get("error") or "")
                    )
                    raise RuntimeError(message or "stream_failed")

                for candidate in (
                    event_payload.get("response"),
                    event_payload,
                ):
                    if isinstance(candidate, dict) and candidate.get("id"):
                        response_id = str(candidate.get("id"))
                        break
        except RuntimeError:
            raise
        except Exception:
            logger.info("agent stream falling back to buffered response for turn %d", turn_index + 1)
            buffered_response = await _responses_create(payload)
            if turn_index == 0:
                response_json = buffered_response
            else:
                response_json = buffered_response
            output_items = [item for item in (response_json.get("output", []) or []) if isinstance(item, dict)]
            streamed_chunks = []

        if response_json is None:
            response_json = {"output": output_items}
        elif output_items and not response_json.get("output"):
            response_json["output"] = output_items
        if response_id and not response_json.get("id"):
            response_json["id"] = response_id

        turn_content, response_sources, response_tools = _extract_text_and_sources(response_json)
        if not streamed_chunks and turn_content:
            async for chunk in _yield_chunked_text(turn_content):
                streamed_chunks.append(chunk)
                yield chunk
        sources = _normalize_sources(sources + response_sources)
        for tool_name in response_tools:
            if tool_name not in tools_used:
                tools_used.append(tool_name)

        function_calls = [
            item for item in (response_json.get("output", []) or [])
            if item.get("type") == "function_call"
        ]
        if not function_calls:
            final_content = "".join(streamed_chunks) or turn_content
            if result_holder is not None:
                result_holder.update({
                    "content": final_content,
                    "sources": sources,
                    "tools_used": tools_used,
                })
            logger.info(
                "agent stream completed tools=%s sources=%d chars=%d",
                ",".join(tools_used) if tools_used else "none",
                len(sources),
                len(final_content),
            )
            return

        tool_outputs, sources, tools_used = await _build_agent_tool_outputs(
            response_json,
            prompt=prompt,
            document_context=document_context,
            sources=sources,
            tools_used=tools_used,
        )

        if settings.llm_provider == "groq":
            payload = {
                "model": settings.llm_model,
                "instructions": AGENT_SYSTEM_PROMPT,
                "input": _tool_outputs_follow_up_input(prompt, document_context, tool_outputs),
            }
        else:
            # For OpenAI-compatible Responses follow-ups, reuse the previous response id.
            payload = {
                "model": settings.llm_model,
                "instructions": AGENT_SYSTEM_PROMPT,
                "previous_response_id": response_json.get("id"),
                "input": tool_outputs,
                "tools": tools,
            }

    raise RuntimeError("Agent exceeded the maximum number of tool turns.")


async def _research_topic(query: str, focus: str = "") -> dict[str, Any]:
    research_prompt = query.strip()
    if focus.strip():
        research_prompt += f"\n\nFocus: {focus.strip()}"

    logger.info("agent tool call: research_topic query=%r focus=%r", query.strip(), focus.strip())

    response_json = await _responses_create({
        "model": settings.llm_model,
        "instructions": RESEARCH_SYSTEM_PROMPT,
        "input": [{
            "role": "user",
            "content": [{"type": "input_text", "text": research_prompt}],
        }],
        "tools": [{"type": _search_tool_type()}],
    })
    content, sources, _ = _extract_text_and_sources(response_json)
    logger.info("agent tool result: research_topic sources=%d chars=%d", len(sources), len(content))
    return {"summary": content, "sources": sources}


LATEX_TOKEN_PATTERN = re.compile(
    r"(\\begin\{[^}]+\}|\\end\{[^}]+\}|\\[a-zA-Z]+(?:\[[^\]]*\])?(?:\{[^}]*\})*|\\.|"
    r"\$\$.*?\$\$|\$.*?\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\{|\}|%[^\n]*)",
    re.DOTALL,
)


def _mask_latex(text: str) -> tuple[str, dict[str, str]]:
    replacements: dict[str, str] = {}

    def replace(match: re.Match[str]) -> str:
        token = f"__LATEX_TOKEN_{len(replacements)}__"
        replacements[token] = match.group(0)
        return token

    return LATEX_TOKEN_PATTERN.sub(replace, text), replacements


def _unmask_latex(text: str, replacements: dict[str, str]) -> str:
    restored = text
    for token, original in replacements.items():
        restored = restored.replace(token, original)
    return restored


async def _translate_text(text: str, target_language: str) -> dict[str, str]:
    source_text = text.strip()
    language = target_language.strip().lower()
    logger.info(
        "agent tool call: translate_text target_language=%r chars=%d",
        language,
        len(source_text),
    )
    if not source_text:
        return {"translation": "No text was provided for translation."}
    if not language:
        return {"translation": "Target language is required."}
    if not settings.GOOGLE_TRANSLATE_API_KEY:
        return {"translation": "GOOGLE_TRANSLATE_API_KEY is not configured."}
    masked_text, replacements = _mask_latex(source_text)

    payload: dict[str, Any] = {
        "q": masked_text,
        "target": language,
        "format": "text",
    }
    source_language = settings.GOOGLE_TRANSLATE_SOURCE_LANGUAGE.strip()
    if source_language and source_language.lower() != "auto":
        payload["source"] = source_language

    async with httpx.AsyncClient(timeout=45.0) as http:
        response = await http.post(
            settings.GOOGLE_TRANSLATE_API_URL,
            params={"key": settings.GOOGLE_TRANSLATE_API_KEY},
            json=payload,
        )
    if response.status_code >= 400:
        detail = response.text.strip()
        return {"translation": f"Translation API request failed: {detail or response.status_code}"}

    data = response.json()
    translated = str((((data.get("data") or {}).get("translations") or [{}])[0]).get("translatedText") or "").strip()
    if not translated:
        return {"translation": "Translation API returned an empty response."}

    logger.info("agent tool result: translate_text chars=%d", len(translated))
    return {"translation": _unmask_latex(translated, replacements)}


async def translate_diff_with_tool(
    language: str,
    text: str,
    document_content: str,
    variation_request: str = "",
) -> dict[str, Any]:
    selected_text = text.strip()
    if not language.strip():
        return {"explanation": "Target language is required.", "changes": [], "tool_calls": ["translate_text"]}
    if not selected_text:
        return {"explanation": "Select or quote the passage you want to translate first.", "changes": [], "tool_calls": ["translate_text"]}
    if selected_text not in document_content:
        return {
            "explanation": "The selected passage no longer matches the current document exactly.",
            "changes": [],
            "tool_calls": ["translate_text"],
        }

    translation = await _translate_text(selected_text, _normalize_language_code(language))
    translated_text = translation.get("translation", "").strip()
    if not translated_text:
        return {"explanation": "Translation returned no content.", "changes": [], "tool_calls": ["translate_text"]}
    if translated_text.startswith("Translation API "):
        return {"explanation": translated_text, "changes": [], "tool_calls": ["translate_text"]}
    if variation_request.strip():
        logger.info("translate-diff variation_request ignored=%r", variation_request.strip())

    return {
        "explanation": f"Translated the selected passage to {language.strip()}.",
        "changes": [{
            "id": "c1",
            "description": f"Replace the selected passage with the {language.strip()} translation.",
            "old_text": selected_text,
            "new_text": translated_text,
        }],
        "tool_calls": ["translate_text"],
    }


async def run_tool_enabled_chat(prompt: str, document_context: str = "") -> dict[str, Any]:
    logger.info("agent request started chars=%d has_document_context=%s", len(prompt.strip()), bool(document_context.strip()))
    direct_translation = _detect_translation_request(prompt)
    if direct_translation:
        translation = await _translate_text(
            direct_translation["text"],
            direct_translation["target_language"],
        )
        logger.info("agent request completed via direct translate_text")
        return {
            "content": translation.get("translation", ""),
            "sources": [],
            "tools_used": ["translate_text"],
        }

    tools: list[dict[str, Any]] = []
    if settings.llm_provider != "groq":
        tools.append({"type": "web_search"})

    tools.extend([
        _function_tool(
            "research_topic",
            "Research a topic and return a short source-backed brief. Use this for documentation lookup, LaTeX references, academic research, or technical synthesis.",
            {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to research."},
                    "focus": {"type": "string", "description": "Optional focus or constraint for the research brief."},
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        ),
        _function_tool(
            "translate_text",
            "Translate text with Google Cloud Translation while preserving LaTeX commands and formatting exactly. Use ISO language codes like es, fr, de, kk, ru, or zh-CN.",
            {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "The text to translate."},
                    "target_language": {"type": "string", "description": "Target language code, for example es, fr, de, kk, ru, or zh-CN."},
                },
                "required": ["text", "target_language"],
                "additionalProperties": False,
            },
        ),
    ])

    payload: dict[str, Any] = {
        "model": settings.llm_model,
        "instructions": AGENT_SYSTEM_PROMPT,
        "input": _build_user_input(prompt, document_context),
        "tools": tools,
    }

    response_json = await _responses_create(payload)
    content, sources, tools_used = _extract_text_and_sources(response_json)
    if tools_used:
        logger.info("agent model requested tools: %s", ", ".join(tools_used))

    for _ in range(4):
        function_calls = [
            item for item in (response_json.get("output", []) or [])
            if item.get("type") == "function_call"
        ]
        if not function_calls:
            break

        tool_outputs: list[dict[str, Any]] = []
        for call in function_calls:
            name = call.get("name")
            arguments = call.get("arguments") or "{}"
            logger.info("agent function call emitted: name=%r arguments=%s", name, arguments)
            try:
                parsed_args = json.loads(arguments)
            except json.JSONDecodeError:
                parsed_args = {}

            result: dict[str, Any]
            if name == "research_topic":
                result = await _research_topic(
                    str(parsed_args.get("query") or ""),
                    str(parsed_args.get("focus") or ""),
                )
                sources = _normalize_sources(sources + result.get("sources", []))
            elif name == "translate_text":
                result = await _translate_text(
                    str(parsed_args.get("text") or ""),
                    str(parsed_args.get("target_language") or ""),
                )
            else:
                result = {"error": f"Unsupported tool: {name}"}

            if isinstance(name, str) and name not in tools_used:
                tools_used.append(name)

            tool_outputs.append({
                "type": "function_call_output",
                "call_id": call.get("call_id"),
                "output": json.dumps(result, ensure_ascii=True),
            })

        if settings.llm_provider == "groq":
            response_json = await _responses_create({
                "model": settings.llm_model,
                "instructions": AGENT_SYSTEM_PROMPT,
                "input": _tool_outputs_follow_up_input(prompt, document_context, tool_outputs),
            })
        else:
            response_json = await _responses_create({
                "model": settings.llm_model,
                "instructions": AGENT_SYSTEM_PROMPT,
                "previous_response_id": response_json.get("id"),
                "input": tool_outputs,
                "tools": tools,
            })
        content, response_sources, response_tools = _extract_text_and_sources(response_json)
        sources = _normalize_sources(sources + response_sources)
        for tool_name in response_tools:
            if tool_name not in tools_used:
                tools_used.append(tool_name)
        if response_tools:
            logger.info("agent follow-up tools observed: %s", ", ".join(response_tools))

    logger.info(
        "agent request completed tools=%s sources=%d chars=%d",
        ",".join(tools_used) if tools_used else "none",
        len(sources),
        len(content),
    )
    return {
        "content": content,
        "sources": sources,
        "tools_used": tools_used,
    }
