import { describe, expect, it, beforeEach } from 'bun:test';
import { db } from '../../src/db/index.js';
import { tasks, taskMessages, userSettings } from '../../src/db/schema.js';
import { handleIncomingMessage } from '../../src/bot/handlers/router.js';
import { ensureUserSettings, createTask, linkTaskMessage } from '../../src/services/task.js';

describe('Smart Quoted Reply & Friendly Banter', () => {
  const allowedUserJid = '628123456789@s.whatsapp.net';

  beforeEach(async () => {
    await db.delete(taskMessages);
    await db.delete(tasks);
    await db.delete(userSettings);
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);
  });

  it('should link rename confirmation message and allow resolving the renamed task via reply to that message', async () => {
    // 1. Create two tasks: Task 1 and Task 2
    const task1 = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Task Pertama Lama',
      status: 'pending',
    });
    const botMsgTask1 = 'BOT_MSG_TASK_1';
    await linkTaskMessage(db, task1.id, botMsgTask1);

    const task2 = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Task Kedua Yang Lebih Baru',
      status: 'pending',
    });
    const botMsgTask2 = 'BOT_MSG_TASK_2';
    await linkTaskMessage(db, task2.id, botMsgTask2);

    const sentMessages: { text: string; id: string }[] = [];
    const mockSock = {
      sendMessage: async (_jid: string, content: any) => {
        const id = `BOT_REPLY_${sentMessages.length + 1}`;
        sentMessages.push({ text: content.text, id });
        return { key: { id } };
      },
    };

    // 2. User renames Task 1 by quoting botMsgTask1
    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'USER_RENAME' },
      message: {
        extendedTextMessage: {
          text: 'ubah tugas: Task Pertama Baru',
          contextInfo: { stanzaId: botMsgTask1 },
        },
      },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]?.text).toContain('Nama Tugas Berhasil Diperbarui!');
    const renameConfirmationMsgId = sentMessages[0]?.id;

    // Verify task_messages has linked the rename confirmation
    const linked = await db.select().from(taskMessages);
    const renameLink = linked.find((l) => l.messageId === renameConfirmationMsgId);
    expect(renameLink).toBeDefined();
    expect(renameLink?.taskId).toBe(task1.id);

    // 3. User replies "selesai" quoting the rename confirmation message
    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'USER_RESOLVE_RENAME' },
      message: {
        extendedTextMessage: {
          text: 'selesai',
          contextInfo: { stanzaId: renameConfirmationMsgId },
        },
      },
    });

    expect(sentMessages.length).toBe(2);
    expect(sentMessages[1]?.text).toContain('Tugas Selesai');
    expect(sentMessages[1]?.text).toContain('Task Pertama Baru');

    // 4. Verify Task 1 is resolved, while Task 2 remains pending!
    const task1After = (await db.select().from(tasks)).find((t) => t.id === task1.id);
    const task2After = (await db.select().from(tasks)).find((t) => t.id === task2.id);
    expect(task1After?.status).toBe('resolved');
    expect(task2After?.status).toBe('pending');
  });

  it('should not silently hijack another task when quoted message is not recognized as a task', async () => {
    // Two active tasks exist
    await createTask(db, {
      userJid: allowedUserJid,
      task: 'Task Penting 1',
      status: 'pending',
    });
    await createTask(db, {
      userJid: allowedUserJid,
      task: 'Task Penting 2',
      status: 'pending',
    });

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (_jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_RESP' } };
      },
    };

    // User replies "selesai" to a random/unlinked bot message (e.g. greeting or unknown msg)
    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'USER_REPLY_UNLINKED' },
      message: {
        extendedTextMessage: {
          text: 'selesai',
          contextInfo: { stanzaId: 'RANDOM_UNLINKED_MESSAGE_ID' },
        },
      },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('tidak terhubung ke tugas aktif');

    // Verify NEITHER task was resolved!
    const activeTasks = await db.select().from(tasks);
    expect(activeTasks.every((t) => t.status === 'pending')).toBe(true);
  });

  it('should extract task ID from quoted text if stanzaId is unlinked but text contains [ID: X]', async () => {
    const task = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Tugas Dengan ID Teks',
      status: 'pending',
    });

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (_jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_RESP' } };
      },
    };

    // User quotes a message whose stanzaId is not in task_messages, but quoted text has "[ID: <task.id>]"
    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'USER_REPLY_EXTRACT' },
      message: {
        extendedTextMessage: {
          text: 'selesai',
          contextInfo: {
            stanzaId: 'OLD_UNKNOWN_STANZA',
            quotedMessage: {
              conversation: `📋 Kronologi Perubahan [ID: ${task.id}]\nJudul: Tugas Dengan ID Teks`,
            },
          },
        },
      },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Tugas Selesai');
    expect(sentMessages[0]).toContain('Tugas Dengan ID Teks');

    const taskAfter = (await db.select().from(tasks)).find((t) => t.id === task.id);
    expect(taskAfter?.status).toBe('resolved');
  });

  it('should respond warmly to casual acknowledgments (oke, siap, mantap, makasih)', async () => {
    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (_jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_RESP' } };
      },
    };

    for (const word of ['oke', 'siap', 'mantap', 'makasih']) {
      sentMessages.length = 0;
      await handleIncomingMessage(mockSock as any, {
        key: { remoteJid: allowedUserJid, id: `MSG_${word}` },
        message: { conversation: word },
      });
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0]?.toLowerCase()).toContain('tugas');
    }
  });

  it('should not stay silent for random or non-task messages, responding with friendly and engaging banter', async () => {
    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (_jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_RESP' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'MSG_RANDOM' },
      message: { conversation: 'lagi ngapain nih bot santai bener' },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0] || '').toContain('santai dulu');
    expect(sentMessages[0] || '').toContain('to-do list');
  });
});
