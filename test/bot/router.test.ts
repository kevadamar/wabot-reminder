import { describe, expect, it, beforeEach } from 'bun:test';
import { db } from '../../src/db/index.js';
import { tasks, taskMessages, userSettings } from '../../src/db/schema.js';
import { handleIncomingMessage, handleIncomingReaction } from '../../src/bot/handlers/router.js';
import { ensureUserSettings, createTask, linkTaskMessage } from '../../src/services/task.js';

describe('Seam 5: Message & Reaction Router', () => {
  const allowedUserJid = '628123456789@s.whatsapp.net';
  const strangerJid = '628999999999@s.whatsapp.net';

  beforeEach(async () => {
    await db.delete(taskMessages);
    await db.delete(tasks);
    await db.delete(userSettings);
  });

  it('should ignore or warn unauthorized strangers', async () => {
    // User is created but isAllowed = false
    await ensureUserSettings(db, strangerJid, 'Stranger', false);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_1' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: strangerJid, id: 'MSG_IN_1' },
      message: { conversation: 'Halo' },
    });

    // Verify stranger did not create any task
    const userTasks = await db.select().from(tasks);
    expect(userTasks.length).toBe(0);
  });

  it('should respond to /help command with friendly guide', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_1' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'MSG_IN_2' },
      message: { conversation: '/help' },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Mencatat Tugas Baru');
    expect(sentMessages[0]).toContain('Mengecek Tugas');
  });

  it('should create task when allowed user sends a task', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_REPLY_1' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'MSG_IN_3' },
      message: { conversation: 'Kirim laporan keuangan besok jam 14:00' },
    });

    const userTasks = await db.select().from(tasks);
    expect(userTasks.length).toBe(1);
    expect(userTasks[0]?.task.toLowerCase()).toContain('laporan');
    expect(userTasks[0]?.status).toBe('pending');

    // Confirm reply was sent
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Tugas Dicatat');
  });

  it('should resolve task when user reacts with ✅ emoji', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);
    const task = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Beli kopi arabika',
      status: 'pending',
    });

    const botMsgId = 'BOT_MSG_COFFEE_100';
    await linkTaskMessage(db, task.id, botMsgId);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_AFFIRM_1' } };
      },
    };

    // Trigger reaction event
    await handleIncomingReaction(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: botMsgId },
      reaction: '✅',
    });

    const checkTask = await db.select().from(tasks);
    expect(checkTask[0]?.status).toBe('resolved');
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Tugas Selesai');
  });
});
