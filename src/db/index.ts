import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { config } from '../config/index.js';

const client = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
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
}

export { client };
