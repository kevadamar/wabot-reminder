import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { buildDashboardSnapshot } from '../../src/dashboard/server.js';
import { db, initDb } from '../../src/db/index.js';
import {
  dailyDigestDeliveries,
  taskAttachments,
  taskMessages,
  tasks,
  telemetryEvents,
  telemetryHourly,
  userSettings,
} from '../../src/db/schema.js';

describe('Monitoring dashboard snapshot', () => {
  beforeAll(async () => initDb());

  beforeEach(async () => {
    await db.delete(dailyDigestDeliveries);
    await db.delete(taskAttachments);
    await db.delete(taskMessages);
    await db.delete(tasks);
    await db.delete(userSettings);
    await db.delete(telemetryEvents);
    await db.delete(telemetryHourly);
  });

  it('returns aggregate operational data without task content or JIDs', async () => {
    await db.insert(userSettings).values({
      userJid: '628111111111@s.whatsapp.net',
      name: 'Private Name',
      isAllowed: true,
      morningDigestEnabled: true,
    });
    const [task] = await db.insert(tasks).values({
      userJid: '628111111111@s.whatsapp.net',
      task: 'Private task title',
      status: 'pending',
      deadline: new Date('2026-09-29T01:00:00.000Z'),
    }).returning();
    await db.insert(taskAttachments).values({
      taskId: task!.id,
      userJid: '628111111111@s.whatsapp.net',
      fileName: 'private.pdf',
      fileType: 'document',
      mimeType: 'application/pdf',
      fileSize: 2048,
      storagePath: '/private/path',
      sha256Hash: 'a'.repeat(64),
      safetyStatus: 'safe',
    });

    const snapshot = await buildDashboardSnapshot(db);
    const serialized = JSON.stringify(snapshot);
    expect(snapshot.tasks.pending).toBe(1);
    expect(snapshot.users.allowed).toBe(1);
    expect(snapshot.users.morningDigestEnabled).toBe(1);
    expect(snapshot.storage.bytes).toBe(2048);
    expect(serialized).not.toContain('Private task title');
    expect(serialized).not.toContain('628111111111');
    expect(serialized).not.toContain('private.pdf');
  });
});
