# System Architecture & Technical Design

This document details the software architecture, data flow, component boundaries, and resiliency patterns for the WhatsApp Task & Reminder Bot.

---

## 1. High-Level Architecture

The system is designed as a modular, lightweight daemon executed under the **Bun** runtime. It maintains a persistent WebSocket connection to WhatsApp using `@whiskeysockets/baileys` and connects to **PostgreSQL** via Drizzle ORM.

```mermaid
flowchart TD
    User["📱 WhatsApp User"]
    
    subgraph Host["Bun Runtime & Host Services"]
        Baileys["Baileys Socket Client (v7)<br/>@whiskeysockets/baileys"]
        Router["Message & Reaction Router<br/>src/bot/handlers/router.ts"]
        
        subgraph Services["Core Domain Services"]
            NLP["NLP Intent & Deadline Parser<br/>src/services/nlp.ts"]
            TaskSvc["Task Management Service<br/>src/services/task.ts"]
            ReminderWorker["Reminder Cron Worker<br/>src/services/reminder.ts"]
            AffirmSvc["Affirmation Service<br/>src/services/affirmation.ts"]
        end
        
        AgyBridge["Antigravity CLI Host Bridge<br/>scripts/antigravity-bridge.ts :7860"]
        LocalParser["Local Chrono + ID Normalizer<br/>(Offline Fallback)"]
        LocalQuotes["Local Affirmations JSON<br/>src/data/affirmations.json"]
    end
    
    subgraph External["External Cloud & Storage"]
        Gemini["Google Gemini 1.5 Flash<br/>(AI Studio API)"]
        Postgres[("PostgreSQL 16 Database<br/>todo_bot")]
        AuthStore[("Local Auth Directory<br/>./auth_info")]
    end

    User <-->|Encrypted WebSockets| Baileys
    Baileys <-->|Auth State| AuthStore
    Baileys -->|Events: upsert, reaction| Router
    
    Router -->|1. Extract Intent & Time| NLP
    NLP -->|Tier 1: Cloud API| Gemini
    NLP -.->|Tier 2: Host CLI Fallback| AgyBridge
    NLP -.->|Tier 3: Offline Regex/Chrono| LocalParser
    
    Router -->|2. Create / Resolve / List| TaskSvc
    TaskSvc <-->|Drizzle ORM| Postgres
    
    Router -->|3. Generate Celebration| AffirmSvc
    AffirmSvc -->|Tier 1: Cloud API| Gemini
    AffirmSvc -.->|Tier 2: Host CLI Fallback| AgyBridge
    AffirmSvc -.->|Tier 3: Local Quotes| LocalQuotes
    
    ReminderWorker -->|Poll due tasks every 60s| Postgres
    ReminderWorker -->|Dispatch alerts| Baileys
```

---

## 2. Core Components & Responsibilities

| Component | Path | Responsibility |
| :--- | :--- | :--- |
| **Client Manager** | `src/bot/client.ts` | Manages Baileys socket lifecycle, QR code generation in terminal, auth credentials persistence in `./auth_info`, and initiates background interval timers. |
| **Router** | `src/bot/handlers/router.ts` | Dispatches incoming messages, validates whitelist permissions, handles commands (`/help`, `/list`, `/selesai`, `/batal`), maps quoted replies, and processes emoji reactions. |
| **NLP Service** | `src/services/nlp.ts` | Classifies task intent, strips conversational noise, normalizes Indonesian temporal phrases, extracts deadline timestamps, and delegates to the configured LLM chain with a local parser as the last tier. |
| **LLM chain** | `src/services/llm/` | Provider adapters (Gemini, OpenAI-compatible, Anthropic, Antigravity), per-attempt cancellation, total time budget, output validation, and a circuit breaker per provider. Order comes from `LLM_CHAIN_*`. |
| **Task Service** | `src/services/task.ts` | Handles database operations (`tasks`, `task_messages`, `user_settings`), status transitions (`pending_deadline`, `pending`, `resolved`, `cancelled`), and message-to-task correlation. |
| **Reminder Worker** | `src/services/reminder.ts` | Calculates adaptive `remind_at` offsets, queries due and overdue tasks every 60 seconds, dispatches alerts, and updates notification flags. |
| **Morning Digest** | `src/services/morning-digest.ts` | Dispatches opt-in daily morning task summaries at configured local time with cached AI/local pantun motivation. |
| **Media Service** | `src/services/media.ts` | Multi-layer media validation (magic bytes), CDR sanitization via Sharp (configurable 4K high vs 2K compact), S3/local storage, and AI screening. |
| **Telemetry Service** | `src/services/telemetry.ts` | Records hourly aggregated runtime metrics, sanitizes and logs error events, and feeds dashboard telemetry. |
| **Monitoring Dashboard** | `src/dashboard/server.ts` | Lightweight HTTP Basic Auth web dashboard (port 3080) for real-time monitoring of bot status, socket, memory, tasks, and telemetry. |
| **Affirmation Service** | `src/services/affirmation.ts` | Produces positive congratulatory feedback tailored to the completed task using Gemini 1.5 Flash or local curated Indonesian affirmations. |
| **Database Pool** | `src/db/index.ts` & `src/db/schema.ts` | Configures `postgres.js` connection pool and declares type-safe Drizzle ORM schemas. |

---

## 3. Data Flows & Workflows

### 3.1 Task Ingestion & Adaptive Reminder Calculation

```mermaid
sequenceDiagram
    autonumber
    actor User as WhatsApp User
    participant Router as Message Router
    participant NLP as NLP Service
    participant Gemini as Gemini AI
    participant DB as PostgreSQL
    
    User->>Router: "Besok jam 2 siang meeting sama klien, ingatkan 30 menit sebelumnya"
    Router->>NLP: parseTaskMessage(text)
    
    alt Gemini Available
        NLP->>Gemini: Prompt structured task JSON (with reminderLeadMinutes)
        Gemini-->>NLP: { isTask: true, taskTitle: "meeting sama klien", deadline: ISO, reminderLeadMinutes: 30 }
    else Gemini Offline / Limit
        NLP->>NLP: Local dictionary + chrono.en parse + extractExplicitReminderLead()
    end
    
    NLP-->>Router: ParseResult (isTask: true, deadline: Date, reminderLeadMinutes: 30)
    Router->>Router: calculateRemindAt(deadline, { userSettingLead, overrideLead: 30 }) -> T - 30 minutes
    Router->>DB: createTask({ task, deadline, remindAt, status: 'pending' })
    DB-->>Router: Task Record (ID: 15)
    Router->>User: "✅ Tugas Dicatat! 📝: meeting sama klien ⏰ Deadline: Besok, 14:00 (Pengingat: 30 menit sebelum)"
    Router->>DB: linkTaskMessage(15, botReplyMessageId)
```

### 3.2 Task Resolution via Reaction or Reply

```mermaid
sequenceDiagram
    autonumber
    actor User as WhatsApp User
    participant Baileys as Baileys Client
    participant Router as Message Router
    participant TaskSvc as Task Service
    participant AffirmSvc as Affirmation Service
    participant DB as PostgreSQL
    
    User->>Baileys: Reacts with ✅ on Reminder Bubble
    Baileys->>Router: handleIncomingReaction({ key: { id, remoteJid }, reaction: "✅" })
    Router->>TaskSvc: findTaskByMessageId(key.id)
    TaskSvc->>DB: Query task_messages JOIN tasks
    DB-->>TaskSvc: Matched Task (ID: 15, "meeting sama klien")
    
    Router->>TaskSvc: resolveTask(15, remoteJid)
    TaskSvc->>DB: UPDATE tasks SET status = 'resolved'
    
    Router->>AffirmSvc: generateAffirmation("meeting sama klien")
    AffirmSvc-->>Router: "Keren banget! Meeting sukses, kamu luar biasa!"
    Router->>User: "🎉 Tugas Selesai! [ID: 15] meeting sama klien\n\n_Keren banget! Meeting sukses, kamu luar biasa!_"
```

### 3.3 Reminder Dispatcher Loop & 15-Minute Overdue Grace

```mermaid
sequenceDiagram
    autonumber
    participant Cron as Reminder Interval (Every 60s)
    participant Worker as Reminder Service
    participant DB as PostgreSQL
    participant Bot as Baileys Socket
    actor User as WhatsApp User
    
    rect rgb(240, 248, 255)
    Note over Cron, DB: Phase 1: Advance Lead Reminder (remind_at <= NOW)
    Cron->>Worker: checkAndDispatchReminders(db, sendCallback)
    Worker->>DB: SELECT * FROM tasks WHERE status = 'pending' AND reminded = 0 AND remind_at <= NOW()
    DB-->>Worker: [Task 15]
    Worker->>Bot: sendMessage(userJid, "⏰ Pengingat Tugas...")
    Bot->>User: Delivers advance reminder alert
    Bot-->>Worker: messageId = "ALERT_MSG_88"
    Worker->>DB: UPDATE tasks SET reminded = 1
    Worker->>DB: INSERT INTO task_messages (task_id, message_id)
    end

    rect rgb(255, 250, 240)
    Note over Cron, DB: Phase 2: Final Overdue Reminder (deadline <= NOW - 15 mins)
    Cron->>Worker: checkAndDispatchReminders(db, sendCallback)
    Worker->>DB: SELECT * FROM tasks WHERE status = 'pending' AND reminded = 1 AND deadline <= NOW - 15m
    DB-->>Worker: [Task 15]
    Worker->>Bot: sendMessage(userJid, "🔔 Pengingat Terakhir (Lewat 15 Menit)...")
    Bot->>User: Delivers final check-in with suggestions (✅ selesai, ⏱️ 1/2/3 perpanjang, ❌ batal)
    Bot-->>Worker: messageId = "FINAL_ALERT_99"
    Worker->>DB: UPDATE tasks SET reminded = 2
    Worker->>DB: INSERT INTO task_messages (task_id, message_id)
    end

    opt User Quick Extension Reply
    User->>Bot: Quotes FINAL_ALERT_99 with "1" (+30m)
    Bot->>DB: rescheduleTask(15, newDeadline = NOW + 30m, reminded = 0)
    Bot->>User: "⏱️ Waktu Ekstra Ditambahkan! Pengingat otomatis diatur ulang."
    end
```

#### Per-chat pacing (anti-spam)

Both phases are queried up front and grouped per user. Users are processed in parallel (max 4), while one user's reminders go out sequentially, earliest due first. Every automated send (reminders and the morning digest) goes through `createSendPacer` (`src/services/send-pacer.ts`):

- a jittered **20–30s gap** between two automated messages to the **same chat** (`REMINDER_PACING_MIN_MS` / `REMINDER_PACING_MAX_MS`, min ≥ 6s = WhatsApp pair rate limit, Cloud API error `131056`);
- a **1s global gap** between any two automated sends, so many users due at the same minute do not form a burst;
- at most **2 reminders per user per cycle**; the rest stay `reminded = 0` / `1` and go out on the next 60s tick, so pacing never blocks the scheduler.

Replies to user messages are not paced: they answer a message the user just sent.

### 3.4 Same-Schedule Confirmation

When a new task (or a `pending_deadline` task receiving its time) has a deadline in the **same minute** as another `pending` task of the same user, the router stores it as `pending_confirmation` (never reminded) and asks casually whether to keep it:

- `gas` / `ya` / `lanjut` / `gapapa` → `confirmTask` → `pending` (history `confirm`);
- another time (e.g. `jam 14:30`, kept on the held task's day) → re-checked for collisions, then `pending`;
- `batal` / `ga jadi` → `cancelled`; the existing task is untouched.

The reply is matched by quoting the prompt, or by the latest `pending_confirmation` task within 15 minutes. Unrelated messages fall through to normal routing, so the prompt never blocks the user.

---

## 4. Database Entity-Relationship Diagram (ERD)

```mermaid
erDiagram
    user_settings ||--o{ tasks : owns
    tasks ||--o{ task_messages : tracks
    tasks ||--o{ task_attachments : contains
    tasks ||--o{ task_history : audits
    tasks ||--o{ tasks : "parent/subtask"

    user_settings {
        varchar user_jid PK "WhatsApp remote JID (e.g. 628123@s.whatsapp.net)"
        varchar name "Contact / display name"
        varchar timezone "User timezone (default: Asia/Jakarta)"
        int lead_reminder_minutes "Default advance reminder notice (default: 10)"
        boolean is_allowed "Access control flag (whitelist)"
        boolean morning_digest_enabled "Opt-in daily morning digest flag (default: false)"
        varchar morning_digest_time "Configured local digest time (default: 06:00)"
        timestamptz morning_digest_updated_at "Last update timestamp for digest"
        varchar image_quality_mode "Image quality mode (high: 4K default | compact: 2K)"
        timestamptz created_at "Registration timestamp"
        timestamptz updated_at "Last update timestamp"
    }

    tasks {
        serial id PK "Auto-increment ID"
        int parent_id FK "Self-referencing foreign key for nested sub-tasks"
        varchar user_jid FK "Foreign key to user_settings"
        text task "Clean task description"
        timestamptz deadline "Scheduled completion deadline"
        timestamptz remind_at "Calculated notification timestamp"
        varchar status "pending_deadline | pending | resolved | cancelled"
        smallint reminded "0 = none, 1 = reminded, 2 = overdue alerted"
        timestamptz created_at "Creation timestamp"
        timestamptz updated_at "Modification timestamp"
    }

    task_messages {
        serial id PK "Auto-increment ID"
        int task_id FK "Foreign key to tasks(id)"
        varchar message_id "WhatsApp message ID for reaction tracking"
        timestamptz created_at "Creation timestamp"
    }

    task_attachments {
        serial id PK "Auto-increment ID"
        int task_id FK "Foreign key to tasks(id)"
        varchar user_jid FK "Owner WhatsApp JID"
        varchar file_name "Original or sanitized file name"
        varchar file_type "image | document"
        varchar mime_type "image/jpeg | application/pdf"
        int file_size "File size in bytes"
        text storage_path "Sandboxed path on disk"
        varchar sha256_hash "SHA-256 binary checksum"
        varchar safety_status "safe | suspicious | rejected"
        text ocr_extracted_text "Text extracted via Gemini Vision OCR"
        timestamptz created_at "Timestamp"
    }

    task_history {
        serial id PK "Auto-increment ID"
        int task_id FK "Foreign key to tasks(id)"
        varchar user_jid FK "User who triggered the modification"
        varchar change_type "create | reschedule | rename | resolve | cancel | attachment"
        varchar field_changed "task | deadline | status | attachments"
        text old_value "Previous value"
        text new_value "Updated value"
        text raw_input "User's raw command or reply text"
        timestamptz created_at "Timestamp"
    }

    daily_digest_deliveries {
        serial id PK "Auto-increment ID"
        varchar user_jid FK "Foreign key to user_settings"
        date local_date "User local date for digest"
        varchar status "claimed | sent | failed"
        varchar message_id "WhatsApp message ID"
        int task_count "Number of tasks included"
        timestamptz created_at "Timestamp"
        timestamptz delivered_at "Delivery timestamp"
    }

    daily_motivations {
        serial id PK "Auto-increment ID"
        date motivation_date "Calendar date for pantun"
        text content "Generated or fallback pantun"
        varchar source "gemini | fallback"
        varchar model "Model used"
        int prompt_tokens "Prompt token usage"
        int candidate_tokens "Candidate token usage"
        int total_tokens "Total token usage"
        timestamptz created_at "Timestamp"
    }

    telemetry_hourly {
        serial id PK "Auto-increment ID"
        varchar metric_name "Metric key"
        timestamptz bucket_hour "Truncated hour timestamp"
        bigint count_value "Aggregated count"
    }

    telemetry_events {
        serial id PK "Auto-increment ID"
        varchar event_type "Event type"
        text payload "Sanitized JSON payload"
        timestamptz occurred_at "Timestamp"
    }
```

---

## 5. Security & Isolation Architecture

1. **Multi-Layer Media & Attachment Security Pipeline**:
   - **Layer 1: Magic Bytes / Binary Gatekeeper (`file-type`)**: Validates real file signature against whitelist (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`). Explicitly blocks executable binaries and text vectors like SVG/XML (XSS vectors). Enforces size caps (5MB images, 10MB PDFs).
   - **Layer 2: Content Disarming & Reconstruction (CDR) with Sharp**: Strips dangerous hidden chunks, auto-orients, and sanitizes images into pure, normalized JPEGs, neutralizing polyglots and steganography. Menjaga batas dimensi aman (`fit: 'inside'`, `withoutEnlargement: true`) dengan mode High 4K (4096px, default) atau Compact 2K (2048px) untuk mencegah serangan dekompresi *Pixel Flood / Decompression Bomb*.
   - **Layer 3: Gemini Multimodal AI Screening & OCR**: Inspects visual content for fraudulent bank transfers, scam/phishing indicators, and malicious links before acceptance. Performs OCR extraction on physical invoices and notes.
   - **Layer 4: S3 Object Storage (Rust FS) & Sandboxed Local Storage**: Mendukung S3-compatible Object Storage (container Rust FS / MinIO via internal Docker network) serta penyimpanan lokal terisolasi (`./storage/attachments/YYYY/MM/UUID.ext`) dengan izin akses ketat (`0o600`).
   - **Direct Media Reminder Dispatcher**: Saat interval pengingat tiba, jika tugas memiliki lampiran gambar atau dokumen, bot mengambil buffer file dari S3 Rust FS (atau local storage) dan mengirimkannya langsung ke WhatsApp dengan teks pengingat ramah sebagai caption. ID pesan yang terkirim dihubungkan ke `task_messages` sehingga reaksi emoji (✅ / ❌) pada balon media berfungsi penuh.
2. **Network Attack Surface & Monitoring Dashboard**:
   - Zero public inbound ports for the bot core. Baileys connects exclusively via an outbound WebSocket directly to WhatsApp infrastructure (`*.whatsapp.net`).
   - **Internal Monitoring Dashboard & Control Room (`src/dashboard/`)**: Dashboard pemantauan dan administrasi operasional bot pada port 3080 (`DASHBOARD_PORT`). Bersifat opsional (`DASHBOARD_ENABLED=false` secara default), diproteksi penuh oleh HTTP Basic Authentication (`DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD` minimal 16 karakter), header keamanan ketat (CSP, nosniff, frame denial, no-store), dan terpisah dari WhatsApp runtime socket.
   - **Administrative Capabilities**:
     - *Whitelist & Access Manager*: Mutasi status `is_allowed` per pengguna, penambahan nomor baru secara manual, dan penghapusan kontak terisolasi.
     - *Task Explorer & Detail View*: Query daftar tugas dengan default filter status `active` dan paginasi (20 baris per halaman via query params `offset`/`limit` serta metadata response headers `x-total-count`, `x-offset`, `x-limit`), relasi tugas induk/anak, inspeksi lampiran media, hasil OCR AI, jejak audit perbaikan tugas (*audit trail* dengan `raw_input` trigger), dan panel penyesuaian jadwal tugas (`POST /api/tasks/reschedule`) untuk memodifikasi deadline serta reminder lead time admin.
     - *Cron & Automation Monitoring*: Monitoring siklus scheduler (`Task Reminder Dispatcher`, `Morning Digest Dispatcher`), jeda/aktifkan engine cron secara dinamis, dan pembatalan reminder yang belum berjalan (`POST /api/crons/reminders/disable`) untuk mencegah lonjakan beban atau spam.
   - **Safety Confirmation Safeguards**: Seluruh aksi mutasi yang berpotensi destruktif atau mengubah alur pengiriman pesan diproteksi oleh dialog konfirmasi sadar-admin (*awareness modal confirmation*) di frontend sebelum request HTTP dikirimkan.
3. **Database Isolation**:
   - PostgreSQL connections use credentialed TCP (`DATABASE_URL`).
   - Can run entirely inside Docker network bridges or bind strictly to `localhost:5432`.
4. **Session Credentials**:
   - Signal keys, pre-keys, and tokens are stored in the local `./auth_info` volume, guarded with restricted file permissions, and never transmitted over external networks.
5. **Access Control**:
   - Incoming messages from unauthorized JIDs are immediately dropped if `is_allowed = false` in `user_settings`.
   - The bot ignores group chats (`@g.us`) and status broadcasts (`status@broadcast`) to prevent spam or token exhaustion.
