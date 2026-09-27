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
| **NLP Service** | `src/services/nlp.ts` | Classifies task intent, strips conversational noise, normalizes Indonesian temporal phrases, extracts deadline timestamps, and delegates to Gemini with local fallback. |
| **Task Service** | `src/services/task.ts` | Handles database operations (`tasks`, `task_messages`, `user_settings`), status transitions (`pending_deadline`, `pending`, `resolved`, `cancelled`), and message-to-task correlation. |
| **Reminder Worker** | `src/services/reminder.ts` | Calculates adaptive `remind_at` offsets, queries due and overdue tasks every 60 seconds, dispatches alerts, and updates notification flags. |
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
    
    User->>Router: "Besok jam 2 siang meeting sama klien"
    Router->>NLP: parseTaskMessage(text)
    
    alt Gemini Available
        NLP->>Gemini: Prompt structured task JSON
        Gemini-->>NLP: { isTask: true, taskTitle: "meeting sama klien", deadline: ISO }
    else Gemini Offline / Limit
        NLP->>NLP: Local dictionary + chrono.en parse
    end
    
    NLP-->>Router: ParseResult (isTask: true, deadline: Date)
    Router->>Router: calculateRemindAt(deadline) -> T - 30 minutes
    Router->>DB: createTask({ task, deadline, remindAt, status: 'pending' })
    DB-->>Router: Task Record (ID: 15)
    Router->>User: "✅ Tugas Dicatat! 📝: meeting sama klien ⏰ Deadline: Besok, 14:00"
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

### 3.3 Reminder Dispatcher Loop

```mermaid
sequenceDiagram
    autonumber
    participant Cron as Reminder Interval (Every 60s)
    participant Worker as Reminder Service
    participant DB as PostgreSQL
    participant Bot as Baileys Socket
    actor User as WhatsApp User
    
    Cron->>Worker: checkAndDispatchReminders(db, sendCallback)
    Worker->>DB: SELECT * FROM tasks WHERE status = 'pending' AND reminded = 0 AND remind_at <= NOW()
    DB-->>Worker: [Task 15]
    
    Worker->>Bot: sendMessage(userJid, "⏰ Pengingat Tugas...")
    Bot->>User: Delivers reminder alert
    Bot-->>Worker: messageId = "ALERT_MSG_88"
    
    Worker->>DB: UPDATE tasks SET reminded = 1
    Worker->>DB: INSERT INTO task_messages (task_id, message_id)
```

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
        int lead_reminder_minutes "Default advance reminder notice (default: 30)"
        boolean is_allowed "Access control flag (whitelist)"
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
```

---

## 5. Security & Isolation Architecture

1. **Multi-Layer Media & Attachment Security Pipeline**:
   - **Layer 1: Magic Bytes / Binary Gatekeeper (`file-type`)**: Validates real file signature against whitelist (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`). Explicitly blocks executable binaries and text vectors like SVG/XML (XSS vectors). Enforces size caps (5MB images, 10MB PDFs).
   - **Layer 2: Content Disarming & Reconstruction (CDR) with Sharp**: Strips dangerous hidden chunks, auto-orients, and sanitizes images into pure, normalized JPEGs, neutralizing polyglots and steganography.
   - **Layer 3: Gemini Multimodal AI Screening & OCR**: Inspects visual content for fraudulent bank transfers, scam/phishing indicators, and malicious links before acceptance. Performs OCR extraction on physical invoices and notes.
   - **Layer 4: S3 Object Storage (Rust FS) & Sandboxed Local Storage**: Mendukung S3-compatible Object Storage (container Rust FS / MinIO via internal Docker network) serta penyimpanan lokal terisolasi (`./storage/attachments/YYYY/MM/UUID.ext`) dengan izin akses ketat (`0o600`).
   - **Direct Media Reminder Dispatcher**: Saat interval pengingat tiba, jika tugas memiliki lampiran gambar atau dokumen, bot mengambil buffer file dari S3 Rust FS (atau local storage) dan mengirimkannya langsung ke WhatsApp dengan teks pengingat ramah sebagai caption. ID pesan yang terkirim dihubungkan ke `task_messages` sehingga reaksi emoji (✅ / ❌) pada balon media berfungsi penuh.
2. **Network Attack Surface**:
   - Zero inbound listening HTTP ports. Baileys connects exclusively via an outbound WebSocket directly to WhatsApp infrastructure (`*.whatsapp.net`).
   - The bot server is immune to internet-wide port scans, external HTTP exploits, or unauthorized webhooks.
3. **Database Isolation**:
   - PostgreSQL connections use credentialed TCP (`DATABASE_URL`).
   - Can run entirely inside Docker network bridges or bind strictly to `localhost:5432`.
4. **Session Credentials**:
   - Signal keys, pre-keys, and tokens are stored in the local `./auth_info` volume, guarded with restricted file permissions, and never transmitted over external networks.
5. **Access Control**:
   - Incoming messages from unauthorized JIDs are immediately dropped if `is_allowed = false` in `user_settings`.
   - The bot ignores group chats (`@g.us`) and status broadcasts (`status@broadcast`) to prevent spam or token exhaustion.
