import { and, asc, desc, eq, gt, gte, or } from 'drizzle-orm';
import {
  tasks,
  taskMessages,
  taskAttachments,
  taskHistory,
  userSettings,
  type Task,
  type UserSetting,
  type TaskAttachment,
  type InsertTaskAttachment,
  type TaskHistory as TaskHistoryRecord,
} from '../db/schema.js';
import { config } from '../config/index.js';
import { calculateRemindAt } from './reminder.js';

export interface CreateTaskInput {
  userJid: string;
  task: string;
  parentId?: number | null;
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
 * Updates the image quality mode for a user ('high' or 'compact')
 */
export async function updateImageQualityMode(
  db: any,
  userJid: string,
  mode: 'high' | 'compact'
): Promise<UserSetting | null> {
  const updated = await db
    .update(userSettings)
    .set({
      imageQualityMode: mode,
      updatedAt: new Date(),
    })
    .where(eq(userSettings.userJid, userJid))
    .returning();

  return updated[0] ?? null;
}

/**
 * Updates the display name for a user
 */
export async function updateUserName(
  db: any,
  userJid: string,
  name: string
): Promise<UserSetting | null> {
  const updated = await db
    .update(userSettings)
    .set({
      name: name.trim().slice(0, 128),
      updatedAt: new Date(),
    })
    .where(eq(userSettings.userJid, userJid))
    .returning();

  return updated[0] ?? null;
}

/**
 * Updates the lead reminder minutes for a user
 */
export async function updateLeadReminderMinutes(
  db: any,
  userJid: string,
  leadMinutes: number
): Promise<UserSetting | null> {
  const updated = await db
    .update(userSettings)
    .set({
      leadReminderMinutes: leadMinutes,
      updatedAt: new Date(),
    })
    .where(eq(userSettings.userJid, userJid))
    .returning();

  return updated[0] ?? null;
}

/**
 * Creates a new task in database
 */
export async function createTask(db: any, input: CreateTaskInput): Promise<Task> {
  const inserted = await db
    .insert(tasks)
    .values({
      userJid: input.userJid,
      parentId: input.parentId ?? null,
      task: input.task,
      deadline: input.deadline ?? null,
      remindAt: input.remindAt ?? null,
      status: input.status ?? (input.deadline ? 'pending' : 'pending_deadline'),
      reminded: 0,
    })
    .returning();

  const createdTask: Task = inserted[0]!;

  // Log initial creation in task_history (recording initial deadline in oldValue if present)
  await db.insert(taskHistory).values({
    taskId: createdTask.id,
    userJid: createdTask.userJid,
    changeType: 'create',
    fieldChanged: 'task',
    oldValue: createdTask.deadline ? createdTask.deadline.toISOString() : null,
    newValue: createdTask.task,
    rawInput: null,
  });

  return createdTask;
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
export async function resolveTask(
  db: any,
  taskId: number,
  userJid: string,
  rawInput?: string | null
): Promise<Task | null> {
  const updated = await db
    .update(tasks)
    .set({
      status: 'resolved',
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userJid, userJid)))
    .returning();

  if (updated[0]) {
    await db.insert(taskHistory).values({
      taskId: updated[0].id,
      userJid,
      changeType: 'resolve',
      fieldChanged: 'status',
      oldValue: 'pending',
      newValue: 'resolved',
      rawInput: rawInput ?? null,
    });
  }

  return updated[0] ?? null;
}

/**
 * Cancels a task by ID, cascading cancellation to active sub-tasks
 */
export async function cancelTask(
  db: any,
  taskId: number,
  userJid: string,
  rawInput?: string | null
): Promise<Task | null> {
  const updated = await db
    .update(tasks)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userJid, userJid)))
    .returning();

  if (updated[0]) {
    await db.insert(taskHistory).values({
      taskId: updated[0].id,
      userJid,
      changeType: 'cancel',
      fieldChanged: 'status',
      oldValue: 'pending',
      newValue: 'cancelled',
      rawInput: rawInput ?? null,
    });

    // Cascade cancellation to child subtasks
    await db
      .update(tasks)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tasks.parentId, taskId),
          eq(tasks.userJid, userJid),
          or(eq(tasks.status, 'pending'), eq(tasks.status, 'pending_deadline'))
        )
      );
  }

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
 * Updates a pending_deadline task with extracted deadline and remind_at, logging reschedule in taskHistory
 */
export async function updateTaskDeadline(
  db: any,
  taskId: number,
  deadline: Date,
  remindAt: Date,
  rawInput?: string
): Promise<Task | null> {
  const existing = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const oldDeadline = existing[0]?.deadline ? new Date(existing[0].deadline) : null;

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

  if (updated[0]) {
    await db.insert(taskHistory).values({
      taskId: updated[0].id,
      userJid: updated[0].userJid,
      changeType: 'reschedule',
      fieldChanged: 'deadline',
      oldValue: oldDeadline ? oldDeadline.toISOString() : null,
      newValue: deadline.toISOString(),
      rawInput: rawInput ?? null,
    });
  }

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

/**
 * Finds the latest reminded or overdue task for user context fallback (e.g. quick reply)
 */
export async function getLatestRemindedTask(
  db: any,
  userJid: string,
  withinMinutes = 120
): Promise<Task | null> {
  const windowTime = new Date(Date.now() - withinMinutes * 60 * 1000);

  const matched = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userJid, userJid),
        eq(tasks.status, 'pending'),
        gte(tasks.reminded, 1),
        gt(tasks.updatedAt, windowTime)
      )
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(1);

  return matched[0] ?? null;
}

/**
 * Reschedules an existing task with a new deadline, recalculating remind_at,
 * resetting reminded flag to 0 if future, and writing an audit trail in task_history.
 */
export async function rescheduleTask(
  db: any,
  params: {
    taskId: number;
    userJid: string;
    newDeadline: Date;
    rawInput?: string;
    leadMinutes?: number;
    now?: Date;
  }
): Promise<{ updatedTask: Task; oldDeadline: Date | null } | null> {
  const existing = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, params.taskId), eq(tasks.userJid, params.userJid)))
    .limit(1);

  const task = existing[0];
  if (!task) return null;

  const oldDeadline = task.deadline ? new Date(task.deadline) : null;
  const now = params.now ?? new Date();
  const remindAt = calculateRemindAt(params.newDeadline, {
    leadMinutes: params.leadMinutes ?? config.defaultReminderLeadMinutes,
    now,
  });
  const isFuture = params.newDeadline.getTime() > now.getTime();

  const updated = await db
    .update(tasks)
    .set({
      deadline: params.newDeadline,
      remindAt,
      reminded: isFuture ? 0 : task.reminded,
      status: 'pending',
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, params.taskId), eq(tasks.userJid, params.userJid)))
    .returning();

  const updatedTask = updated[0];
  if (updatedTask) {
    await db.insert(taskHistory).values({
      taskId: updatedTask.id,
      userJid: params.userJid,
      changeType: 'reschedule',
      fieldChanged: 'deadline',
      oldValue: oldDeadline ? oldDeadline.toISOString() : null,
      newValue: params.newDeadline.toISOString(),
      rawInput: params.rawInput ?? null,
    });

    if (task.status !== 'pending') {
      await db.insert(taskHistory).values({
        taskId: updatedTask.id,
        userJid: params.userJid,
        changeType: 'reschedule',
        fieldChanged: 'status',
        oldValue: task.status,
        newValue: 'pending',
        rawInput: params.rawInput ?? null,
      });
    }
  }

  return updatedTask ? { updatedTask, oldDeadline } : null;
}

/**
 * Renames an existing task, logging audit trail in task_history.
 */
export async function renameTask(
  db: any,
  params: {
    taskId: number;
    userJid: string;
    newTitle: string;
    rawInput?: string;
  }
): Promise<{ updatedTask: Task; oldTitle: string } | null> {
  const existing = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, params.taskId), eq(tasks.userJid, params.userJid)))
    .limit(1);

  const task = existing[0];
  if (!task) return null;

  const oldTitle = task.task;

  const updated = await db
    .update(tasks)
    .set({
      task: params.newTitle,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, params.taskId), eq(tasks.userJid, params.userJid)))
    .returning();

  const updatedTask = updated[0];
  if (updatedTask) {
    await db.insert(taskHistory).values({
      taskId: updatedTask.id,
      userJid: params.userJid,
      changeType: 'rename',
      fieldChanged: 'task',
      oldValue: oldTitle,
      newValue: params.newTitle,
      rawInput: params.rawInput ?? null,
    });
  }

  return updatedTask ? { updatedTask, oldTitle } : null;
}

/**
 * Creates a sub-task linked to a parent task
 */
export async function createSubtask(
  db: any,
  params: {
    parentId: number;
    userJid: string;
    task: string;
    deadline?: Date | null;
    remindAt?: Date | null;
    status?: string;
  }
): Promise<{ subtask: Task; parentTask: Task } | null> {
  const parent = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, params.parentId), eq(tasks.userJid, params.userJid)))
    .limit(1);

  if (!parent || !parent[0]) return null;

  const subtask = await createTask(db, {
    userJid: params.userJid,
    parentId: params.parentId,
    task: params.task,
    deadline: params.deadline,
    remindAt: params.remindAt,
    status: params.status,
  });

  return { subtask, parentTask: parent[0] };
}

/**
 * Lists all sub-tasks belonging to a parent task
 */
export async function listSubtasks(db: any, parentId: number, userJid: string): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.parentId, parentId), eq(tasks.userJid, userJid)))
    .orderBy(asc(tasks.deadline), asc(tasks.id));
}

/**
 * Gets a task along with its direct sub-tasks (Task Tree)
 */
export async function getTaskTree(
  db: any,
  taskId: number,
  userJid: string
): Promise<{ task: Task; subtasks: Task[] } | null> {
  const taskRes = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userJid, userJid)))
    .limit(1);

  if (!taskRes || !taskRes[0]) return null;

  const subtasks = await listSubtasks(db, taskId, userJid);
  return { task: taskRes[0], subtasks };
}

/**
 * Checks if all subtasks under a parent are resolved
 */
export async function checkSubtasksCompletion(
  db: any,
  parentId: number
): Promise<{ total: number; resolved: number; allResolved: boolean }> {
  const subtasks = await db.select().from(tasks).where(eq(tasks.parentId, parentId));
  const total = subtasks.length;
  if (total === 0) return { total: 0, resolved: 0, allResolved: false };

  const resolved = subtasks.filter((t: Task) => t.status === 'resolved').length;
  return { total, resolved, allResolved: total === resolved };
}

/**
 * Retrieves the change history / audit trail for a task
 */
export async function getTaskHistory(db: any, taskId: number, userJid: string): Promise<TaskHistoryRecord[]> {
  return db
    .select()
    .from(taskHistory)
    .where(and(eq(taskHistory.taskId, taskId), eq(taskHistory.userJid, userJid)))
    .orderBy(asc(taskHistory.createdAt), asc(taskHistory.id));
}

/**
 * Records a new media attachment for a task
 */
export async function addAttachmentToTask(
  db: any,
  input: InsertTaskAttachment
): Promise<TaskAttachment> {
  const inserted = await db.insert(taskAttachments).values(input).returning();
  return inserted[0]!;
}

/**
 * Lists all attachments for a specific task
 */
export async function getTaskAttachments(db: any, taskId: number): Promise<TaskAttachment[]> {
  return db
    .select()
    .from(taskAttachments)
    .where(eq(taskAttachments.taskId, taskId))
    .orderBy(desc(taskAttachments.createdAt));
}
