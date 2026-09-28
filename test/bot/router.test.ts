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
    expect(sentMessages[0]).toContain('Mengecek');
  });

  it('should let an allowed user configure the opt-in morning digest', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);
    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (_jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: `MSG_${sentMessages.length}` } };
      },
    };

    for (const text of ['/pagi status', '/pagi aktif', '/pagi waktu 06:30', '/pagi nonaktif']) {
      await handleIncomingMessage(mockSock as any, {
        key: { remoteJid: allowedUserJid, id: `IN_${text}` },
        message: { conversation: text },
      });
    }

    expect(sentMessages[0]).toContain('nonaktif');
    expect(sentMessages[1]).toContain('diaktifkan');
    expect(sentMessages[2]).toContain('06:30');
    expect(sentMessages[3]).toContain('dinonaktifkan');

    const saved = await db.select().from(userSettings);
    expect(saved[0]?.morningDigestEnabled).toBe(false);
    expect(saved[0]?.morningDigestTime).toBe('06:30');
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

  it('should resolve task when user reacts with ✅ emoji string or Baileys reaction object', async () => {
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

    // Trigger reaction event with real Baileys object structure
    await handleIncomingReaction(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: botMsgId },
      reaction: { text: '✅', key: { remoteJid: allowedUserJid, fromMe: false } },
    });

    const checkTask = await db.select().from(tasks);
    expect(checkTask[0]?.status).toBe('resolved');
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Tugas Selesai');
  });

  it('should cancel task when user reacts with ❌ emoji', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);
    const task = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Jadwal beli perlengkapan kantor',
      status: 'pending',
    });

    const botMsgId = 'BOT_MSG_CANCEL_100';
    await linkTaskMessage(db, task.id, botMsgId);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_CANCEL_RESP' } };
      },
    };

    // Trigger cancellation reaction
    await handleIncomingReaction(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: botMsgId },
      reaction: { text: '❌', key: { remoteJid: allowedUserJid, fromMe: false } },
    });

    const checkTask = await db.select().from(tasks);
    expect(checkTask[0]?.status).toBe('cancelled');
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Tugas Dibatalkan');
  });

  it('should cancel task when user replies with ❌ or "batal" to a bot message', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);
    const task = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Review PR frontend',
      status: 'pending',
    });

    const botMsgId = 'BOT_MSG_REPLY_CANCEL';
    await linkTaskMessage(db, task.id, botMsgId);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_REPLY_RESP' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'USER_REPLY_MSG' },
      message: {
        extendedTextMessage: {
          text: '❌',
          contextInfo: {
            stanzaId: botMsgId,
          },
        },
      },
    });

    const checkTask = await db.select().from(tasks);
    expect(checkTask[0]?.status).toBe('cancelled');
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Tugas Dibatalkan');
  });

  it('should provide dynamic suggestions when task has no time or date', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_BOT_SUGGESTION' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'MSG_TASK_NO_TIME' },
      message: { conversation: 'Beli obat batuk dan vitamin c' },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Tugas Siap Dicatat!');
    expect(sentMessages[0]).toContain('1️⃣');
    expect(sentMessages[0]).toContain('2️⃣');
    expect(sentMessages[0]).toContain('3️⃣');
  });

  it('should reschedule task via quoted reply "ubah waktu: ..."', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);
    const task = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Presentasi Proyek',
      deadline: new Date('2026-09-28T10:00:00.000Z'),
      status: 'pending',
    });

    const botMsgId = 'BOT_MSG_TASK_PRES';
    await linkTaskMessage(db, task.id, botMsgId);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_RESCHEDULE_RESP' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'USER_REPLY_RESCHEDULE' },
      message: {
        extendedTextMessage: {
          text: 'ubah waktu: besok jam 15:00',
          contextInfo: { stanzaId: botMsgId },
        },
      },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Jadwal Berhasil Diperbarui!');

    const updatedTask = (await db.select().from(tasks))[0];
    expect(updatedTask?.deadline).not.toBeNull();
  });

  it('should rename task via quoted reply "ubah tugas: ..."', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);
    const task = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Rapat Tim',
      status: 'pending',
    });

    const botMsgId = 'BOT_MSG_TASK_RAPAT';
    await linkTaskMessage(db, task.id, botMsgId);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_RENAME_RESP' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'USER_REPLY_RENAME' },
      message: {
        extendedTextMessage: {
          text: 'ubah tugas: Rapat Evaluasi Sprint Q3',
          contextInfo: { stanzaId: botMsgId },
        },
      },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Nama Tugas Berhasil Diperbarui!');
    expect(sentMessages[0]).toContain('Rapat Evaluasi Sprint Q3');

    const updatedTask = (await db.select().from(tasks))[0];
    expect(updatedTask?.task).toBe('Rapat Evaluasi Sprint Q3');
  });

  it('should add subtask via quoted reply "subtask: ..."', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);
    const parent = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Persiapan Peluncuran Produk',
      status: 'pending',
    });

    const botMsgId = 'BOT_MSG_PARENT_PROD';
    await linkTaskMessage(db, parent.id, botMsgId);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_SUBTASK_REPLY' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'USER_REPLY_SUBTASK' },
      message: {
        extendedTextMessage: {
          text: 'subtask: Siapkan materi presentasi besok jam 09:00',
          contextInfo: { stanzaId: botMsgId },
        },
      },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Sub-Tugas Berhasil Ditambahkan!');
    expect(sentMessages[0]).toContain('Persiapan Peluncuran Produk');

    const allTasks = await db.select().from(tasks);
    expect(allTasks.length).toBe(2);
    const subtask = allTasks.find((t) => t.parentId === parent.id);
    expect(subtask).toBeDefined();
    expect(subtask?.task.toLowerCase()).toContain('materi');
  });

  it('should display history log with "riwayat <ID>" command', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);
    const task = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Tugas Uji Riwayat',
      status: 'pending',
    });

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_HIST' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'USER_CMD_HIST' },
      message: { conversation: `riwayat ${task.id}` },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Riwayat & Audit Trail Tugas');
    expect(sentMessages[0]).toContain('Kondisi Saat Ini');
    expect(sentMessages[0]).toContain('Tugas dibuat');
    expect(sentMessages[0]).toContain('Deadline awal');
  });

  it('should reschedule task via direct command "reschedule <ID> <waktu>"', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);
    const task = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Uji Direct Reschedule',
      deadline: new Date('2026-09-28T10:00:00.000Z'),
      status: 'pending',
    });

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_CMD_RESCHEDULE' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'USER_CMD_RESCHEDULE' },
      message: { conversation: `reschedule ${task.id} besok jam 16:00` },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Jadwal Berhasil Diperbarui!');
    expect(sentMessages[0]).toContain('Waktu lama:');
    expect(sentMessages[0]).toContain('Waktu baru:');
  });

  it('should display task tree and details with "detail <ID>" command', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);
    const parent = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Tugas Utama Proyek',
      status: 'pending',
    });

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_DETAIL' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'USER_CMD_DETAIL' },
      message: { conversation: `detail ${parent.id}` },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Detail & Struktur Tugas');
    expect(sentMessages[0]).toContain('Tugas Utama Proyek');
  });

  it('should extend deadline by 30 mins and reset reminded when user replies "1" to overdue reminder', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);
    const task = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Review PR Backend',
      deadline: new Date(Date.now() - 20 * 60 * 1000), // 20 mins ago
      status: 'pending',
    });

    // Mark task as alerted (overdue final reminder sent)
    await db.update(tasks).set({ reminded: 2 });

    const reminderMsgId = 'REMINDER_OVERDUE_MSG_1';
    await linkTaskMessage(db, task.id, reminderMsgId);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'BOT_CONFIRM_1' } };
      },
    };

    // User replies (quotes) the overdue reminder with "1" (+30 mins)
    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'USER_REPLY_1' },
      message: {
        extendedTextMessage: {
          text: '1',
          contextInfo: { stanzaId: reminderMsgId },
        },
      },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Waktu Ekstra Ditambahkan!');
    expect(sentMessages[0]).toContain('Review PR Backend');

    // Verify task in DB has updated deadline in the future and reminded reset to 0
    const checkDb = await db.select().from(tasks);
    expect(checkDb[0]?.reminded).toBe(0);
    expect(checkDb[0]?.deadline?.getTime()).toBeGreaterThan(Date.now());
  });

  it('should prompt extension choices when user replies "buat lagi" to overdue reminder', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);
    const task = await createTask(db, {
      userJid: allowedUserJid,
      task: 'Follow up client vendor',
      deadline: new Date(Date.now() - 25 * 60 * 1000),
      status: 'pending',
    });

    await db.update(tasks).set({ reminded: 2 });
    const reminderMsgId = 'REMINDER_OVERDUE_MSG_2';
    await linkTaskMessage(db, task.id, reminderMsgId);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'BOT_PROMPT_EXTEND' } };
      },
    };

    // User quotes and sends "buat lagi"
    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'USER_REPLY_BUAT_LAGI' },
      message: {
        extendedTextMessage: {
          text: 'buat lagi',
          contextInfo: { stanzaId: reminderMsgId },
        },
      },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Mau perpanjang berapa lama');
    expect(sentMessages[0]).toContain('+30 menit');
    expect(sentMessages[0]).toContain('besok jam 09:00');
  });

  it('should display image quality setting status with "/setting media"', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_SETTING_MEDIA' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'CMD_SETTING_MEDIA' },
      message: { conversation: '/setting media' },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Pengaturan Kualitas Gambar');
    expect(sentMessages[0]).toContain('Kualitas Tinggi / High (Maksimal 4096px / 4K - Default)');
  });

  it('should change image quality to compact and high via command', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_CHANGE_QUALITY' } };
      },
    };

    // 1. Change to compact
    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'CMD_MEDIA_COMPACT' },
      message: { conversation: '/setting media hemat' },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Hemat (Compact / 2K)');

    const userSettingsCheck1 = await db.select().from(userSettings);
    expect(userSettingsCheck1[0]?.imageQualityMode).toBe('compact');

    // 2. Change back to high
    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'CMD_MEDIA_HIGH' },
      message: { conversation: '/setting media tinggi' },
    });

    expect(sentMessages.length).toBe(2);
    expect(sentMessages[1]).toContain('Tinggi (High / 4K)');

    const userSettingsCheck2 = await db.select().from(userSettings);
    expect(userSettingsCheck2[0]?.imageQualityMode).toBe('high');
  });

  it('should not intercept normal tasks starting with "media" as a setting command', async () => {
    await ensureUserSettings(db, allowedUserJid, 'Owner', true);

    const sentMessages: string[] = [];
    const mockSock = {
      sendMessage: async (jid: string, content: any) => {
        sentMessages.push(content.text);
        return { key: { id: 'MSG_MEDIA_TASK' } };
      },
    };

    await handleIncomingMessage(mockSock as any, {
      key: { remoteJid: allowedUserJid, id: 'CMD_MEDIA_TASK' },
      message: { conversation: 'Media briefing rilis pers besok jam 10:00' },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).not.toContain('Pilihan kualitas gambar tidak dikenali');
    expect(sentMessages[0]).toContain('Tugas Dicatat');
    expect(sentMessages[0]).toContain('Media briefing');

    const createdTasks = await db.select().from(tasks);
    expect(createdTasks.length).toBe(1);
    expect(createdTasks[0]?.task).toContain('Media briefing');
  });
});
