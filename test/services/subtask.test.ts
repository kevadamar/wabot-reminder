import { describe, expect, it, beforeEach } from 'bun:test';
import { db } from '../../src/db/index.js';
import { tasks, taskMessages, taskHistory, taskAttachments, userSettings } from '../../src/db/schema.js';
import {
  ensureUserSettings,
  createTask,
  createSubtask,
  listSubtasks,
  getTaskTree,
  checkSubtasksCompletion,
  cancelTask,
  resolveTask,
  addAttachmentToTask,
  getTaskAttachments,
} from '../../src/services/task.js';

describe('Hierarchical Tasks (Parent & Sub-tasks)', () => {
  const testUserJid = '628111999888@s.whatsapp.net';

  beforeEach(async () => {
    await db.delete(taskAttachments);
    await db.delete(taskHistory);
    await db.delete(taskMessages);
    await db.delete(tasks);
    await db.delete(userSettings);
    await ensureUserSettings(db, testUserJid, 'Subtask Tester', true);
  });

  it('should create a subtask linked to a parent task with independent deadlines', async () => {
    const parentDeadline = new Date('2026-09-30T17:00:00.000Z');
    const parent = await createTask(db, {
      userJid: testUserJid,
      task: 'Rilis Versi 2.0 Web App',
      deadline: parentDeadline,
      status: 'pending',
    });

    const subDeadline1 = new Date('2026-09-28T10:00:00.000Z');
    const res1 = await createSubtask(db, {
      parentId: parent.id,
      userJid: testUserJid,
      task: 'Audit Keamanan & Penetrasi Test',
      deadline: subDeadline1,
    });

    const subDeadline2 = new Date('2026-09-29T14:00:00.000Z');
    const res2 = await createSubtask(db, {
      parentId: parent.id,
      userJid: testUserJid,
      task: 'Deploy ke Staging Server',
      deadline: subDeadline2,
    });

    expect(res1).not.toBeNull();
    expect(res1?.subtask.parentId).toBe(parent.id);
    expect(res1?.subtask.task).toBe('Audit Keamanan & Penetrasi Test');

    expect(res2).not.toBeNull();
    expect(res2?.subtask.parentId).toBe(parent.id);

    // Verify listSubtasks returns both subtasks ordered by deadline
    const subtasks = await listSubtasks(db, parent.id, testUserJid);
    expect(subtasks.length).toBe(2);
    expect(subtasks[0]?.task).toBe('Audit Keamanan & Penetrasi Test');
    expect(subtasks[1]?.task).toBe('Deploy ke Staging Server');
  });

  it('should retrieve full task tree with parent and child subtasks', async () => {
    const parent = await createTask(db, {
      userJid: testUserJid,
      task: 'Persiapan Pernikahan',
      status: 'pending',
    });

    await createSubtask(db, {
      parentId: parent.id,
      userJid: testUserJid,
      task: 'Sewa Gedung',
    });

    await createSubtask(db, {
      parentId: parent.id,
      userJid: testUserJid,
      task: 'Fitting Baju Pengantin',
    });

    const tree = await getTaskTree(db, parent.id, testUserJid);
    expect(tree).not.toBeNull();
    expect(tree?.task.id).toBe(parent.id);
    expect(tree?.task.task).toBe('Persiapan Pernikahan');
    expect(tree?.subtasks.length).toBe(2);
  });

  it('should track subtask completion rollup', async () => {
    const parent = await createTask(db, {
      userJid: testUserJid,
      task: 'Proyek Renovasi Kantor',
      status: 'pending',
    });

    const st1 = await createSubtask(db, {
      parentId: parent.id,
      userJid: testUserJid,
      task: 'Cat dinding ruang meeting',
    });

    const st2 = await createSubtask(db, {
      parentId: parent.id,
      userJid: testUserJid,
      task: 'Ganti karpet lantai 2',
    });

    let rollup = await checkSubtasksCompletion(db, parent.id);
    expect(rollup.total).toBe(2);
    expect(rollup.resolved).toBe(0);
    expect(rollup.allResolved).toBe(false);

    // Resolve 1st subtask
    await resolveTask(db, st1!.subtask.id, testUserJid);
    rollup = await checkSubtasksCompletion(db, parent.id);
    expect(rollup.resolved).toBe(1);
    expect(rollup.allResolved).toBe(false);

    // Resolve 2nd subtask
    await resolveTask(db, st2!.subtask.id, testUserJid);
    rollup = await checkSubtasksCompletion(db, parent.id);
    expect(rollup.resolved).toBe(2);
    expect(rollup.allResolved).toBe(true);
  });

  it('should cascade cancellation to active subtasks when parent task is cancelled', async () => {
    const parent = await createTask(db, {
      userJid: testUserJid,
      task: 'Proyek Dibatalkan',
      status: 'pending',
    });

    const st1 = await createSubtask(db, {
      parentId: parent.id,
      userJid: testUserJid,
      task: 'Subtask 1',
    });

    const st2 = await createSubtask(db, {
      parentId: parent.id,
      userJid: testUserJid,
      task: 'Subtask 2',
    });

    // Cancel parent
    await cancelTask(db, parent.id, testUserJid);

    // Verify subtasks are cancelled as well
    const subtasks = await listSubtasks(db, parent.id, testUserJid);
    expect(subtasks.length).toBe(2);
    expect(subtasks[0]?.status).toBe('cancelled');
    expect(subtasks[1]?.status).toBe('cancelled');
  });

  it('should attach and retrieve media files for a task', async () => {
    const task = await createTask(db, {
      userJid: testUserJid,
      task: 'Bayar Tagihan Listrik',
      status: 'pending',
    });

    const attachment = await addAttachmentToTask(db, {
      taskId: task.id,
      userJid: testUserJid,
      fileName: 'struk_pln.jpg',
      fileType: 'image',
      mimeType: 'image/jpeg',
      fileSize: 102400,
      storagePath: '/storage/attachments/2026/09/struk.jpg',
      sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      safetyStatus: 'safe',
      ocrExtractedText: 'Tagihan PLN Rp 350.000',
    });

    expect(attachment.id).toBeDefined();
    expect(attachment.taskId).toBe(task.id);

    const attachments = await getTaskAttachments(db, task.id);
    expect(attachments.length).toBe(1);
    expect(attachments[0]?.fileName).toBe('struk_pln.jpg');
    expect(attachments[0]?.ocrExtractedText).toContain('PLN');
  });
});
