import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  smallint,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const userSettings = pgTable('user_settings', {
  userJid: varchar('user_jid', { length: 128 }).primaryKey(),
  name: varchar('name', { length: 128 }),
  timezone: varchar('timezone', { length: 64 }).default('Asia/Jakarta').notNull(),
  leadReminderMinutes: integer('lead_reminder_minutes').default(30).notNull(),
  isAllowed: boolean('is_allowed').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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

