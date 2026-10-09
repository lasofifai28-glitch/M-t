# Implementation Plan

## Phase 1 — Audit and architecture
- Confirmed the workspace was empty.
- Chosen stack: Express + SQLite + Socket.IO + React + Vite.
- Backend will provide auth, persistence, upload handling, and signaling.
- Frontend will provide the actual web UI and WebRTC call controls.

## Phase 2 — Foundation
- Create monorepo structure.
- Install required dependencies.
- Add a SQLite schema with users, conversations, messages, attachments, receipts, and sessions.
- Implement JWT auth and file upload routes.

## Phase 3 — Messaging
- Create direct conversations and list them.
- Add message persistence and retrieval.
- Emit socket events for new messages and typing.
- Support basic read receipts and presence.

## Phase 4 — Media
- Accept uploads from the browser.
- Save metadata in SQLite and files to local uploads folder.
- Serve authorized attachments.

## Phase 5 — Calling
- Add signaling endpoints and client-side WebRTC logic.
- Support audio/video calls with STUN relay.
- Document need for TURN and HTTPS in production.

## Phase 6 — UX and security
- Add responsive UI with login, register, chat, and call screens.
- Continue with validation, rate limits, and file restrictions.

## Phase 7 — Verification
- Run tests and production build.
- Document limitations and next steps.
