import { db } from '../../db/index.js';
import {
  ensureUserSettings,
  createTask,
  linkTaskMessage,
  findTaskByMessageId,
  resolveTask,
  cancelTask,
  listActiveTasks,
  updateTaskDeadline,
  getLatestPendingDeadlineTask,
} from '../../services/task.js';
import { parseTaskMessage, parseLocalTask } from '../../services/nlp.js';
import { calculateRemindAt } from '../../services/reminder.js';
import { generateAffirmation } from '../../services/affirmation.js';

export function formatDateTime(date: Date, timezone = 'Asia/Jakarta'): string {
  try {
    return date.toLocaleString('id-ID', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return date.toISOString();
  }
}

const HELP_MESSAGE = `Halo! 👋 Aku asisten pengingat tugasmu. Kamu bisa santai ngobrol atau gunakan panduan ringkas ini:

📌 *Mencatat Tugas Baru:*
Ketik langsung tugasmu seperti biasa, contoh:
• _"Besok jam 2 siang ada jadwal meeting dengan klien"_
• _"Ingatkan beli obat nanti malam jam 8"_
• Atau langsung *teruskan (forward)* pesan chat penting ke sini!

📋 *Mengecek Tugas:*
• Ketik *daftar* atau */list* untuk melihat semua tugas yang belum selesai.

✅ *Menyelesaikan Tugas:*
• Beri reaksi emoji ✅ pada pesan pengingat, ATAU
• Balas pesan pengingat dengan emoji ✅, ATAU
• Ketik *selesai <nomor_tugas>* (contoh: _selesai 2_)

❌ *Membatalkan Tugas:*
• Ketik *batal <nomor_tugas>* (contoh: _batal 2_)

Kapan pun kamu butuh bantuan, cukup ketik *help* atau *bantuan* ya! ✨`;

import { jidNormalizedUser } from '@whiskeysockets/baileys';

/**
 * Handles incoming WhatsApp messages
 */
export async function handleIncomingMessage(sock: any, msg: any): Promise<void> {
  if (!msg.message || !msg.key?.remoteJid) return;
  const rawJid = msg.key.remoteJid;

  // Ignore status broadcast messages or group chats
  if (rawJid === 'status@broadcast' || rawJid.endsWith('@g.us')) return;

  // Normalize JID (strips device ID like :12@s.whatsapp.net to 628xxx@s.whatsapp.net)
  const remoteJid = jidNormalizedUser(rawJid);

  const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    '';

  const trimmedText = text.trim();
  if (!trimmedText) return;

  console.log(`📩 [Pesan Masuk] Dari: ${remoteJid} (Raw: ${rawJid}) | Teks: "${trimmedText}"`);

  const contextInfo = msg.message.extendedTextMessage?.contextInfo;
  const isForwarded = Boolean(contextInfo?.isForwarded);
  const stanzaId = contextInfo?.stanzaId;

  // 1. Check user permission
  const user = await ensureUserSettings(db, remoteJid, msg.pushName || null, false);
  if (!user.isAllowed) {
    console.warn(`⛔ [Akses Ditolak] Nomor ${remoteJid} belum diizinkan (is_allowed = false).`);
    await sock.sendMessage(remoteJid, {
      text: `⚠️ *Akses Dibatasi*\n\nNomor Anda (${remoteJid.replace('@s.whatsapp.net', '')}) belum terdaftar dalam whitelist bot to-do ini. Silakan hubungi pemilik bot atau periksa tabel database.`,
    });
    return;
  }

  // 2. Help command (includes /help, help, halp, bantuan, menu)
  if (/^(\/help|help|halp|bantuan|menu)$/i.test(trimmedText)) {
    console.log(`ℹ️ [Command] Menampilkan panduan bantuan untuk ${remoteJid}`);
    await sock.sendMessage(remoteJid, { text: HELP_MESSAGE });
    return;
  }

  // 3. List active tasks
  if (/^(\/list|list|daftar|daftar tugas|todo)$/i.test(trimmedText)) {
    const activeTasks = await listActiveTasks(db, remoteJid);
    if (activeTasks.length === 0) {
      await sock.sendMessage(remoteJid, { text: 'Saat ini tidak ada tugas aktif. Santai dulu! 🎉' });
      return;
    }

    let reply = '📋 *Daftar Tugas Aktif:*\n\n';
    activeTasks.forEach((t, idx) => {
      const deadlineStr = t.deadline
        ? `⏰ Deadline: ${formatDateTime(new Date(t.deadline), user.timezone)}`
        : '⏰ Waktu: Belum ditentukan';
      reply += `${idx + 1}. [ID: ${t.id}] *${t.task}*\n   ${deadlineStr}\n\n`;
    });
    reply += 'Ketik *selesai <ID>* untuk menandai selesai.\nKetik *batal <ID>* untuk membatalkan.';

    await sock.sendMessage(remoteJid, { text: reply.trim() });
    return;
  }

  // 4. Resolve task via command
  const resolveMatch = trimmedText.match(/^(\/selesai|\/done|selesai|done)\s+(\d+)$/i);
  if (resolveMatch && resolveMatch[2]) {
    const taskId = parseInt(resolveMatch[2], 10);
    const resolved = await resolveTask(db, taskId, remoteJid);
    if (!resolved) {
      await sock.sendMessage(remoteJid, { text: `Tugas ID [${taskId}] tidak ditemukan atau sudah selesai.` });
      return;
    }

    const affirmation = await generateAffirmation(resolved.task);
    await sock.sendMessage(remoteJid, {
      text: `🎉 *Tugas Selesai!* [ID: ${resolved.id}] ${resolved.task}\n\n_${affirmation}_`,
    });
    return;
  }

  // 5. Cancel task via command
  const cancelMatch = trimmedText.match(/^(\/batal|\/hapus|batal|hapus)\s+(\d+)$/i);
  if (cancelMatch && cancelMatch[2]) {
    const taskId = parseInt(cancelMatch[2], 10);
    const cancelled = await cancelTask(db, taskId, remoteJid);
    if (!cancelled) {
      await sock.sendMessage(remoteJid, { text: `Tugas ID [${taskId}] tidak ditemukan.` });
      return;
    }

    await sock.sendMessage(remoteJid, { text: `❌ Tugas ID [${taskId}] berhasil dibatalkan.` });
    return;
  }

  // 6. Quoted reply with checkmark (✅)
  if (trimmedText === '✅' || trimmedText === 'selesai') {
    let targetTask = null;
    if (stanzaId) {
      targetTask = await findTaskByMessageId(db, stanzaId);
    }
    if (!targetTask) {
      const activeList = await listActiveTasks(db, remoteJid);
      if (activeList.length === 1 && activeList[0]) {
        targetTask = activeList[0];
      }
    }

    if (targetTask) {
      const resolved = await resolveTask(db, targetTask.id, remoteJid);
      if (resolved) {
        const affirmation = await generateAffirmation(resolved.task);
        await sock.sendMessage(remoteJid, {
          text: `🎉 *Tugas Selesai!* ${resolved.task}\n\n_${affirmation}_`,
        });
        return;
      }
    }
  }

  // 7. Check if user is replying with a deadline for an existing pending_deadline task
  let pendingTask = null;
  if (stanzaId) {
    const matched = await findTaskByMessageId(db, stanzaId);
    if (matched && matched.status === 'pending_deadline') {
      pendingTask = matched;
    }
  }
  if (!pendingTask) {
    pendingTask = await getLatestPendingDeadlineTask(db, remoteJid, 15);
  }

  if (pendingTask) {
    // Quick preset options
    let parsedTimeText = trimmedText;
    if (trimmedText === '1' || trimmedText === '1️⃣' || /nanti sore/i.test(trimmedText)) {
      parsedTimeText = 'hari ini jam 17:00';
    } else if (trimmedText === '2' || trimmedText === '2️⃣' || /besok pagi/i.test(trimmedText)) {
      parsedTimeText = 'besok jam 09:00';
    }

    const localParsed = parseLocalTask(parsedTimeText, new Date());
    if (localParsed.deadline) {
      const remindAt = calculateRemindAt(localParsed.deadline, {
        leadMinutes: user.leadReminderMinutes,
      });

      const updated = await updateTaskDeadline(db, pendingTask.id, localParsed.deadline, remindAt);
      if (updated) {
        const deadlineStr = formatDateTime(localParsed.deadline, user.timezone);
        const reply = await sock.sendMessage(remoteJid, {
          text: `✅ *Waktu Disimpan!*\n📝 Tugas: *${updated.task}*\n⏰ Deadline: *${deadlineStr}*\n\nAku akan ingatkan saat mendekati waktunya. Semangat!`,
        });
        if (reply?.key?.id) {
          await linkTaskMessage(db, updated.id, reply.key.id);
        }
        return;
      }
    }
  }

  // 8. Natural Language Ingestion for new task
  const nlpResult = await parseTaskMessage(trimmedText, {
    now: new Date(),
    timezone: user.timezone,
    isForwarded,
  });

  if (!nlpResult.isTask) {
    // Reply warmly to greetings so the user knows the bot is active and ready
    if (/^(halo|hai|hey|p|ping|assalamualaikum|pagi|siang|sore|malam|tes|test)\b/i.test(trimmedText)) {
      console.log(`👋 [Sapaan] Membalas salam ramah ke ${remoteJid}`);
      await sock.sendMessage(remoteJid, {
        text: `Halo! 👋 Aku asisten pengingat tugasmu.\n\nAda tugas yang ingin dicatat hari ini? Kamu bisa ketik langsung (contoh: _"Besok jam 2 siang rapat tim"_), atau ketik *help* untuk melihat panduan ya! ✨`,
      });
    }
    return;
  }

  if (nlpResult.needsDeadline || !nlpResult.deadline) {
    const created = await createTask(db, {
      userJid: remoteJid,
      task: nlpResult.taskTitle,
      status: 'pending_deadline',
    });

    const reply = await sock.sendMessage(remoteJid, {
      text: `📝 *Tugas Dicatat!*\n"${created.task}"\n\nKapan mau diingatkan? Balas pesan ini dengan waktu (contoh: *besok jam 2 siang*) atau pilih opsi:\n1️⃣ Nanti Sore (17:00)\n2️⃣ Besok Pagi (09:00)`,
    });

    if (reply?.key?.id) {
      await linkTaskMessage(db, created.id, reply.key.id);
    }
    return;
  }

  // Task has a deadline
  const remindAt = calculateRemindAt(nlpResult.deadline, {
    leadMinutes: user.leadReminderMinutes,
  });

  const created = await createTask(db, {
    userJid: remoteJid,
    task: nlpResult.taskTitle,
    deadline: nlpResult.deadline,
    remindAt,
    status: 'pending',
  });

  const deadlineStr = formatDateTime(nlpResult.deadline, user.timezone);
  const reply = await sock.sendMessage(remoteJid, {
    text: `✅ *Tugas Dicatat!*\n📝: *${created.task}*\n⏰ Deadline: *${deadlineStr}*\n\nAku akan ingatkan mendekati waktu tersebut. Semangat!`,
  });

  if (reply?.key?.id) {
    await linkTaskMessage(db, created.id, reply.key.id);
  }
}

/**
 * Handles incoming WhatsApp reaction events (e.g. clicking ✅ on message)
 */
export async function handleIncomingReaction(sock: any, reactionEvent: any): Promise<void> {
  const reaction = reactionEvent.reaction || reactionEvent.text;
  const messageId = reactionEvent.key?.id;
  const remoteJid = reactionEvent.key?.remoteJid;

  if (reaction !== '✅' || !messageId || !remoteJid) return;

  const matchedTask = await findTaskByMessageId(db, messageId);
  if (!matchedTask || matchedTask.status === 'resolved' || matchedTask.status === 'cancelled') {
    return;
  }

  const resolved = await resolveTask(db, matchedTask.id, remoteJid);
  if (resolved) {
    const affirmation = await generateAffirmation(resolved.task);
    await sock.sendMessage(remoteJid, {
      text: `🎉 *Tugas Selesai!*\n"${resolved.task}"\n\n_${affirmation}_`,
    });
  }
}
