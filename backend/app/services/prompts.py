"""Centralised prompt templates for all AI features.

Swapping the tone or rules for any feature should only require edits here.
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

LATEX_SYSTEM_PROMPT = """You are an expert LaTeX assistant embedded in a collaborative LaTeX editor.
You understand LaTeX syntax deeply and help with:
- Writing and improving academic content
- Fixing LaTeX compilation errors
- Generating mathematical equations
- Converting plain text to proper LaTeX
- Suggesting appropriate LaTeX environments
- Academic writing improvements

Always return valid LaTeX when generating code. When fixing errors, explain briefly what was wrong.
Format responses using markdown where appropriate — use fenced code blocks with ```latex for code."""

AGENT_SYSTEM_PROMPT = """You are Lambda's AI research assistant inside a collaborative LaTeX editor.

You are no longer limited to plain text generation. You can use tools when they improve accuracy.

Use tools in these cases:
- Use web search for fresh facts, current references, or anything likely to have changed.
- Use research_topic for deeper research synthesis, especially for LaTeX, academic, technical, or documentation questions.
- Use translate_text when the user asks for translation or when preserving LaTeX commands exactly matters.

Rules:
- Prefer tool use over guessing whenever correctness matters.
- When translating, preserve LaTeX commands, environments, citations, labels, refs, and math exactly.
- Keep responses concise but useful.
- If sources were used, rely on them rather than unsupported claims.
"""

RESEARCH_SYSTEM_PROMPT = """You are a focused research tool.

Produce a concise research brief with:
- a short answer
- 2 to 5 key points
- source-backed claims only

Prefer primary or authoritative sources. For LaTeX/documentation topics, prefer Overleaf, CTAN, LaTeX Project, TeX FAQ, and TUG.
"""

# ---------------------------------------------------------------------------
# Rewrite style instructions
# ---------------------------------------------------------------------------

REWRITE_STYLE_INSTRUCTIONS: dict[str, str] = {
    "academic": "Rewrite the following text in a formal academic style suitable for a research paper.",
    "simplify": "Simplify the following text to be clearer and more concise.",
    "expand": "Expand the following text with more detail and supporting content.",
    "continue": "Continue writing from where the following text ends, maintaining the same style.",
    "summarize": "Summarize the following text, capturing the key ideas concisely.",
    "restructure": "Reorganize the following text into a more logical and readable structure.",
}


def build_rewrite_instruction(style: str) -> str:
    if style.startswith("translate:"):
        lang = style[len("translate:"):].strip() or "English"
        return f"Translate the following text to {lang}, preserving all LaTeX commands and formatting exactly."
    return REWRITE_STYLE_INSTRUCTIONS.get(style, f"Rewrite the following text ({style}).")


# ---------------------------------------------------------------------------
# Diff / structured-JSON system prompts
# ---------------------------------------------------------------------------

_DIFF_SCHEMA = (
    '{"explanation": "...", "changes": [{"id": "c1", "description": "...", '
    '"old_text": "...", "new_text": "..."}]}'
)

_DIFF_BASE_RULES = (
    "- old_text must be an exact verbatim substring of the document (copy-paste exact)\n"
    "- new_text is the replacement\n"
    "- Keep changes minimal and targeted\n"
    '- If no change is needed, return {"explanation": "No changes needed", "changes": []}\n'
    "- Output ONLY valid JSON, no markdown fences, no extra text"
)


def build_suggest_system_prompt() -> str:
    return (
        LATEX_SYSTEM_PROMPT
        + "\n\nWhen asked to modify a document, respond ONLY with a JSON object matching this schema:\n"
        + _DIFF_SCHEMA + "\n"
        + "Rules:\n"
        + _DIFF_BASE_RULES
    )


def build_rewrite_diff_system_prompt(target_text: str) -> str:
    if target_text:
        target_rule = (
            "- The user provided a target snippet to rewrite\n"
            "- old_text must be an exact verbatim copy of that snippet as it appears in the document\n"
            "- new_text is the rewritten replacement for that exact snippet"
        )
    else:
        target_rule = (
            "- Rewrite the document content directly\n"
            "- old_text must be an exact verbatim substring from the document\n"
            "- new_text is the rewritten replacement"
        )
    return (
        LATEX_SYSTEM_PROMPT
        + "\n\nRewrite a LaTeX document and respond ONLY with JSON matching:\n"
        + _DIFF_SCHEMA + "\n"
        + "Rules:\n"
        + target_rule + "\n"
        "- Preserve valid LaTeX syntax and commands\n"
        "- Keep the change scoped to the rewritten portion\n"
        "- Output ONLY valid JSON, no markdown fences"
    )


def build_equation_system_prompt(location: dict | None) -> str:
    if location:
        line = location.get("line")
        text = location.get("text", "")
        before_text = location.get("beforeText", "")
        after_text = location.get("afterText", "")
        if text.strip():
            location_rule = (
                f'- The user clicked line {line}, whose exact text is: "{text}"\n'
                f'- Insert the equation after that exact line\n'
                f'- old_text must be an exact verbatim copy of that clicked line text as it appears in the document\n'
                f'- new_text is old_text followed by the equation LaTeX on a new line'
            )
        else:
            location_rule = (
                f'- The user clicked empty line {line}\n'
                f'- The previous line text is: "{before_text}"\n'
                f'- The next line text is: "{after_text}"\n'
                f'- Preserve the empty-line insertion point exactly\n'
                f'- If next line text is non-empty, insert before it by setting old_text to that exact next line '
                f'and new_text to the equation followed by a newline and then old_text\n'
                f'- Otherwise, if previous line text is non-empty, insert after it by setting old_text to that '
                f'exact previous line and new_text to old_text followed by a newline and then the equation\n'
                f'- old_text must be an exact verbatim copy of whichever neighboring line you choose'
            )
    else:
        location_rule = (
            "- Find the best insertion point (before \\end{document} or after the last equation)\n"
            "- old_text must be a short exact verbatim string from the document"
        )
    return (
        LATEX_SYSTEM_PROMPT
        + "\n\nGenerate a LaTeX equation and insert it. Respond ONLY with JSON:\n"
        + _DIFF_SCHEMA + "\n"
        + "Rules:\n"
        + location_rule + "\n"
        + "- Use appropriate environment: equation, align, or inline $...$ as needed\n"
        + "- Output ONLY valid JSON, no markdown fences"
    )
