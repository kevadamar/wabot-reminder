import { describe, expect, it } from 'bun:test';
import { generateReminderMessage } from '../../src/services/reminder.js';

describe('Seam 2: Dynamic & Human Reminder Messaging', () => {
  const dummyTask = {
    id: 1,
    userJid: '628123456789@s.whatsapp.net',
    task: 'Siapkan bahan presentasi roadmap',
    deadline: new Date('2026-09-27T10:00:00.000Z'),
    remindAt: new Date('2026-09-27T09:30:00.000Z'),
    reminded: 0,
    status: 'pending' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should generate reminder message using Gemini with thinkingLevel config when client succeeds', async () => {
    let capturedPayload: any = null;
    const mockGemini = {
      models: {
        generateContent: async (payload: any) => {
          capturedPayload = payload;
          return {
            text: 'Hai! ☕ Waktunya meluangkan momen untuk *"Siapkan bahan presentasi roadmap"*. Target: Minggu, 27 Sep 17:00. Semangat ya! (Reaksi ✅ jika sudah beres, atau ❌ jika batal)',
          };
        },
      },
    };

    const msg = await generateReminderMessage(dummyTask, false, 'Minggu, 27 Sep 17:00', mockGemini as any);

    expect(msg).toContain('Siapkan bahan presentasi roadmap');
    expect(msg).toContain('✅');
    expect(capturedPayload.model).toBe('gemini-3.1-flash-lite');
    expect(capturedPayload.config?.thinkingConfig?.thinkingLevel).toBe('MEDIUM');
  });

  it('should fallback to warm human-written templates when Gemini throws an error', async () => {
    const mockFaultyGemini = {
      models: {
        generateContent: async () => {
          throw new Error('Gemini API Timeout');
        },
      },
    };

    const regularMsg = await generateReminderMessage(dummyTask, false, 'Minggu, 27 Sep 17:00', mockFaultyGemini as any);
    expect(regularMsg).toContain('Siapkan bahan presentasi roadmap');
    expect(regularMsg).toContain('✅');
    expect(regularMsg).toContain('❌');
    // Ensure it does not sound like collecting debt
    expect(regularMsg.toLowerCase()).not.toContain('jatuh tempo');
    expect(regularMsg.toLowerCase()).not.toContain('telah melewati batas waktu');

    const overdueMsg = await generateReminderMessage(dummyTask, true, 'Minggu, 27 Sep 17:00', mockFaultyGemini as any);
    expect(overdueMsg).toContain('Siapkan bahan presentasi roadmap');
    expect(overdueMsg).toContain('✅');
    expect(overdueMsg).toContain('❌');
    expect(overdueMsg.toLowerCase()).not.toContain('jatuh tempo');
    expect(overdueMsg.toLowerCase()).not.toContain('peringatan tenggat waktu');
  });

  it('should fallback properly when no Gemini client is configured', async () => {
    const msg = await generateReminderMessage(dummyTask, false, 'Minggu, 27 Sep 17:00', null);
    expect(msg).toContain('Siapkan bahan presentasi roadmap');
    expect(msg).toContain('✅');
    expect(msg).toContain('❌');
  });

  it('should instruct Gemini with playful anti-mager persona and user name for manual trigger', async () => {
    let capturedPayload: any = null;
    const mockGemini = {
      models: {
        generateContent: async (payload: any) => {
          capturedPayload = payload;
          return {
            text: 'Halo Keva! 👋 Admin colek dikit nih… jangan biarkan jurus mager menang ya! Coba intip tugas *"Siapkan bahan presentasi roadmap"*, yuk tuntaskan sekarang! (Balas selesai / 1/2/3 / batal)',
          };
        },
      },
    };

    const msg = await generateReminderMessage(
      dummyTask,
      true,
      'Minggu, 27 Sep 17:00',
      mockGemini as any,
      null,
      { userName: 'Keva', isManualTrigger: true }
    );

    expect(msg).toContain('Halo Keva!');
    expect(capturedPayload.contents).toContain('Halo Keva!');
    expect(capturedPayload.contents).toContain('PENGINGAT KHUSUS/MANUAL YANG DITRIGGER ADMIN DARI DASHBOARD');
    expect(capturedPayload.contents.toLowerCase()).toContain('mager');
  });

  it('should fallback to playful anti-mager templates with user name on manual trigger', async () => {
    const msgWithName = await generateReminderMessage(
      dummyTask,
      true,
      'Minggu, 27 Sep 17:00',
      null,
      null,
      { userName: 'Keva', isManualTrigger: true }
    );

    expect(msgWithName).toContain('Halo Keva!');
    expect(msgWithName).toContain('Siapkan bahan presentasi roadmap');
    expect(msgWithName.toLowerCase()).toMatch(/admin|mager|anti-mager|rebahan/);
    expect(msgWithName).toContain('selesai');
    expect(msgWithName).toContain('batal');

    // Without user name, should default to 'Halo!'
    const msgWithoutName = await generateReminderMessage(
      dummyTask,
      true,
      'Minggu, 27 Sep 17:00',
      null,
      null,
      { userName: null, isManualTrigger: true }
    );
    expect(msgWithoutName).toContain('Halo!');
    expect(msgWithoutName).not.toContain('Halo kak');
    expect(msgWithoutName).not.toContain('Halo null');
    expect(msgWithoutName).toContain('Siapkan bahan presentasi roadmap');
  });
});
