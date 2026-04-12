# Architecture Deviations from Assignment 1 Design

This document records every difference between our Assignment 1 design and the final implementation, along with the reason for each change and whether the outcome was an improvement or a compromise.

---

## 1. Authentication: Session cookies instead of JWT

**What changed:** Assignment 1 specified JWT access tokens (15–30 min) with silent refresh via refresh tokens. The implementation uses opaque session IDs stored in Redis and delivered as HTTP-only cookies (`lambda_session`, 7-day TTL).

**Why:** HTTP-only cookies eliminate the entire class of XSS-based token theft. There is no JavaScript-accessible token to steal. Server-side sessions also allow instant revocation (delete the Redis key) without waiting for a JWT to expire — useful for logout and role changes.

**Trade-off:** This deviates from the assignment's stated JWT requirement. In a distributed deployment across many backend instances, Redis must be reachable by all instances (which it is, since Redis is already required for CRDT pub/sub). The token lifecycle cannot be explained in JWT terms (iss, exp, aud claims, refresh grant), which is a grading risk.

**Verdict:** Improvement for security; compromise for rubric compliance. The deviation is intentional and justified here.

---

## 2. Editor: Monaco instead of a rich-text editor

**What changed:** Assignment 1 described a rich-text editor (e.g., Tiptap/ProseMirror) for general document editing. The implementation uses Monaco Editor, a code editor.

**Why:** The project is specifically a LaTeX editor — a domain where syntax highlighting, snippet completion, and monospace display are more important than WYSIWYG bold/italic. Monaco's y-monaco binding (CRDT integration) is mature and battle-tested, whereas rich-text CRDT integration (e.g., Tiptap + Yjs) is more complex and has more edge cases.

**Trade-off:** General documents lack formatting controls (headings, bold, lists, code blocks) as required by the rubric's baseline for 1.2. LaTeX documents do not need these as structured text; they author formatting via commands.

**Verdict:** Improvement for the LaTeX use case; compromise for baseline rubric compliance.

---

## 3. Sharing: Invite links instead of email/username direct add

**What changed (original design):** Assignment 1 described sharing by typing a username/email to add them directly. The initial implementation shipped with only invite links (UUID tokens, max 3 per project).

**What is now implemented:** Both mechanisms are available. `POST /projects/{project_id}/members` accepts a `username_or_email` field and adds the user directly with a specified role. The Toolbar UI exposes this via the "Add member" (UserPlus icon) button.

**Why invite links were built first:** They are stateless and do not require the inviter to know whether the target user has registered yet. The direct-add flow was added as the assignment's sharing requirement made it mandatory.

**Verdict:** Both are now implemented. No compromise.

---

## 4. Real-time sync: Two WebSocket channels per document

**What changed:** Assignment 1 described a single WebSocket for all collaboration. The implementation uses two WebSocket connections per open document:

| Channel | Path | Protocol | Purpose |
|---|---|---|---|
| JSON channel | `/ws/{doc_id}` | JSON text frames | Presence, cursors, typing indicators, AI chat relay, compile results, title |
| CRDT channel | `/ws/{doc_id}/sync` | Binary y-websocket protocol | Document text (Yjs CRDT) |

**Why:** The Yjs y-websocket library expects a dedicated binary protocol. Multiplexing binary CRDT frames and JSON events over the same connection would require a framing layer and custom protocol — unnecessary complexity when two connections are cheap.

**Verdict:** Improvement. Clean separation of concerns; presence/UI events do not block or delay document sync.

---

## 5. CRDT state backed by Redis, not in-process memory

**What changed:** Assignment 1 assumed CRDT state lived in memory on the backend. The implementation stores the authoritative merged Yjs state in Redis (`doc:{doc_id}:state`) and uses a per-document pub/sub channel for cross-instance fan-out.

**Why:** In-process CRDT state is lost on restart. Redis makes the state durable between restarts and allows multiple backend instances to share state without a separate coordination service.

**Verdict:** Improvement. Enables horizontal scaling and survives backend restarts without data loss.

---

## 6. AI prompts: Centralised prompt module

**What changed:** Prompts were originally hardcoded inline inside `ai_service.py` and `agent_service.py`. They are now extracted into `app/services/prompts.py`.

**Why:** The assignment rubric explicitly requires configurable (non-hardcoded) prompt templates. Centralising them in one module makes it trivial to tune wording, add new styles, or adapt to a different domain without touching service logic.

**Verdict:** Improvement. Required by the rubric.

---

## 7. LLM provider: Abstract interface instead of direct OpenAI calls

**What changed:** `ai_service.py` previously called `AsyncOpenAI` directly. An `LLMProvider` abstract base class now lives in `app/services/llm.py`. `OpenAIProvider` implements it. Service functions call `get_provider().stream_completion(...)` and `get_provider().json_completion(...)`.

**Why:** The assignment rubric requires that swapping LLM providers require changes in one place. The factory function `get_provider()` and `set_provider()` satisfy this. Swapping to Anthropic, Gemini, or a local model only requires a new `LLMProvider` subclass and one line change in `get_provider()`.

**Verdict:** Improvement. Required by the rubric.

---

## 8. Version history: Named snapshots only (no automatic history)

**What changed:** Assignment 1 mentioned automatic version history. The implementation creates versions on explicit user action ("Save snapshot") and on version restore (auto pre-restore snapshot). There is no automatic periodic snapshotting.

**Why:** Automatic snapshots on every save would create hundreds of low-value versions quickly. Named snapshots give users intentional checkpoints.

**Verdict:** Deliberate design choice. No compromise to core functionality; restore works correctly.

---

## 9. Compilation: Local binary detection, no cloud fallback

**What changed:** Assignment 1 did not specify how compilation would work. The implementation shells out to a locally installed `pdflatex`, `xelatex`, `lualatex`, or `tectonic` binary.

**Why:** Cloud-based LaTeX compilation services (e.g., Overleaf API) are not freely accessible. A local binary is zero-cost and keeps compilation fast (no network round-trip). The binary probe runs at compile time with user-friendly error messages if none is found.

**Trade-off:** Reviewers must have a LaTeX compiler installed. The README documents this as a prerequisite.

**Verdict:** Practical compromise. Works correctly when prerequisites are met.

---

## 10. AI agent: OpenAI Responses API instead of standard chat completions

**What changed:** The chat/agent endpoint uses the OpenAI Responses API (`/v1/responses`) with built-in `web_search` and custom `function` tools. Assignment 1 described a standard chat-based agent.

**Why:** The Responses API provides server-side tool orchestration and a `previous_response_id` continuation model, which simplifies multi-turn tool-use loops. The agent can perform up to 4 tool-use iterations per user turn without additional client-side state.

**Trade-off:** The Responses API is OpenAI-specific. The `agent_service.py` module uses `httpx` directly (not the OpenAI SDK) because the SDK did not fully support Responses API at implementation time. This makes the agent path slightly harder to abstract behind `LLMProvider`.

**Verdict:** Feature improvement; minor portability compromise for the agent path specifically.

---

## 11. Streaming cancellation: AbortController on the client

**What changed:** Assignment 1 did not specify a mechanism for stopping in-progress AI generation. The implementation adds a Stop button to the AI chat header that aborts the active SSE stream mid-flight using the browser's `AbortController` API.

**Why:** Long AI responses (rewrite, research) can take many seconds. Without cancellation, users cannot interrupt a generation that is going in the wrong direction. The `AbortController` signal is threaded through `streamAI()` to the underlying `fetch` call; an `AbortError` is caught and treated as a clean `onDone()` so no error state is shown.

**Verdict:** Improvement. Standard browser API, zero server-side changes required.

---

## 12. Typing indicators via WebSocket

**What changed:** The JSON WebSocket channel now carries `typing` events. When a user edits locally, a `typing: true` event is broadcast to peers; a `typing: false` event is sent after 3 seconds of silence. The Toolbar displays a "username is typing…" indicator to other collaborators.

**Why:** Assignment 1 listed real-time collaboration awareness as a requirement. Cursor presence alone does not communicate active typing. The 3-second debounce avoids flooding the channel on every keystroke.

**Verdict:** Improvement. Adds meaningful collaboration signal with minimal bandwidth overhead.

---

## 13. UI design system: centralised token module

**What changed:** All inline colour strings and style fragments across every component were replaced with references to a single `frontend/src/design.ts` module that exports a `C` (colours) and `S` (style fragments) object.

**Why:** Assignment 1 had no design specification. The codebase had dozens of duplicated magic strings (`#0f0f23`, `#4f46e5`, `#1e1e3a`, etc.) spread across 15+ files, making visual consistency difficult to maintain. A single token file means any colour change propagates everywhere.

**Verdict:** Improvement. No functional change; purely a maintainability and consistency improvement.
