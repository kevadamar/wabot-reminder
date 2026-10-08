# AGENTS.md

Instructions, architecture pointers, and coding conventions for AI agents working on the WhatsApp Task & Reminder Bot.

---

## 1. Project Orientation & Pointers

- **Domain Model & Glossary**: Consult [CONTEXT.md](file:///Users/Keva/Desktop/Research/automation/todo-reminder-bot/CONTEXT.md) before naming concepts or refactoring interfaces. Use canonical terms (`Task`, `Deadline`, `Reminder Time`, `User Settings`) and respect `_Avoid_` directives.
- **System Architecture**: Read [docs/ARCHITECTURE.md](file:///Users/Keva/Desktop/Research/automation/todo-reminder-bot/docs/ARCHITECTURE.md) for data flow, sequence diagrams, and component boundaries.
- **Architecture Decisions**: Check [docs/adr/](file:///Users/Keva/Desktop/Research/automation/todo-reminder-bot/docs/adr/) for rationale behind PostgreSQL adoption ([0001](file:///Users/Keva/Desktop/Research/automation/todo-reminder-bot/docs/adr/0001-postgresql-for-task-storage.md)) and DB-backed settings ([0002](file:///Users/Keva/Desktop/Research/automation/todo-reminder-bot/docs/adr/0002-database-backed-settings.md)).
- **Product Requirements**: Full specifications are in [docs/PRD-to-do-bot-reminder.md](file:///Users/Keva/Desktop/Research/automation/todo-reminder-bot/docs/PRD-to-do-bot-reminder.md).

---

## 2. Tech Stack & Environment

- **Runtime**: Bun (`bun v1.2+`). Default to Bun APIs over Node.js equivalents.
- **WhatsApp Library**: `@whiskeysockets/baileys` (v7 Native ESM).
- **Database**: PostgreSQL 16 via `drizzle-orm` and `postgres.js`.
- **NLP / AI**: configurable provider chain (`src/services/llm/`). Gemini via `@google/genai`, OpenAI-compatible and Anthropic via `fetch`, Antigravity bridge, then `chrono-node` local fallback.
- **Testing**: `bun:test` built-in test runner.

---

## 3. Critical Developer Commands

If the `rtk` CLI is installed (maintainer setup), prefix shell commands with `rtk`; otherwise run them as-is.

```bash
# Typecheck (Run regularly across all edits)
bun run typecheck

# Run test suite
bun test

# Run single test file
bun test test/services/nlp.test.ts

# Apply Drizzle database migrations / schema push
bun run db:push

# Generate Drizzle migration files
bun run db:generate
```

---

## 4. Coding Standards & Architectural Seams

All new features and bug fixes must respect the 5 pre-agreed architectural seams:

1. **Seam 1 (`src/services/nlp.ts`)**: Task intent and temporal extraction. Try the configured LLM chain (`LLM_CHAIN_NLP`), then fall back to `parseLocalTask`. `local` stays last. Do not hardcode a single provider.
2. **Seam 2 (`src/services/reminder.ts`)**: Adaptive reminder calculation and interval dispatcher. Never block the scheduler; log failures and continue to the next task.
3. **Seam 3 (`src/services/task.ts`)**: Pure database CRUD operations using Drizzle. Keep SQL queries type-safe and return typed records.
4. **Seam 4 (`src/services/affirmation.ts`)**: Congratulatory messaging. Never fail if every provider is unavailable; fall back to `src/data/affirmations.json`.
5. **Seam 5 (`src/bot/handlers/router.ts`)**: WhatsApp message and reaction routing. Protect against unauthorized users via `user_settings.is_allowed`.

---

## 5. Rules for Agents

- **Zero Unhandled Exceptions**: Baileys socket listeners must wrap handler calls in try-catch blocks to prevent connection crashes.
- **No Direct Mutation of Schema without Drizzle**: Modify [src/db/schema.ts](file:///Users/Keva/Desktop/Research/automation/todo-reminder-bot/src/db/schema.ts) first, then run `bun run db:push`.
- **Timezone Awareness**: All database timestamps must use `timestamp({ withTimezone: true })` (stored in UTC). Local presentation must format through `formatDateTime(date, user.timezone)`.
- **TDD Requirement**: When modifying business logic, add tests to `test/` following the *Red → Green* pattern and run `bun test` before completing your work.
