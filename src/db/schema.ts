import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  smallint,
  date,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const userSettings = pgTable(
  'user_settings',
  {
    userJid: varchar('user_jid', { length: 128 }).primaryKey(),
    name: varchar('name', { length: 128 }),
    timezone: varchar('timezone', { length: 64 }).default('Asia/Jakarta').notNull(),
    leadReminderMinutes: integer('lead_reminder_minutes').default(30).notNull(),
    isAllowed: boolean('is_allowed').default(false).notNull(),
    morningDigestEnabled: boolean('morning_digest_enabled').default(false).notNull(),
    morningDigestTime: varchar('morning_digest_time', { length: 5 }).default('06:00').notNull(),
    morningDigestUpdatedAt: timestamp('morning_digest_updated_at', { withTimezone: true }).defaultNow().notNull(),
    imageQualityMode: varchar('image_quality_mode', { length: 32 }).default('high').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_user_settings_morning_digest').on(table.isAllowed, table.morningDigestEnabled),
  ]
);

export const tasks = pgTable(
  'tasks',
  {
    id: serial('id').primaryKey(),
    parentId: integer('parent_id').references((): AnyPgColumn => tasks.id, {
      onDelete: 'cascade',
    }),
    userJid: varchar('user_jid', { length: 128 })
      .references(() => userSettings.userJid)
      .notNull(),
    task: text('task').notNull(),
    deadline: timestamp('deadline', { withTimezone: true }),
    remindAt: timestamp('remind_at', { withTimezone: true }),
    status: varchar('status', { length: 32 }).default('pending_deadline').notNull(),
    reminded: smallint('reminded').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_tasks_parent_id').on(table.parentId),
    index('idx_tasks_user_jid').on(table.userJid),
    index('idx_tasks_daily_digest').on(table.userJid, table.status, table.deadline, table.id),
  ]
);

export const taskMessages = pgTable(
  'task_messages',
  {
    id: serial('id').primaryKey(),
    taskId: integer('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    messageId: varchar('message_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_task_messages_message_id').on(table.messageId),
    index('idx_task_messages_task_id').on(table.taskId),
  ]
);

export const taskAttachments = pgTable(
  'task_attachments',
  {
    id: serial('id').primaryKey(),
    taskId: integer('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    userJid: varchar('user_jid', { length: 128 }).notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    fileType: varchar('file_type', { length: 32 }).notNull(), // 'image' | 'document'
    mimeType: varchar('mime_type', { length: 128 }).notNull(),
    fileSize: integer('file_size').notNull(),
    storagePath: text('storage_path').notNull(),
    sha256Hash: varchar('sha256_hash', { length: 64 }).notNull(),
    safetyStatus: varchar('safety_status', { length: 32 }).default('clean').notNull(), // 'clean' | 'suspicious' | 'flagged'
    ocrExtractedText: text('ocr_extracted_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_task_attachments_task_id').on(table.taskId),
    index('idx_task_attachments_user_jid').on(table.userJid),
  ]
);

export const taskHistory = pgTable(
  'task_history',
  {
    id: serial('id').primaryKey(),
    taskId: integer('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    userJid: varchar('user_jid', { length: 128 }).notNull(),
    changeType: varchar('change_type', { length: 32 }).notNull(), // 'reschedule' | 'rename' | 'status_change' | 'create'
    fieldChanged: varchar('field_changed', { length: 64 }), // 'deadline' | 'task' | 'status'
    oldValue: text('old_value'),
    newValue: text('new_value'),
    rawInput: text('raw_input'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_task_history_task_id').on(table.taskId),
  ]
);

export const dailyDigestDeliveries = pgTable(
  'daily_digest_deliveries',
  {
    id: serial('id').primaryKey(),
    userJid: varchar('user_jid', { length: 128 })
      .references(() => userSettings.userJid, { onDelete: 'cascade' })
      .notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    status: varchar('status', { length: 16 }).default('processing').notNull(),
    attemptCount: integer('attempt_count').default(1).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    messageId: varchar('message_id', { length: 128 }),
    taskCount: integer('task_count').default(0).notNull(),
    motivationSource: varchar('motivation_source', { length: 16 }),
    errorCode: varchar('error_code', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_daily_digest_user_date').on(table.userJid, table.localDate),
    index('idx_daily_digest_status_claimed').on(table.status, table.claimedAt),
  ]
);

export const dailyMotivations = pgTable(
  'daily_motivations',
  {
    id: serial('id').primaryKey(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    locale: varchar('locale', { length: 16 }).default('id-ID').notNull(),
    style: varchar('style', { length: 32 }).default('pantun').notNull(),
    status: varchar('status', { length: 16 }).default('generating').notNull(),
    text: text('text'),
    source: varchar('source', { length: 16 }),
    model: varchar('model', { length: 128 }),
    promptTokens: integer('prompt_tokens'),
    outputTokens: integer('output_tokens'),
    thoughtTokens: integer('thought_tokens'),
    totalTokens: integer('total_tokens'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_daily_motivation_date_locale_style').on(table.localDate, table.locale, table.style),
  ]
);

export const telemetryHourly = pgTable(
  'telemetry_hourly',
  {
    id: serial('id').primaryKey(),
    bucketAt: timestamp('bucket_at', { withTimezone: true }).notNull(),
    metric: varchar('metric', { length: 64 }).notNull(),
    dimension: varchar('dimension', { length: 128 }).default('').notNull(),
    count: integer('count').default(0).notNull(),
    sumValue: integer('sum_value').default(0).notNull(),
    maxValue: integer('max_value').default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_telemetry_hourly_series').on(table.bucketAt, table.metric, table.dimension),
    index('idx_telemetry_hourly_metric_bucket').on(table.metric, table.bucketAt),
  ]
);

export const telemetryEvents = pgTable(
  'telemetry_events',
  {
    id: serial('id').primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    component: varchar('component', { length: 64 }).notNull(),
    operation: varchar('operation', { length: 64 }).notNull(),
    outcome: varchar('outcome', { length: 32 }).notNull(),
    provider: varchar('provider', { length: 32 }),
    errorCode: varchar('error_code', { length: 64 }),
    durationMs: integer('duration_ms'),
  },
  (table) => [index('idx_telemetry_events_occurred').on(table.occurredAt)]
);

export type UserSetting = typeof userSettings.$inferSelect;
export type InsertUserSetting = typeof userSettings.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

export type TaskMessage = typeof taskMessages.$inferSelect;
export type InsertTaskMessage = typeof taskMessages.$inferInsert;

export type TaskAttachment = typeof taskAttachments.$inferSelect;
export type InsertTaskAttachment = typeof taskAttachments.$inferInsert;

export type TaskHistory = typeof taskHistory.$inferSelect;
export type InsertTaskHistory = typeof taskHistory.$inferInsert;

export type DailyDigestDelivery = typeof dailyDigestDeliveries.$inferSelect;
export type DailyMotivation = typeof dailyMotivations.$inferSelect;
export type TelemetryHourly = typeof telemetryHourly.$inferSelect;
export type TelemetryEvent = typeof telemetryEvents.$inferSelect;
