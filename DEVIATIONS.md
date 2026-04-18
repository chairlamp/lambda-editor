# Final Implementation Deviations

This document records the material ways the final submission differs from the earlier Assignment 1 design and, where relevant, from the Assignment 2 baseline. The goal is to keep those differences explicit and current so the repository does not hide tradeoffs behind stale documentation.

## Current Status

The earlier submission-risk items around testing depth, AI history logging, AI cancellation, stale AI suggestions, persistence-backed save confirmation, and the rich-text baseline gap have now been implemented in the codebase. The remaining product-level differences are architectural emphasis and workflow choices, not missing baseline coverage.

## Summary Table

| Area | Final implementation | Type | Impact |
| --- | --- | --- | --- |
| Editor model | Monaco + Yjs for LaTeX/text files plus TipTap rich-text documents for baseline formatting workflows | Architecture expansion | Baseline covered; product still LaTeX-first |
| Authentication | JWT access/refresh cookies with Redis-backed refresh rotation | Change from A1 design | Improvement, must be reported clearly |
| Sharing | Direct add by username/email plus invite links with revocation | Expansion over earlier scope | Improvement |
| AI architecture | Central prompt module, swappable provider layer, audit trail, cancellation, stale-diff safety | Maturation of earlier design | Improvement |
| Version history | Named snapshots and pre-restore snapshots instead of automatic background history | Simplification | Acceptable tradeoff |
| Export | `PDF`, `DVI`, and `PS`, not just PDF | Expansion | Improvement |
| Runtime/testing | `start.sh` local runtime plus Playwright E2E harness | Delivery-plan change | Improvement |

## 1. Editor Model: LaTeX-First Editing Plus Rich-Text Documents

**What changed**

Assignment 2 describes a rich-text editor baseline with constructs such as headings, bold, italic, lists, and code blocks. The codebase now supports that baseline through dedicated rich-text documents while still keeping the Overleaf-style technical workflow for LaTeX files. The shipped editor model therefore has two paths:

- Monaco + Yjs for collaborative LaTeX and plain-text file editing
- TipTap for rich-text documents with headings, bold, italic, lists, and code blocks
- path-based project files that can mix technical source files and rich-text notes in the same project

Relevant implementation files:

- `frontend/package.json`
- `frontend/src/components/Editor.tsx`
- `frontend/src/components/RichTextEditor.tsx`
- `frontend/src/pages/EditorPage.tsx`
- `backend/app/api/documents.py`

**Why this direction was chosen**

The product was intentionally optimized for collaborative technical authoring rather than general rich-text writing. That decision still fits equation-heavy, file-based, compile-and-preview workflows well, and it aligns with the “Overleaf remake” target the project ultimately pursued. Adding a proper rich-text document type closes the baseline rubric gap without removing the LaTeX-first workflow that defines the rest of the product.

**What this means for grading**

The previous rubric-fit mismatch on rich-text editing is now addressed. The remaining point to report honestly is that the product emphasis is still LaTeX-first and file-oriented, even though a compliant rich-text editor path is now included.

## 2. Authentication: JWT Cookie Pair Instead of Server-Side Sessions

**What changed**

The Assignment 1 design selected Redis-backed server sessions and explicitly rejected JWT as the final auth shape. The implemented system now uses:

- a short-lived JWT access token in an HTTP-only cookie
- a longer-lived JWT refresh token in an HTTP-only cookie
- refresh-token rotation and revocation backed by Redis

Relevant implementation files:

- `backend/app/api/auth.py`
- `frontend/src/services/api.ts`

**Why the implementation changed**

This approach keeps browser credentials out of JavaScript-accessible storage while still giving the app:

- short-lived access credentials
- explicit refresh rotation
- clean 401 recovery on the frontend
- revocable refresh state in Redis

**Impact**

This is a real deviation from the Assignment 1 design and had to be documented. It is an improvement in the final implementation, but it should be graded as a reported architecture change, not as if the original session-based plan were still what shipped.

## 3. Sharing Model: Both Direct Add and Invite Links

**What changed**

The earlier design discussion emphasized direct member management. The shipped system now supports both:

- direct add by username or email
- shareable invite links with pre-assigned role and revocation

Relevant implementation files:

- `backend/app/api/projects.py`
- `frontend/src/components/Toolbar.tsx`
- `frontend/src/pages/ProjectsPage.tsx`

**Why**

Invite links turned out to be the more flexible collaboration primitive because they work even before the invitee is already known to the inviter. Direct add was then implemented as well so the app satisfies the stricter sharing requirement cleanly.

**Impact**

This is an expansion over the earlier design rather than a compromise. The final system is stronger than the initial single-path sharing story.

## 4. AI Architecture: Central Prompts, Provider Abstraction, and Full Review/Audit Flow

**What changed**

The final AI stack is more structured than the earlier design draft and the early implementation. It now includes:

- centralized prompt templates
- a provider abstraction instead of hard-wiring all calls to one SDK
- persisted AI history with `provider`, `model`, `status`, and `error`
- cancellation across streaming and non-streaming AI actions
- stale-suggestion checks before applying collaborative diffs

Relevant implementation files:

- `backend/app/services/prompts.py`
- `backend/app/services/llm.py`
- `backend/app/api/ai.py`
- `backend/app/services/ai_audit.py`
- `backend/app/services/ai_cancellation.py`
- `frontend/src/components/AIChat.tsx`
- `frontend/src/components/DiffView.tsx`

**Why**

These changes were necessary to make the AI layer configurable, testable, and safer under real collaboration instead of leaving it as a thin wrapper around one provider and a best-effort review UI.

**Impact**

This is an improvement over the earlier design and also closes several gaps that were identified during later review. These items should no longer be treated as open implementation problems.

## 5. Version History: Named Snapshots Instead of Automatic Background History

**What changed**

The final product uses explicit version snapshots plus an automatic “pre-restore” snapshot when restoring an older version. It does not create automatic periodic history checkpoints on every save.

Relevant implementation files:

- `backend/app/api/versions.py`

**Why**

For a live collaborative editor, automatic background snapshots create noisy version history very quickly. Named checkpoints are more intentional, and the restore flow still remains safe because the system captures the current state before rolling back.

**Impact**

This is a deliberate simplification rather than a missing restore feature. Version restore is fully implemented, but the history model is more curated than the broader auto-history concept mentioned earlier.

## 6. Export and Compilation: Multi-Format Output Instead of PDF Only

**What changed**

Assignment 1 scoped advanced export beyond PDF out of scope. The final implementation supports:

- `PDF`
- `DVI`
- `PS`

Relevant implementation files:

- `backend/app/api/compile.py`
- `README.md`

**Why**

Once the LaTeX compile pipeline and project file tree were in place, supporting the additional output formats was a small incremental improvement with clear user value.

**Impact**

This is a positive deviation and should be treated as an implementation improvement beyond the earlier planned scope.

## 7. Runtime and Testing: Simpler Local Startup, Stronger Automated Validation

**What changed**

The Assignment 1 writeup described a more deployment-oriented runtime story. The final repository instead centers local development and grading around:

- `./start.sh` for one-command startup
- Docker-managed PostgreSQL and Redis for local runtime
- direct FastAPI and Vite dev servers
- Playwright browser E2E coverage with a deterministic fake LLM provider

Relevant implementation files:

- `start.sh`
- `frontend/playwright.config.ts`
- `frontend/e2e/auth-to-ai-acceptance.spec.ts`
- `backend/scripts/start-e2e-backend.sh`

**Why**

This shape makes the repository easier to run locally and easier to verify under grading conditions. The E2E harness also avoids requiring external model keys just to validate the full application flow.

**Impact**

This is a net improvement over the original delivery plan. The runtime story is simpler locally, and the testing story is stronger than what the project initially had.

## 8. Submission Notes on Resolved Review Items

The following areas were previously flagged during review and are now implemented in the current codebase:

- backend, frontend, and browser E2E testing coverage
- persisted AI interaction history metadata
- cancellable AI actions
- stale AI suggestion protection during collaboration
- persistence-backed save confirmation instead of timer-only save state

These are no longer open deviation-reporting issues and should not be described as missing functionality in the current submission.

## Final Position

The final submission is strongest when it is described honestly as a collaborative LaTeX-first editor with advanced AI and collaboration features that also includes a real rich-text document path for the baseline authoring requirements.

The most important point is therefore simple:

- the rich-text baseline gap has now been closed with a dedicated rich-text editor path
- the rest of the previously stale deviation reporting has now been corrected to match the codebase as it exists today
