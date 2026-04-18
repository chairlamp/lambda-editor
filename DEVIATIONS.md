# Architecture Deviations from Assignment 1 Design

This document records every difference between our Assignment 1 design and the final implementation, along with the reason for each change and whether the outcome was an improvement or a compromise.

---

## 1. Authentication: Session cookies instead of JWT

**What changed:** Assignment 1 specified JWT access tokens (15–30 min) with silent refresh via refresh tokens. The implementation uses opaque session IDs stored in Redis and delivered as HTTP-only cookies (`lambda_session`, 7-day TTL).

**Why:** HTTP-only cookies eliminate the entire class of XSS-based token theft. There is no JavaScript-accessible token to steal. Server-side sessions also allow instant revocation (delete the Redis key) without waiting for a JWT to expire — useful for logout and role changes.

**Trade-off:** This deviates from the assignment's stated JWT requirement. In a distributed deployment across many backend instances, Redis must be reachable by all instances (which it is, since Redis is already required for CRDT pub/sub). The token lifecycle cannot be explained in JWT terms (iss, exp, aud claims, refresh grant), which is a grading risk.

**Verdict:** Improvement for security; compromise for rubric compliance. The deviation is intentional and justified here.

---

## 2. Sharing: Invite links instead of email/username direct add

**What changed (original design):** Assignment 1 described sharing by typing a username/email to add them directly. The initial implementation shipped with only invite links (UUID tokens, max 3 per project).

**What is now implemented:** Both mechanisms are available. `POST /projects/{project_id}/members` accepts a `username_or_email` field and adds the user directly with a specified role. The Toolbar UI exposes this via the "Add member" (UserPlus icon) button.

**Why invite links were built first:** They are stateless and do not require the inviter to know whether the target user has registered yet. The direct-add flow was added as the assignment's sharing requirement made it mandatory.

**Verdict:** Both are now implemented. No compromise.

---

## 3. AI prompts: Centralised prompt module

**What changed:** Prompts were originally hardcoded inline inside `ai_service.py` and `agent_service.py`. They are now extracted into `app/services/prompts.py`.

**Why:** The assignment rubric explicitly requires configurable (non-hardcoded) prompt templates. Centralising them in one module makes it trivial to tune wording, add new styles, or adapt to a different domain without touching service logic.

**Verdict:** Improvement. Required by the rubric.

---

## 4. LLM provider: Abstract interface instead of direct OpenAI calls

**What changed:** `ai_service.py` previously called `AsyncOpenAI` directly. An `LLMProvider` abstract base class now lives in `app/services/llm.py`. `OpenAIProvider` implements it. Service functions call `get_provider().stream_completion(...)` and `get_provider().json_completion(...)`.

**Why:** The assignment rubric requires that swapping LLM providers require changes in one place. The factory function `get_provider()` and `set_provider()` satisfy this. Swapping to Anthropic, Gemini, or a local model only requires a new `LLMProvider` subclass and one line change in `get_provider()`.

**Verdict:** Improvement. Required by the rubric.

---

## 5. Version history: Named snapshots only (no automatic history)

**What changed:** Assignment 1 mentioned automatic version history. The implementation creates versions on explicit user action ("Save snapshot") and on version restore (auto pre-restore snapshot). There is no automatic periodic snapshotting.

**Why:** Automatic snapshots on every save would create hundreds of low-value versions quickly. Named snapshots give users intentional checkpoints.

**Verdict:** Deliberate design choice. No compromise to core functionality; restore works correctly.

---

## 6. Streaming cancellation

**What changed:** Assignment 1 did not specify a mechanism for stopping in-progress AI generation. The implementation adds a Stop button to the AI chat header that aborts the active SSE stream mid-flight using the browser's `AbortController` API.

**Why:** Long AI responses (rewrite, research) can take many seconds. Without cancellation, users cannot interrupt a generation that is going in the wrong direction. The `AbortController` signal is threaded through `streamAI()` to the underlying `fetch` call; an `AbortError` is caught and treated as a clean `onDone()` so no error state is shown.

**Verdict:** Improvement. Standard browser API, zero server-side changes required.

---

## 7. UI design system: centralised token module

**What changed:** All inline colour strings and style fragments across every component were replaced with references to a single `frontend/src/design.ts` module that exports a `C` (colours) and `S` (style fragments) object.

**Why:** Assignment 1 had no design specification. The codebase had dozens of duplicated magic strings (`#0f0f23`, `#4f46e5`, `#1e1e3a`, etc.) spread across 15+ files, making visual consistency difficult to maintain. A single token file means any colour change propagates everywhere.

**Verdict:** Improvement. No functional change; purely a maintainability and consistency improvement.
