import { and, asc, desc, eq, gt, or } from 'drizzle-orm';
import { tasks, taskMessages, userSettings, type Task, type UserSetting } from '../db/schema.js';
import { config } from '../config/index.js';

export interface CreateTaskInput {
  userJid: string;
  task: string;
  deadline?: Date | null;
  remindAt?: Date | null;
  status?: string;
}

/**
 * Ensures a user row exists in user_settings, returning the user row.
 */
export async function ensureUserSettings(
  db: any,
  userJid: string,
  name?: string | null,
  isAllowedDefault = false
): Promise<UserSetting> {
  const existing = await db.select().from(userSettings).where(eq(userSettings.userJid, userJid)).limit(1);

  if (existing.length > 0 && existing[0]) {
    return existing[0];
  }

  const inserted = await db
    .insert(userSettings)
    .values({
      userJid,
      name: name ?? null,
      timezone: config.defaultTimezone,
      leadReminderMinutes: config.defaultReminderLeadMinutes,
      isAllowed: isAllowedDefault,
    })
    .returning();

  return inserted[0]!;
}

/**
 * Creates a new task in database
 */
export async function createTask(db: any, input: CreateTaskInput): Promise<Task> {
  const inserted = await db
    .insert(tasks)
    .values({
      userJid: input.userJid,
      task: input.task,
      deadline: input.deadline ?? null,
      remindAt: input.remindAt ?? null,
      status: input.status ?? (input.deadline ? 'pending' : 'pending_deadline'),
      reminded: 0,
    })
    .returning();

  return inserted[0]!;
}

/**
 * Associates an outgoing WhatsApp message ID with a task for reaction/reply completion
 */
export async function linkTaskMessage(db: any, taskId: number, messageId: string): Promise<void> {
  await db.insert(taskMessages).values({
    taskId,
    messageId,
  });
}

/**
 * Finds a task associated with a specific WhatsApp message ID
 */
export async function findTaskByMessageId(db: any, messageId: string): Promise<Task | null> {
  const match = await db
    .select({ task: tasks })
    .from(taskMessages)
    .innerJoin(tasks, eq(taskMessages.taskId, tasks.id))
    .where(eq(taskMessages.messageId, messageId))
    .limit(1);

  return match[0]?.task ?? null;
}

/**
 * Resolves a task by ID
 */
export async function resolveTask(db: any, taskId: number, userJid: string): Promise<Task | null> {
  const updated = await db
    .update(tasks)
    .set({
      status: 'resolved',
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userJid, userJid)))
    .returning();

  return updated[0] ?? null;
}

/**
 * Cancels a task by ID
 */
export async function cancelTask(db: any, taskId: number, userJid: string): Promise<Task | null> {
  const updated = await db
    .update(tasks)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userJid, userJid)))
    .returning();

  return updated[0] ?? null;
}

/**
 * Lists all active (pending or pending_deadline) tasks for a user
 */
export async function listActiveTasks(db: any, userJid: string): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userJid, userJid),
        or(eq(tasks.status, 'pending'), eq(tasks.status, 'pending_deadline'))
      )
    )
    .orderBy(asc(tasks.deadline), asc(tasks.id));
}

/**
 * Updates a pending_deadline task with extracted deadline and remind_at
 */
export async function updateTaskDeadline(
  db: any,
  taskId: number,
  deadline: Date,
  remindAt: Date
): Promise<Task | null> {
  const updated = await db
    .update(tasks)
    .set({
      deadline,
      remindAt,
      status: 'pending',
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId))
    .returning();

  return updated[0] ?? null;
}

/**
 * Finds the latest pending_deadline task for context resolution fallback
 */
export async function getLatestPendingDeadlineTask(
  db: any,
  userJid: string,
  withinMinutes = 10
): Promise<Task | null> {
  const windowTime = new Date(Date.now() - withinMinutes * 60 * 1000);

  const matched = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userJid, userJid),
        eq(tasks.status, 'pending_deadline'),
        gt(tasks.createdAt, windowTime)
      )
    )
    .orderBy(desc(tasks.createdAt))
    .limit(1);

  return matched[0] ?? null;
}
