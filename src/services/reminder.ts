import { and, eq, lte } from 'drizzle-orm';
import { tasks, type Task } from '../db/schema.js';
import { linkTaskMessage } from './task.js';

export interface RemindAtOptions {
  leadMinutes?: number;
  now?: Date;
}

/**
 * Calculates adaptive remind_at timestamp based on distance to deadline:
 * - Distance > 2 hours: remind (leadMinutes || 30) minutes before
 * - Distance between 30 minutes and 2 hours: remind 15 minutes before
 * - Distance < 30 minutes: remind at exact deadline time
 */
export function calculateRemindAt(deadline: Date, options: RemindAtOptions = {}): Date {
  const now = options.now ?? new Date();
  const diffMinutes = (deadline.getTime() - now.getTime()) / (60 * 1000);
  const defaultLead = options.leadMinutes && options.leadMinutes > 0 ? options.leadMinutes : 30;

  if (diffMinutes > 120) {
    return new Date(deadline.getTime() - defaultLead * 60 * 1000);
  }

  if (diffMinutes >= 30) {
    return new Date(deadline.getTime() - 15 * 60 * 1000);
  }

  return new Date(deadline.getTime());
}

export type DispatchMessageCallback = (task: Task, isOverdue: boolean) => Promise<string | null>;

/**
 * Queries due and overdue tasks, triggers notifications, and marks them reminded.
 */
export async function checkAndDispatchReminders(
  db: any,
  dispatchMessage: DispatchMessageCallback,
  now: Date = new Date()
): Promise<number> {
  let count = 0;

  // 1. Regular reminders: pending, reminded = 0, remindAt <= now
  const dueTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, 'pending'), eq(tasks.reminded, 0), lte(tasks.remindAt, now)));

  for (const task of dueTasks) {
    try {
      const messageId = await dispatchMessage(task, false);
      await db
        .update(tasks)
        .set({
          reminded: 1,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      if (messageId) {
        await linkTaskMessage(db, task.id, messageId);
      }
      count++;
    } catch {
      // Continue next task on individual failure
    }
  }

  // 2. Overdue alerts: pending, reminded = 1, deadline <= now
  const overdueTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, 'pending'), eq(tasks.reminded, 1), lte(tasks.deadline, now)));

  for (const task of overdueTasks) {
    try {
      const messageId = await dispatchMessage(task, true);
      await db
        .update(tasks)
        .set({
          reminded: 2, // 2 = overdue alerted
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      if (messageId) {
        await linkTaskMessage(db, task.id, messageId);
      }
      count++;
    } catch {
      // Continue next task
    }
  }

  return count;
}
