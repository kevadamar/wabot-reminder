# Product Requirements Document (PRD)
**Project Name:** WhatsApp Task & Reminder Bot  
**Platform:** WhatsApp (via `@whiskeysockets/baileys`)  
**Runtime:** Bun Runtime  
**Status:** Approved & Ready for Implementation  

## 1. Overview
A lightweight WhatsApp bot designed to help users capture and manage their tasks effortlessly. Users can chat directly or forward messages to the bot to create tasks. The bot uses Gemini AI (with a local NLP fallback) to extract tasks and deadlines in natural Indonesian, calculates adaptive reminder alerts, alerts users before due dates, and celebrates task completion (marked via ✅ emoji reaction, reply, or command) with dynamic, positive affirmations.

## 2. Tech Stack & Infrastructure
*   **Runtime:** [Bun](https://bun.sh/) (Fast, lightweight, native TypeScript execution).
*   **WhatsApp Library:** `@whiskeysockets/baileys` (Socket-based, no browser overhead).
*   **Auth Storage:** Multi-file auth state (`useMultiFileAuthState`) stored in an isolated Docker volume (`./auth_info`).
*   **Database:** PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/) & `postgres.js` driver (Type-safe, scalable, easily managed via GUI).
*   **Natural Language Processing (NLP):**
    *   **Primary:** Gemini 1.5 Flash (Free tier: 15 RPM / 1,500 req/day) for structured task name and deadline extraction from colloquial Indonesian.
    *   **Fallback:** Local Indonesian temporal pre-normalizer dictionary + `chrono-node` (English engine) for zero-network/quota fallback.
*   **Dynamic Affirmations:** Gemini 1.5 Flash (Primary) with local fallback quotes in `affirmations.json`.
*   **Target Server Resource:** 1 vCPU, 512MB - 1GB RAM (VPS / Docker container).

## 3. Core Features & User Workflows

### Feature 1: Task Ingestion & Intent Filtering
*   **Forwarded Messages:** Automatically treated as incoming tasks (`contextInfo.isForwarded = true`).
*   **Direct Messages:** Evaluated for task intent (imperative action verbs like *beli, kirim, kerjakan, rapat, deadline, hubungi, bayar*, or explicit `/todo` command). Casual greetings (*halo, hai, pagi, test*) are answered politely without registering fake tasks.
*   **Access Control:** Only allowed users (`is_allowed = true` in `user_settings`) can record tasks. Unauthorized numbers receive a gentle polite private bot notice or are ignored.

### Feature 2: Smart Deadline Detection & Context Mapping
*   **Scenario A (Time Detected):**
    *   Task saved to PostgreSQL with status `pending`.
    *   `deadline` set to extracted UTC timestamp.
    *   `remind_at` calculated adaptively based on distance:
        *   Deadline > 2 hours away: `remind_at = deadline - 30 minutes`.
        *   Deadline 30 mins to 2 hours away: `remind_at = deadline - 15 minutes`.
        *   Deadline < 30 mins away: `remind_at = deadline`.
    *   Reply: *"✅ Tugas dicatat! 📝: [Task Name] ⏰: [Deadline Display in WIB]. Aku akan ingatkan mendekati waktu tersebut."*
*   **Scenario B (No Time Detected):**
    *   Task saved with status `pending_deadline`.
    *   Reply asks for deadline with preset suggestions (`1️⃣ Nanti Sore (17:00)`, `2️⃣ Besok Pagi (09:00)`).
    *   **Context Resolution:** Next response from user is mapped to the pending task via quoted message ID (`stanzaId`) or fallback to the user's latest active `pending_deadline` task within 10 minutes.

### Feature 3: Adaptive Reminder System (Cron Worker)
*   **Action:** Background interval running every 1 minute.
*   **Logic:**
    *   Queries `tasks` where `status = 'pending'`, `reminded = 0`, and `remind_at <= NOW()`.
    *   Sends reminder alert: *"⏰ Halo! Sekadar mengingatkan, tugas '[Task Name]' akan jatuh tempo pada [Deadline WIB]. Semangat!"*
    *   Updates `reminded = 1` and logs the sent message ID into `task_messages`.
    *   If a task is unresolved and `deadline < NOW()` (overdue), sends a single overdue alert: *"⚠️ Tugas '[Task Name]' telah melewati batas waktu!"*

### Feature 4: Task Resolution (Reaction, Reply, or Command)
*   **Triggers:**
    1.  **WhatsApp Emoji Reaction:** User clicks "✅" reaction on any bot message associated with the task (matched via `task_messages`).
    2.  **Quoted Text Reply:** User replies with "✅" to a task or reminder bubble.
    3.  **Command:** User sends `/selesai <ID>` or `selesai <ID>`.
*   **Action:**
    *   Update task status to `resolved`.
    *   Trigger dynamic affirmation.

### Feature 5: Dynamic Positive Affirmations
*   **Trigger:** Task successfully marked `resolved`.
*   **Action:** Generate a non-repetitive, encouraging message in natural, casual Indonesian.
*   **Primary:** Gemini 1.5 Flash prompt (*"Berikan satu kalimat afirmasi positif, gaul, dan menyemangati untuk seseorang yang baru menyelesaikan tugas: [Task Name]"*).
*   **Fallback:** Random selection from local `affirmations.json`.
*   **Output:** *"🎉 Hebat! Tugas selesai: [Task Name]\n\n[Affirmation Message]"*

### Feature 6: Task Inspection & Management Commands
*   **`/list` / `daftar`**: Returns active pending tasks with their IDs, formatted friendly in Indonesian with relative time.
*   **`/batal <ID>` / `hapus <ID>`**: Cancels a task, marking status `cancelled`.
*   **`/help` / `bantuan`**: Displays a warm, non-technical guide explaining how to use the bot.

## 4. Database Schema (PostgreSQL via Drizzle)

### Table: `user_settings`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `user_jid` | VARCHAR(128) | PK | User WhatsApp JID (e.g. `628123456789@s.whatsapp.net`) |
| `name` | VARCHAR(128) | Nullable | Optional contact/display name |
| `timezone` | VARCHAR(64) | Default: `'Asia/Jakarta'` | User timezone for date parsing and display |
| `lead_reminder_minutes` | INTEGER | Default: `30` | Default advance reminder lead time in minutes |
| `is_allowed` | BOOLEAN | Default: `false` | Access whitelist control |
| `created_at` | TIMESTAMPTZ | Default: `NOW()` | Registration timestamp |
| `updated_at` | TIMESTAMPTZ | Default: `NOW()` | Last configuration update timestamp |

### Table: `tasks`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | SERIAL | PK | Auto-increment task ID |
| `user_jid` | VARCHAR(128) | References `user_settings(user_jid)` | Owner of the task |
| `task` | TEXT | Not Null | Task description cleaned of temporal markers |
| `deadline` | TIMESTAMPTZ | Nullable | Scheduled completion deadline |
| `remind_at` | TIMESTAMPTZ | Nullable | Calculated time to send notification alert |
| `status` | VARCHAR(32) | Default: `'pending_deadline'` | `pending_deadline`, `pending`, `resolved`, `cancelled` |
| `reminded` | SMALLINT | Default: `0` | `0` = not reminded, `1` = reminded, `2` = overdue alerted |
| `created_at` | TIMESTAMPTZ | Default: `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Default: `NOW()` | Last state modification timestamp |

### Table: `task_messages`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | SERIAL | PK | Auto-increment mapping ID |
| `task_id` | INTEGER | References `tasks(id)` ON DELETE CASCADE | Associated task ID |
| `message_id` | VARCHAR(128) | Not Null, Index | WhatsApp message ID (`key.id`) sent by bot |
| `created_at` | TIMESTAMPTZ | Default: `NOW()` | Message dispatch timestamp |

## 5. Implementation Architecture & Directory Layout
```text
todo-reminder-bot/
├── .env.example              # DATABASE_URL, GEMINI_API_KEY
├── Dockerfile                # Bun container with timezone support
├── docker-compose.yml        # PostgreSQL container + Bot service + auth_info volume
├── drizzle.config.ts         # Drizzle kit migration configuration
├── src/
│   ├── config/               # Environment & constant loaders
│   ├── db/                   # Drizzle schema, connection pool, migrations
│   │   ├── schema.ts         # Table definitions (tasks, task_messages, user_settings)
│   │   └── index.ts          # Postgres.js client setup
│   ├── services/
│   │   ├── nlp.ts            # Gemini extraction with chrono-node fallback
│   │   ├── affirmation.ts    # Gemini dynamic affirmation generator + local JSON fallback
│   │   ├── reminder.ts       # Cron worker checking remind_at <= NOW()
│   │   └── task.ts           # Task lifecycle (create, resolve, cancel, list)
│   ├── bot/
│   │   ├── client.ts         # Baileys socket setup, QR code, auth_info handler
│   │   ├── handlers/         # Message, reaction, and command routers
│   │   └── index.ts          # Bot bootstrap
│   ├── data/
│   │   └── affirmations.json # Fallback affirmation quotes
│   └── index.ts              # Application entrypoint
├── CONTEXT.md                # Domain model & vocabulary
└── docs/adr/                 # Architecture Decision Records
```

## 6. Verification & Quality Plan
1. **NLP Parsing Verification:** Test various colloquial Indonesian formats (*"besok siang jam 2"*, *"senin depan abis maghrib"*, *"30 menit lagi"*).
2. **Context Resolution Verification:** Verify multi-step conversation when a task is sent without a deadline.
3. **Reaction & Reply Completion:** Test marking complete with both native WhatsApp emoji reaction and text reply.
4. **Reminder Alerting:** Verify reminder triggers accurately at `remind_at` and doesn't duplicate.
5. **Docker & Auth Persistence:** Verify reconnecting without re-scanning QR code across container restarts.