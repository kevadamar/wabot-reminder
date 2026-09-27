import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { config } from '../config/index.js';

const client = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: (notice) => {
    // 42P07 = duplicate_table / duplicate_relation (normal & safe skip caused by IF NOT EXISTS)
    if (notice.code === '42P07' && notice.message?.includes('already exists, skipping')) {
      const match = notice.message.match(/relation "([^"]+)" already exists, skipping/);
      const relName = match ? match[1] : '';
      if (relName) {
        console.log(`ℹ️ [DB Schema] Relasi "${relName}" sudah ada dari migrasi sebelumnya (aman dilewati).`);
      } else {
        console.log(`ℹ️ [DB Schema] ${notice.message}`);
      }
      return;
    }

    // Pass through any other unexpected notices or warnings so real issues are not masked
    const severity = notice.severity || 'NOTICE';
    console.warn(`⚠️ [DB ${severity}] (${notice.code || 'NO_CODE'}): ${notice.message}`);
  },
});

export const db = drizzle(client, { schema });

/**
 * Automatically creates all tables and indexes if they do not exist yet.
 * Ensures zero-config deployment on fresh PostgreSQL databases (e.g. Dokploy, Docker).
 */
export async function initDb() {
  await client`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_jid VARCHAR(128) PRIMARY KEY,
      name VARCHAR(128),
      timezone VARCHAR(64) DEFAULT 'Asia/Jakarta' NOT NULL,
      lead_reminder_minutes INTEGER DEFAULT 30 NOT NULL,
      is_allowed BOOLEAN DEFAULT false NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `;

  await client`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      user_jid VARCHAR(128) NOT NULL REFERENCES user_settings(user_jid),
      task TEXT NOT NULL,
      deadline TIMESTAMPTZ,
      remind_at TIMESTAMPTZ,
      status VARCHAR(32) DEFAULT 'pending_deadline' NOT NULL,
      reminded SMALLINT DEFAULT 0 NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `;

  await client`
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE;
  `;

  await client`
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
  `;

  await client`
    CREATE TABLE IF NOT EXISTS task_messages (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      message_id VARCHAR(128) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `;

  await client`
    CREATE INDEX IF NOT EXISTS idx_task_messages_message_id ON task_messages(message_id);
  `;

  await client`
    CREATE INDEX IF NOT EXISTS idx_task_messages_task_id ON task_messages(task_id);
  `;

  await client`
    CREATE TABLE IF NOT EXISTS task_attachments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_jid VARCHAR(128) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_type VARCHAR(32) NOT NULL,
      mime_type VARCHAR(128) NOT NULL,
      file_size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      sha256_hash VARCHAR(64) NOT NULL,
      safety_status VARCHAR(32) DEFAULT 'clean' NOT NULL,
      ocr_extracted_text TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `;

  await client`
    CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON task_attachments(task_id);
  `;

  await client`
    CREATE TABLE IF NOT EXISTS task_history (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_jid VARCHAR(128) NOT NULL,
      change_type VARCHAR(32) NOT NULL,
      field_changed VARCHAR(64),
      old_value TEXT,
      new_value TEXT,
      raw_input TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `;

  await client`
    CREATE INDEX IF NOT EXISTS idx_task_history_task_id ON task_history(task_id);
  `;
}

export { client };
