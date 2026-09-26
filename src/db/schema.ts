import { pgTable, serial, text, varchar, timestamp, integer, boolean, smallint, index } from 'drizzle-orm/pg-core';

export const userSettings = pgTable('user_settings', {
  userJid: varchar('user_jid', { length: 128 }).primaryKey(),
  name: varchar('name', { length: 128 }),
  timezone: varchar('timezone', { length: 64 }).default('Asia/Jakarta').notNull(),
  leadReminderMinutes: integer('lead_reminder_minutes').default(30).notNull(),
  isAllowed: boolean('is_allowed').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
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
});

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

export type UserSetting = typeof userSettings.$inferSelect;
export type InsertUserSetting = typeof userSettings.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

export type TaskMessage = typeof taskMessages.$inferSelect;
export type InsertTaskMessage = typeof taskMessages.$inferInsert;
