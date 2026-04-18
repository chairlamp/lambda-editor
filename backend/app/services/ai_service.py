from __future__ import annotations
import json
from typing import AsyncIterator, Optional

from app.services.llm import get_provider
from app.services.prompts import (
    LATEX_SYSTEM_PROMPT,
    build_rewrite_instruction,
    build_suggest_system_prompt,
    build_rewrite_diff_system_prompt,
    build_equation_system_prompt,
)


def _parse_diff_json(raw: str) -> dict:
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {"explanation": "AI returned invalid JSON", "changes": []}
    if "changes" not in result:
        result["changes"] = []
    for i, c in enumerate(result["changes"]):
        if "id" not in c:
            c["id"] = f"c{i+1}"
    return result


async def generate_text(prompt: str, document_context: str = "") -> AsyncIterator[str]:
    context_block = (
        f"\n\nCurrent document:\n```latex\n{document_context[:3000]}\n```"
        if document_context else ""
    )
    messages = [
        {"role": "system", "content": LATEX_SYSTEM_PROMPT},
        {"role": "user", "content": f"{prompt}{context_block}"},
    ]
    async for chunk in get_provider().stream_completion(messages, max_tokens=2000):
        yield chunk


async def rewrite_text(text: str, style: str, document_context: str = "") -> AsyncIterator[str]:
    instruction = build_rewrite_instruction(style)
    context_block = (
        f"\n\nDocument context:\n```latex\n{document_context[:2000]}\n```"
        if document_context else ""
    )
    messages = [
        {"role": "system", "content": LATEX_SYSTEM_PROMPT},
        {"role": "user", "content": f"{instruction}\n\nText:\n{text}{context_block}"},
    ]
    async for chunk in get_provider().stream_completion(messages, max_tokens=2000):
        yield chunk


async def fix_latex(code: str, error_log: str) -> AsyncIterator[str]:
    messages = [
        {"role": "system", "content": LATEX_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Fix the following LaTeX code that has compilation errors.\n\n"
                f"LaTeX code:\n```latex\n{code}\n```\n\n"
                f"Compilation error log:\n```\n{error_log}\n```\n\n"
                f"Return ONLY the corrected LaTeX code, no explanation."
            ),
        },
    ]
    async for chunk in get_provider().stream_completion(messages, max_tokens=4000):
        yield chunk


async def explain_error(error_log: str) -> AsyncIterator[str]:
    messages = [
        {"role": "system", "content": LATEX_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Explain this LaTeX compilation error in simple terms and suggest how to fix it:\n\n"
                f"```\n{error_log}\n```"
            ),
        },
    ]
    async for chunk in get_provider().stream_completion(messages, max_tokens=800):
        yield chunk


async def generate_equation(description: str) -> AsyncIterator[str]:
    messages = [
        {"role": "system", "content": LATEX_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Generate a LaTeX equation for: {description}\n\n"
                f"Return only the LaTeX math code using appropriate environments "
                f"(equation, align, etc.). Use a fenced ```latex code block."
            ),
        },
    ]
    async for chunk in get_provider().stream_completion(messages, max_tokens=500):
        yield chunk


async def convert_to_latex(plain_text: str) -> AsyncIterator[str]:
    messages = [
        {"role": "system", "content": LATEX_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Convert the following plain text to properly formatted LaTeX. "
                f"Use appropriate LaTeX commands, environments, and formatting:\n\n{plain_text}"
            ),
        },
    ]
    async for chunk in get_provider().stream_completion(messages, max_tokens=3000):
        yield chunk


async def suggest_changes(instruction: str, document_content: str, variation_request: str = "") -> dict:
    """Return structured JSON describing a set of diff hunks to apply to the document."""
    messages = [
        {"role": "system", "content": build_suggest_system_prompt()},
        {
            "role": "user",
            "content": (
                f"Document:\n```latex\n{document_content[:8000]}\n```\n\n"
                f"Instruction: {instruction}"
                + (f"\nAdditional guidance for a different alternative: {variation_request}" if variation_request else "")
            ),
        },
    ]
    raw = await get_provider().json_completion(messages, max_tokens=4000)
    return _parse_diff_json(raw)


async def rewrite_diff(text: str, style: str, document_content: str, variation_request: str = "") -> dict:
    """Return a structured diff for simplify/summarize style rewrites."""
    messages = [
        {"role": "system", "content": build_rewrite_diff_system_prompt(text)},
        {
            "role": "user",
            "content": (
                f"Style: {style}\n"
                + (f"Rewrite this exact text from the document:\n```latex\n{text}\n```\n" if text else "Rewrite the document content directly.\n")
                + (f"Make it meaningfully different in this way: {variation_request}\n" if variation_request else "")
                + f"\nDocument:\n```latex\n{document_content[:8000]}\n```"
            ),
        },
    ]
    raw = await get_provider().json_completion(messages, max_tokens=5000)
    return _parse_diff_json(raw)


async def equation_diff(description: str, document_content: str, location: Optional[dict] = None, variation_request: str = "") -> dict:
    """Generate an equation and return a diff inserting it at the specified location."""
    messages = [
        {"role": "system", "content": build_equation_system_prompt(location)},
        {
            "role": "user",
            "content": (
                f"{description}\n"
                + (f"\nCreate a meaningfully different alternative with this guidance: {variation_request}\n" if variation_request else "")
                + f"\nDocument:\n```latex\n{document_content[:4000]}\n```"
            ),
        },
    ]
    raw = await get_provider().json_completion(messages, max_tokens=2000)
    return _parse_diff_json(raw)
