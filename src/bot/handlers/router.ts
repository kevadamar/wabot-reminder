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
  getLatestRemindedTask,
  rescheduleTask,
  renameTask,
  createSubtask,
  getTaskTree,
  getTaskHistory,
  addAttachmentToTask,
  getTaskAttachments,
  updateImageQualityMode,
  updateUserName,
  updateLeadReminderMinutes,
} from '../../services/task.js';
import { parseTaskMessage, parseLocalTask } from '../../services/nlp.js';
import { calculateRemindAt } from '../../services/reminder.js';
import { generateAffirmation } from '../../services/affirmation.js';
import {
  parseMorningDigestCommand,
  updateMorningDigestSettings,
} from '../../services/morning-digest.js';
import {
  validateMediaBuffer,
  sanitizeImageBuffer,
  sanitizeDocumentBuffer,
  screenAndExtractImageWithAI,
  saveAttachmentToStorage,
} from '../../services/media.js';
import { jidNormalizedUser, downloadMediaMessage } from '@whiskeysockets/baileys';

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

export const TASK_FOOTER_NOTE = `\n\n💡 _Tips: Ingin ubah jadwal, judul, atau tambah sub-tugas? Cukup balas pesan ini:_\n• *ubah waktu: <waktu baru>* (cth: _ubah waktu: besok jam 3 sore_)\n• *ubah tugas: <nama baru>* (cth: _ubah tugas: Presentasi Q3_)\n• *subtask: <sub-tugas & waktu>* (cth: _subtask: Cetak materi jam 9 pagi_)`;

const HELP_MESSAGE = `Halo! 👋 Aku asisten pengingat tugasmu. Kamu bisa santai ngobrol atau gunakan panduan ringkas ini:

📌 *Mencatat Tugas Baru:*
• Ketik langsung tugasmu: _"Besok jam 2 siang meeting dengan klien"_
• Atau kirim *foto / dokumen (PDF)* dengan caption tugas!
• Atau *teruskan (forward)* pesan penting ke sini.

🔄 *Mengubah Jadwal & Judul (Reply):*
Balas langsung ke pesan tugas yang ingin diubah:
• *ubah waktu: <waktu baru>* (cth: _ubah waktu: besok jam 15:00_)
• *ubah tugas: <judul baru>* (cth: _ubah tugas: Presentasi Pitch Deck_)

🌿 *Sub-Tugas (Tugas Bersarang):*
• Balas pesan tugas: *subtask: <nama sub-tugas & waktu>* (cth: _subtask: Siapkan materi slide besok jam 9 pagi_)
• Atau via perintah: *subtask <ID_tugas> <nama & waktu>*
• Sub-tugas memiliki pengingat tersendiri!

📋 *Mengecek & Melihat Struktur:*
• *daftar* atau */list* : Melihat semua tugas aktif & sub-tugas
• *tree <ID>* atau *detail <ID>* : Melihat struktur pohon tugas & lampiran
• *riwayat <ID>* : Melihat riwayat perubahan/audit tugas

🌤️ *Ringkasan Pagi (Opt-in):*
• */pagi aktif* : Aktifkan ringkasan task harian
• */pagi nonaktif* : Nonaktifkan ringkasan pagi
• */pagi waktu 06:30* : Atur waktu lokal pengiriman
• */pagi status* : Lihat pengaturan saat ini

🖼️ *Kualitas Gambar Lampiran:*
• */setting media tinggi* : Simpan hingga 4K (4096px, default)
• */setting media hemat* : Simpan resolusi hemat (2048px)
• */setting media* : Cek status pengaturan saat ini

👤 *Nama Pengguna:*
• */username <NamaKamu>* : Atur nama panggilan agar bot mengenali kamu
• */username* : Cek nama panggilan saat ini

⏱️ *Waktu Pengingat (Lead Time):*
• */setting reminder <menit>* : Atur waktu pengingat awal (cth: _/setting reminder 10_)
• */setting reminder* : Cek waktu pengingat saat ini

✅ *Menyelesaikan Tugas:*
• Beri reaksi emoji ✅ pada pesan pengingat, ATAU
• Balas pesan pengingat dengan emoji ✅ / ketik *selesai*, ATAU
• Ketik *selesai <nomor_tugas>* (cth: _selesai 2_)

❌ *Membatalkan Tugas:*
• Beri reaksi emoji ❌ pada pesan pengingat, ATAU
• Balas pesan pengingat dengan emoji ❌ / ketik *batal*, ATAU
• Ketik *batal <nomor_tugas>* (cth: _batal 2_)

Kapan pun kamu butuh bantuan, cukup ketik *help* atau *bantuan* ya! ✨`;

/**
 * Formats a single task history item into human-readable timeline text
 */
function formatHistoryAction(item: any, timezone: string): string {
  const dateStr = formatDateTime(new Date(item.createdAt), timezone);
  switch (item.changeType) {
    case 'create': {
      const initDeadline = item.oldValue
        ? formatDateTime(new Date(item.oldValue), timezone)
        : 'Belum ditentukan';
      return `• [${dateStr}] ➕ Tugas dibuat: "${item.newValue}"\n   ⏰ Deadline awal: ${initDeadline}`;
    }
    case 'reschedule': {
      const oldDate = item.oldValue
        ? formatDateTime(new Date(item.oldValue), timezone)
        : 'Belum ada jadwal';
      const newDate = item.newValue
        ? formatDateTime(new Date(item.newValue), timezone)
        : 'Tanpa waktu';
      let entry = `• [${dateStr}] 🔄 Jadwal diubah: ${oldDate} ➔ ${newDate}`;
      if (item.rawInput) {
        entry += `\n   💬 Catatan/Pesan: _"${item.rawInput}"_`;
      }
      return entry;
    }
    case 'rename': {
      const oldTitle = item.oldValue ? `"${item.oldValue}" ➔ ` : '';
      let entry = `• [${dateStr}] ✏️ Judul diubah: ${oldTitle}"${item.newValue}"`;
      if (item.rawInput) {
        entry += `\n   💬 Catatan/Pesan: _"${item.rawInput}"_`;
      }
      return entry;
    }
    case 'resolve':
      return `• [${dateStr}] ✅ Tugas diselesaikan`;
    case 'cancel':
      return `• [${dateStr}] ❌ Tugas dibatalkan`;
    case 'attachment':
      return `• [${dateStr}] 📎 Lampiran ditambahkan: "${item.newValue || 'file'}"`;
    default:
      return `• [${dateStr}] ℹ️ Perubahan ${item.changeType}: ${item.newValue || ''}`;
  }
}

/**
 * Returns dynamic contextual time suggestions based on current hour in user's timezone.
 */
export function getDynamicTimeSuggestions(timezone = 'Asia/Jakarta', now = new Date()): Array<{ label: string; text: string }> {
  let currentHour = 10;
  try {
    const hourStr = now.toLocaleTimeString('en-US', { timeZone: timezone, hour12: false, hour: '2-digit' });
    currentHour = parseInt(hourStr, 10);
  } catch {}

  if (currentHour < 12) {
    return [
      { label: 'Siang ini (13:00)', text: 'hari ini jam 13:00' },
      { label: 'Nanti sore (17:00)', text: 'hari ini jam 17:00' },
      { label: 'Besok pagi (09:00)', text: 'besok jam 09:00' },
    ];
  } else if (currentHour < 17) {
    return [
      { label: 'Nanti sore (17:00)', text: 'hari ini jam 17:00' },
      { label: 'Malam ini (20:00)', text: 'hari ini jam 20:00' },
      { label: 'Besok pagi (09:00)', text: 'besok jam 09:00' },
    ];
  } else if (currentHour < 21) {
    return [
      { label: 'Malam ini (21:00)', text: 'hari ini jam 21:00' },
      { label: 'Besok pagi (09:00)', text: 'besok jam 09:00' },
      { label: 'Besok siang (13:00)', text: 'besok jam 13:00' },
    ];
  } else {
    return [
      { label: 'Besok pagi (09:00)', text: 'besok jam 09:00' },
      { label: 'Besok siang (13:00)', text: 'besok jam 13:00' },
      { label: 'Besok sore (17:00)', text: 'besok jam 17:00' },
    ];
  }
}

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

  const isImage = Boolean(msg.message.imageMessage);
  const isDocument = Boolean(
    msg.message.documentMessage ||
    msg.message.documentWithCaptionMessage?.message?.documentMessage
  );

  const docFileName =
    msg.message.documentMessage?.fileName ||
    msg.message.documentWithCaptionMessage?.message?.documentMessage?.fileName ||
    null;

  const caption =
    msg.message.imageMessage?.caption ||
    msg.message.documentMessage?.caption ||
    msg.message.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    '';

  const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    caption ||
    '';

  const trimmedText = text.trim();

  // If there's neither text nor media, ignore
  if (!trimmedText && !isImage && !isDocument) return;

  console.log(`📩 [Pesan Masuk] Jenis: ${isImage ? 'image' : isDocument ? 'document' : 'text'}`);

  const contextInfo = msg.message.extendedTextMessage?.contextInfo ||
    msg.message.imageMessage?.contextInfo ||
    msg.message.documentMessage?.contextInfo;
  const isForwarded = Boolean(contextInfo?.isForwarded);
  const stanzaId = contextInfo?.stanzaId;

  // 1. Check user permission
  const user = await ensureUserSettings(db, remoteJid, msg.pushName || null, false);
  if (!user.isAllowed) {
    console.warn('⛔ [Akses Ditolak] Pesan dari user yang belum diizinkan diabaikan.');
    await sock.sendMessage(remoteJid, {
      text: `⚠️ *Akses Dibatasi*\n\nNomor Anda (${remoteJid.replace('@s.whatsapp.net', '')}) belum terdaftar dalam whitelist bot to-do ini. Silakan hubungi pemilik bot atau periksa tabel database.`,
    });
    return;
  }

  // 2. Handle Media / Attachments (Images & Documents)
  if (isImage || isDocument) {
    let buffer: Buffer;
    try {
      buffer = (await downloadMediaMessage(msg, 'buffer', {})) as Buffer;
    } catch (err: any) {
      console.error(`[Media] Gagal mengunduh media: ${err?.message || err}`);
      await sock.sendMessage(remoteJid, {
        text: '⚠️ Gagal mengunduh file media dari WhatsApp. Silakan coba kirim ulang.',
      });
      return;
    }

    const claimedMime = msg.message.imageMessage?.mimetype || msg.message.documentMessage?.mimetype || undefined;
    const validation = await validateMediaBuffer(buffer, claimedMime);
    if (!validation.isValid) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ *Lampiran Ditolak:*\n${validation.error}`,
      });
      return;
    }

    let sanitized;
    let aiResult: any = null;

    if (validation.fileType === 'image') {
      try {
        const maxDimension = user.imageQualityMode === 'compact' ? 2048 : 4096;
        sanitized = await sanitizeImageBuffer(buffer, { maxDimension, quality: 85 });
      } catch (err: any) {
        await sock.sendMessage(remoteJid, {
          text: '⚠️ File gambar korup atau gagal diproses oleh sistem sanitasi.',
        });
        return;
      }

      // Layer 4: Multimodal AI screening (scam/phishing & OCR)
      aiResult = await screenAndExtractImageWithAI(sanitized.buffer, sanitized.mimeType);
      if (aiResult.isSuspicious) {
        console.warn('🚨 [Keamanan] Gambar mencurigakan ditolak oleh media screening.');
        await sock.sendMessage(remoteJid, {
          text: `🚨 *Peringatan Keamanan!*\nGambar terdeteksi mencurigakan atau berpotensi bahaya/penipuan: _${aiResult.safetyReason || 'Indikasi phishing/scam'}_.\n\nFile ditolak dan tidak disimpan demi keamananmu.`,
        });
        return;
      }
    } else {
      sanitized = sanitizeDocumentBuffer(
        buffer,
        validation.detectedMime || 'application/pdf',
        validation.detectedExt || 'pdf'
      );
    }

    // Save to S3 (Rust FS) or sandboxed local storage
    const storagePath = await saveAttachmentToStorage(sanitized.buffer, sanitized.extension, sanitized.mimeType);
    const fileName =
      docFileName || (validation.fileType === 'image' ? `foto_${Date.now()}.jpg` : `dokumen_${Date.now()}.pdf`);

    // Case A: Reply to an existing task
    let attachedTask = null;
    if (stanzaId) {
      attachedTask = await findTaskByMessageId(db, stanzaId);
    }

    if (attachedTask) {
      await addAttachmentToTask(db, {
        taskId: attachedTask.id,
        userJid: remoteJid,
        fileName,
        fileType: validation.fileType!,
        mimeType: sanitized.mimeType,
        fileSize: sanitized.fileSize,
        storagePath,
        sha256Hash: sanitized.sha256Hash,
        safetyStatus: 'safe',
        ocrExtractedText: aiResult?.ocrText || null,
      });

      await sock.sendMessage(remoteJid, {
        text: `📎 *Lampiran Berhasil Disimpan!*\nFile *${fileName}* telah dilampirkan ke tugas:\n📌 [ID: ${attachedTask.id}] *${attachedTask.task}*`,
      });
      return;
    }

    // Case B: Caption contains task instructions or OCR found a task
    let taskText = caption.trim();
    if (!taskText && aiResult?.isTask && aiResult.taskTitle) {
      taskText = aiResult.taskTitle;
    }

    if (taskText) {
      const nlpResult = await parseTaskMessage(taskText, {
        now: new Date(),
        timezone: user.timezone,
        isForwarded,
      });

      const deadline = nlpResult.deadline;
      const effectiveLead = (nlpResult.reminderLeadMinutes && nlpResult.reminderLeadMinutes > 0)
        ? nlpResult.reminderLeadMinutes
        : user.leadReminderMinutes;
      const remindAt = deadline ? calculateRemindAt(deadline, { leadMinutes: effectiveLead }) : null;

      const created = await createTask(db, {
        userJid: remoteJid,
        task: nlpResult.taskTitle || taskText,
        deadline,
        remindAt,
        status: deadline ? 'pending' : 'pending_deadline',
      });

      await addAttachmentToTask(db, {
        taskId: created.id,
        userJid: remoteJid,
        fileName,
        fileType: validation.fileType!,
        mimeType: sanitized.mimeType,
        fileSize: sanitized.fileSize,
        storagePath,
        sha256Hash: sanitized.sha256Hash,
        safetyStatus: 'safe',
        ocrExtractedText: aiResult?.ocrText || null,
      });

      if (deadline) {
        const deadlineStr = formatDateTime(deadline, user.timezone);
        let reminderNote = '';
        if (nlpResult.reminderLeadMinutes && nlpResult.reminderLeadMinutes > 0) {
          const leadTxt = nlpResult.reminderLeadMinutes >= 60 && nlpResult.reminderLeadMinutes % 60 === 0
            ? `${nlpResult.reminderLeadMinutes / 60} jam`
            : `${nlpResult.reminderLeadMinutes} menit`;
          const remindStr = remindAt ? formatDateTime(remindAt, user.timezone) : '';
          reminderNote = `\n⏱️ Pengingat Khusus: *${leadTxt} sebelum deadline* (${remindStr})`;
        }
        const reply = await sock.sendMessage(remoteJid, {
          text: `✅ *Tugas & Lampiran Dicatat!*\n📝: *${created.task}*\n⏰ Deadline: *${deadlineStr}*${reminderNote}\n📎 Lampiran: *${fileName}*${TASK_FOOTER_NOTE}`,
        });
        if (reply?.key?.id) {
          await linkTaskMessage(db, created.id, reply.key.id);
        }
      } else {
        const suggestions = getDynamicTimeSuggestions(user.timezone, new Date());
        const suggestionList = suggestions.map((s, idx) => `${['1️⃣', '2️⃣', '3️⃣'][idx]} ${s.label}`).join('\n');
        const reply = await sock.sendMessage(remoteJid, {
          text: `📝 *Tugas & Lampiran Siap Dicatat!*\n"${created.task}"\n📎 Lampiran: *${fileName}*\n\nBiar tidak terlewat, kapan sebaiknya aku ingatkan tugas ini? Kamu bisa balas pesan ini dengan waktu yang pas, atau pilih opsi:\n${suggestionList}${TASK_FOOTER_NOTE}`,
        });
        if (reply?.key?.id) {
          await linkTaskMessage(db, created.id, reply.key.id);
        }
      }
      return;
    }

    // Case C: File sent without caption and no AI task detected
    const genericTitle =
      validation.fileType === 'image'
        ? (aiResult?.ocrText ? `Review foto: ${aiResult.ocrText.slice(0, 40)}` : 'Review lampiran foto')
        : `Review dokumen: ${fileName}`;

    const created = await createTask(db, {
      userJid: remoteJid,
      task: genericTitle,
      status: 'pending_deadline',
    });

    await addAttachmentToTask(db, {
      taskId: created.id,
      userJid: remoteJid,
      fileName,
      fileType: validation.fileType!,
      mimeType: sanitized.mimeType,
      fileSize: sanitized.fileSize,
      storagePath,
      sha256Hash: sanitized.sha256Hash,
      safetyStatus: 'safe',
      ocrExtractedText: aiResult?.ocrText || null,
    });

    const suggestions = getDynamicTimeSuggestions(user.timezone, new Date());
    const suggestionList = suggestions.map((s, idx) => `${['1️⃣', '2️⃣', '3️⃣'][idx]} ${s.label}`).join('\n');

    const reply = await sock.sendMessage(remoteJid, {
      text: `📎 *Lampiran Diterima!*\n"${created.task}"\n\nKapan sebaiknya kamu diingatkan untuk memeriksa lampiran ini?\n${suggestionList}${TASK_FOOTER_NOTE}`,
    });
    if (reply?.key?.id) {
      await linkTaskMessage(db, created.id, reply.key.id);
    }
    return;
  }

  // 3. Help command
  if (/^(\/help|help|halp|bantuan|menu)$/i.test(trimmedText)) {
    console.log('ℹ️ [Command] Menampilkan panduan bantuan.');
    await sock.sendMessage(remoteJid, { text: HELP_MESSAGE });
    return;
  }

  // 3.5. Opt-in morning digest settings
  const morningCommand = parseMorningDigestCommand(trimmedText);
  if (morningCommand) {
    if (morningCommand.action === 'invalid_time') {
      await sock.sendMessage(remoteJid, {
        text: '⚠️ Format waktu belum valid. Gunakan format 24 jam, misalnya */pagi waktu 06:30*.',
      });
      return;
    }

    if (morningCommand.action === 'status') {
      const status = user.morningDigestEnabled ? 'aktif' : 'nonaktif';
      await sock.sendMessage(remoteJid, {
        text: `🌤️ *Ringkasan Pagi*\nStatus: *${status}*\nWaktu: *${user.morningDigestTime}* (${user.timezone})\n\nGunakan */pagi aktif*, */pagi nonaktif*, atau */pagi waktu HH:mm* untuk mengubahnya.`,
      });
      return;
    }

    if (morningCommand.action === 'enable') {
      const updated = await updateMorningDigestSettings(db, remoteJid, { enabled: true });
      await sock.sendMessage(remoteJid, {
        text: `✅ Ringkasan pagi diaktifkan pada *${updated?.morningDigestTime || '06:00'}* (${user.timezone}). Kamu bisa mengubahnya dengan */pagi waktu HH:mm*.`,
      });
      return;
    }

    if (morningCommand.action === 'disable') {
      await updateMorningDigestSettings(db, remoteJid, { enabled: false });
      await sock.sendMessage(remoteJid, {
        text: '🌙 Ringkasan pagi sudah dinonaktifkan. Waktu pilihanmu tetap tersimpan dan bisa diaktifkan kembali kapan saja.',
      });
      return;
    }

    const updated = await updateMorningDigestSettings(db, remoteJid, { time: morningCommand.time });
    await sock.sendMessage(remoteJid, {
      text: `⏰ Waktu ringkasan pagi diatur ke *${updated?.morningDigestTime || morningCommand.time}* (${user.timezone}). Status tetap *${updated?.morningDigestEnabled ? 'aktif' : 'nonaktif'}*.`,
    });
    return;
  }

  // 3.6. Image Quality Mode settings
  const mediaSettingMatch = trimmedText.match(
    /^(?:\/?setting\s+(?:media|kualitas[_\s]*gambar)|\/media|\/?kualitas[_\s]*gambar)(?:\s+(.+))?$/i
  );
  if (mediaSettingMatch) {
    const action = mediaSettingMatch[1]?.trim().toLowerCase();
    if (!action || action === 'status' || action === 'info' || action === 'cek') {
      const currentLabel =
        user.imageQualityMode === 'compact'
          ? 'Hemat / Compact (Maksimal 2048px / 2K)'
          : 'Kualitas Tinggi / High (Maksimal 4096px / 4K - Default)';
      await sock.sendMessage(remoteJid, {
        text: `🖼️ *Pengaturan Kualitas Gambar Lampiran*\n\nStatus saat ini: *${currentLabel}*\nKompresi: *Quality 85* (Bebas metadata EXIF demi privasi & keamanan)\n\nPilihan perintah:\n• */setting media tinggi* : Kualitas tinggi (Maksimal 4K / 4096px)\n• */setting media hemat* : Kualitas hemat (Maksimal 2K / 2048px)`,
      });
      return;
    }

    if (/^(tinggi|hd|high|4k|maksimal)$/i.test(action)) {
      await updateImageQualityMode(db, remoteJid, 'high');
      await sock.sendMessage(remoteJid, {
        text: `🖼️ *Kualitas Gambar Diatur: Tinggi (High / 4K)*\n\nResolusi gambar lampiran disimpan tajam hingga maksimal 4096px dengan quality 85. Metadata EXIF tetap dibersihkan demi privasi & keamanan. ✨`,
      });
      return;
    }

    if (/^(hemat|compact|kompres|rendah|2k)$/i.test(action)) {
      await updateImageQualityMode(db, remoteJid, 'compact');
      await sock.sendMessage(remoteJid, {
        text: `🖼️ *Kualitas Gambar Diatur: Hemat (Compact / 2K)*\n\nResolusi gambar lampiran disimpan hingga maksimal 2048px dengan quality 85 untuk menghemat kuota dan penyimpanan. ✨`,
      });
      return;
    }

    await sock.sendMessage(remoteJid, {
      text: `⚠️ Pilihan kualitas gambar tidak dikenali. Gunakan:\n• */setting media tinggi* (Maks 4K)\n• */setting media hemat* (Maks 2K)`,
    });
    return;
  }

  // 3.7. Username setting command (/username <Nama> or /username)
  const usernameMatch = trimmedText.match(/^(?:\/?username|\/nama)(?:\s+(.+))?$/i);
  if (usernameMatch) {
    const rawName = usernameMatch[1]?.trim();
    if (!rawName || rawName.toLowerCase() === 'status' || rawName.toLowerCase() === 'cek' || rawName.toLowerCase() === 'info') {
      const currentName = user.name || 'Belum diatur';
      await sock.sendMessage(remoteJid, {
        text: `👤 *Pengaturan Nama Pengguna*\n\nNama kamu saat ini: *${currentName}*\n\nNama ini digunakan agar sistem bot bisa mengenali kamu di sapaan ramah, pengingat tugas, dan ringkasan pagi harian. ✨\n\nUntuk mengubah nama, ketik:\n• */username <NamaKamu>*\n(contoh: _/username Keva_)`,
      });
      return;
    }

    const newName = rawName.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (newName.length < 2 || newName.length > 50) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Nama pengguna minimal 2 karakter dan maksimal 50 karakter ya.`,
      });
      return;
    }

    await updateUserName(db, remoteJid, newName);
    await sock.sendMessage(remoteJid, {
      text: `✅ *Nama Berhasil Disimpan!*\n\nHalo, *${newName}*! 👋 Sekarang sistem bot sudah mengenali kamu dengan nama ini untuk sapaan, pengingat tugas, dan ringkasan pagi. ✨`,
    });
    return;
  }

  // 3.8. Reminder Lead Time settings
  const reminderSettingMatch = trimmedText.match(
    /^(?:\/?setting\s+(?:reminder|pengingat)|\/reminder|\/pengingat)(?:\s+(.+))?$/i
  );
  if (reminderSettingMatch) {
    const rawVal = reminderSettingMatch[1]?.trim();
    if (!rawVal || rawVal.toLowerCase() === 'status' || rawVal.toLowerCase() === 'cek' || rawVal.toLowerCase() === 'info') {
      await sock.sendMessage(remoteJid, {
        text: `⏱️ *Pengaturan Waktu Pengingat (Lead Time)*\n\nWaktu pengingat saat ini: *${user.leadReminderMinutes} menit* sebelum deadline.\n\nBot akan otomatis mengingatkan tugas ${user.leadReminderMinutes} menit sebelum target waktu.\n\nUntuk mengubahnya, ketik:\n• */setting reminder <menit>*\n(contoh: _/setting reminder 10_ atau _/setting reminder 15_)`,
      });
      return;
    }

    const minutes = parseInt(rawVal, 10);
    if (isNaN(minutes) || minutes < 1 || minutes > 1440) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Waktu pengingat harus berupa angka menit antara 1 sampai 1440 (contoh: */setting reminder 10* atau */setting reminder 15*).`,
      });
      return;
    }

    await updateLeadReminderMinutes(db, remoteJid, minutes);
    await sock.sendMessage(remoteJid, {
      text: `⏱️ *Waktu Pengingat Berhasil Diatur!*\n\nPengingat awal sekarang diatur ke *${minutes} menit* sebelum deadline. Setiap tugas baru akan otomatis diingatkan ${minutes} menit sebelum waktunya. ✨`,
    });
    return;
  }

  // 4. List active tasks (Hierarchical view)
  if (/^(\/list|list|daftar|daftar tugas|todo)$/i.test(trimmedText)) {
    const activeTasks = await listActiveTasks(db, remoteJid);
    if (activeTasks.length === 0) {
      await sock.sendMessage(remoteJid, { text: 'Saat ini tidak ada tugas aktif. Santai dulu! 🎉' });
      return;
    }

    const rootTasks = activeTasks.filter((t) => !t.parentId);
    const subtaskMap = new Map<number, typeof activeTasks>();
    activeTasks.forEach((t) => {
      if (t.parentId) {
        const list = subtaskMap.get(t.parentId) || [];
        list.push(t);
        subtaskMap.set(t.parentId, list);
      }
    });

    let reply = '📋 *Daftar Tugas Aktif:*\n\n';
    let counter = 1;

    for (const t of rootTasks) {
      const deadlineStr = t.deadline
        ? `⏰ ${formatDateTime(new Date(t.deadline), user.timezone)}`
        : '⏰ Waktu: Belum ditentukan';
      const subtasks = subtaskMap.get(t.id) || [];
      const subCountBadge = subtasks.length > 0 ? ` (${subtasks.length} sub-tugas)` : '';

      reply += `${counter}. [ID: ${t.id}] *${t.task}*${subCountBadge}\n   ${deadlineStr}\n`;

      if (subtasks.length > 0) {
        subtasks.forEach((st) => {
          const stDeadline = st.deadline
            ? `(⏰ ${formatDateTime(new Date(st.deadline), user.timezone)})`
            : '';
          reply += `   └─ [ID: ${st.id}] ⏳ ${st.task} ${stDeadline}\n`;
        });
      }
      reply += '\n';
      counter++;
    }

    const orphanSubtasks = activeTasks.filter(
      (t) => t.parentId && !rootTasks.some((rt) => rt.id === t.parentId)
    );
    if (orphanSubtasks.length > 0) {
      reply += `📌 *Sub-tugas Mandiri:*\n`;
      orphanSubtasks.forEach((st) => {
        const stDeadline = st.deadline
          ? `(⏰ ${formatDateTime(new Date(st.deadline), user.timezone)})`
          : '';
        reply += `• [ID: ${st.id}] ⏳ ${st.task} ${stDeadline}\n`;
      });
      reply += '\n';
    }

    reply += 'Ketik *selesai <ID>* untuk menandai selesai.\nKetik *detail <ID>* untuk struktur pohon.\nKetik *riwayat <ID>* untuk audit perubahan.';
    await sock.sendMessage(remoteJid, { text: reply.trim() });
    return;
  }

  // 5. History / Riwayat command
  const historyMatch = trimmedText.match(/^(?:riwayat|history)\s+(\d+)$/i);
  if (historyMatch && historyMatch[1]) {
    const taskId = parseInt(historyMatch[1], 10);
    const historyList = await getTaskHistory(db, taskId, remoteJid);
    if (historyList.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: `Tugas ID [${taskId}] tidak ditemukan atau belum memiliki riwayat perubahan.`,
      });
      return;
    }

    const taskTree = await getTaskTree(db, taskId, remoteJid);
    const currentTask = taskTree?.task;

    let replyText = `📜 *Riwayat & Audit Trail Tugas [ID: ${taskId}]*\n\n`;

    if (currentTask) {
      const currentDeadlineStr = currentTask.deadline
        ? formatDateTime(new Date(currentTask.deadline), user.timezone)
        : 'Belum ditentukan';
      const statusEmoji =
        currentTask.status === 'resolved'
          ? '✅ Selesai'
          : currentTask.status === 'cancelled'
          ? '❌ Dibatalkan'
          : '⏳ Aktif';

      replyText += `📌 *Kondisi Saat Ini (Current):*\n`;
      replyText += `• Judul: *${currentTask.task}*\n`;
      replyText += `• Status: ${statusEmoji}\n`;
      replyText += `• Deadline: *${currentDeadlineStr}*\n\n`;
    }

    replyText += `📋 *Kronologi Perubahan (Audit Trail):*\n`;
    replyText += historyList.map((item) => formatHistoryAction(item, user.timezone)).join('\n\n');
    await sock.sendMessage(remoteJid, { text: replyText });
    return;
  }

  // 6. Direct Reschedule command: reschedule <ID> <waktu> / ubah waktu <ID> <waktu>
  const directRescheduleMatch = trimmedText.match(/^(?:reschedule|ubah\s*waktu|ganti\s*waktu)\s+(\d+)\s+(.+)$/i);
  if (directRescheduleMatch && directRescheduleMatch[1] && directRescheduleMatch[2]) {
    const taskId = parseInt(directRescheduleMatch[1], 10);
    const timeStr = directRescheduleMatch[2].trim();

    const localParsed = parseLocalTask(timeStr, new Date(), user.timezone);
    let newDeadline = localParsed.deadline;
    if (!newDeadline) {
      const nlp = await parseTaskMessage(timeStr, { now: new Date(), timezone: user.timezone });
      newDeadline = nlp.deadline;
    }

    if (!newDeadline) {
      await sock.sendMessage(remoteJid, {
        text: `⚠️ Tidak dapat mengenali waktu "${timeStr}". Coba format yang lebih jelas seperti: _"besok jam 06.30"_ atau _"hari ini jam 20:00"_.`,
      });
      return;
    }

    const res = await rescheduleTask(db, {
      taskId,
      userJid: remoteJid,
      newDeadline,
      leadMinutes: user.leadReminderMinutes,
      rawInput: trimmedText,
    });

    if (!res) {
      await sock.sendMessage(remoteJid, {
        text: `Tugas ID [${taskId}] tidak ditemukan atau kamu tidak memiliki akses.`,
      });
      return;
    }

    const deadlineStr = formatDateTime(newDeadline, user.timezone);
    const oldDeadlineStr = res.oldDeadline
      ? formatDateTime(res.oldDeadline, user.timezone)
      : 'Belum ada jadwal';

    await sock.sendMessage(remoteJid, {
      text: `🔄 *Jadwal Berhasil Diperbarui!* [ID: ${taskId}]\n📝 Tugas: *${res.updatedTask.task}*\n⏰ Waktu lama: ${oldDeadlineStr}\n⏰ Waktu baru: *${deadlineStr}*\n\nPengingat otomatis telah disesuaikan kembali. ✨`,
    });
    return;
  }

  // 6. Tree / Detail command
  const treeMatch = trimmedText.match(/^(?:tree|detail)\s+(\d+)$/i);
  if (treeMatch && treeMatch[1]) {
    const taskId = parseInt(treeMatch[1], 10);
    const taskTree = await getTaskTree(db, taskId, remoteJid);
    if (!taskTree) {
      await sock.sendMessage(remoteJid, { text: `Tugas ID [${taskId}] tidak ditemukan.` });
      return;
    }

    const { task: t, subtasks } = taskTree;
    const attachments = await getTaskAttachments(db, taskId);

    const deadlineStr = t.deadline
      ? formatDateTime(new Date(t.deadline), user.timezone)
      : 'Belum ditentukan';
    const statusEmoji = t.status === 'resolved' ? '✅ Selesai' : t.status === 'cancelled' ? '❌ Dibatalkan' : '⏳ Aktif';

    let replyText = `🌳 *Detail & Struktur Tugas [ID: ${t.id}]*\n\n`;
    replyText += `📌 *${t.task}*\n`;
    replyText += `• Status: ${statusEmoji}\n`;
    replyText += `• Deadline: ${deadlineStr}\n`;

    if (attachments.length > 0) {
      replyText += `• 📎 Lampiran: ${attachments.length} file (${attachments.map((a) => a.fileName).join(', ')})\n`;
    }

    if (subtasks.length > 0) {
      replyText += `\n*Daftar Sub-tugas:*\n`;
      subtasks.forEach((st, idx) => {
        const stEmoji = st.status === 'resolved' ? '✅' : st.status === 'cancelled' ? '❌' : '⏳';
        const stDeadline = st.deadline ? ` (⏰ ${formatDateTime(new Date(st.deadline), user.timezone)})` : '';
        replyText += `${idx + 1}. [ID: ${st.id}] ${stEmoji} *${st.task}*${stDeadline}\n`;
      });
    } else {
      replyText += `\n_Belum ada sub-tugas._ (Balas pesan tugas ini dengan *subtask: <nama sub-tugas>* untuk menambahkan)`;
    }

    await sock.sendMessage(remoteJid, { text: replyText.trim() });
    return;
  }

  // 7. Direct Subtask command: subtask <ID> <teks>
  const directSubtaskMatch = trimmedText.match(/^subtask\s+(\d+)\s+(.+)$/i);
  if (directSubtaskMatch && directSubtaskMatch[1] && directSubtaskMatch[2]) {
    const parentId = parseInt(directSubtaskMatch[1], 10);
    const rawSubtask = directSubtaskMatch[2].trim();

    const localParsed = parseLocalTask(rawSubtask, new Date(), user.timezone);
    const subtaskTitle = localParsed.taskTitle || rawSubtask;
    const deadline = localParsed.deadline;
    const remindAt = deadline ? calculateRemindAt(deadline, { leadMinutes: user.leadReminderMinutes }) : null;

    const res = await createSubtask(db, {
      parentId,
      userJid: remoteJid,
      task: subtaskTitle,
      deadline,
      remindAt,
      status: deadline ? 'pending' : 'pending_deadline',
    });

    if (!res) {
      await sock.sendMessage(remoteJid, {
        text: `Tugas utama ID [${parentId}] tidak ditemukan atau kamu tidak memiliki akses.`,
      });
      return;
    }

    const deadlineStr = deadline ? formatDateTime(deadline, user.timezone) : 'Belum ditentukan';
    const reply = await sock.sendMessage(remoteJid, {
      text: `🌿 *Sub-Tugas Berhasil Ditambahkan!*\n📌 Tugas Utama: *${res.parentTask.task}*\n└─ 📝 Sub-tugas: [ID: ${res.subtask.id}] *${res.subtask.task}*\n⏰ Deadline: *${deadlineStr}*`,
    });
    if (reply?.key?.id) {
      await linkTaskMessage(db, res.subtask.id, reply.key.id);
    }
    return;
  }

  // 8. Resolve task via command
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

  // 9. Cancel task via command
  const cancelMatch = trimmedText.match(/^(\/batal|\/hapus|batal|hapus)\s+(\d+)$/i);
  if (cancelMatch && cancelMatch[2]) {
    const taskId = parseInt(cancelMatch[2], 10);
    const cancelled = await cancelTask(db, taskId, remoteJid);
    if (!cancelled) {
      await sock.sendMessage(remoteJid, { text: `Tugas ID [${taskId}] tidak ditemukan.` });
      return;
    }

    await sock.sendMessage(remoteJid, { text: `❌ Tugas ID [${taskId}] berhasil dibatalkan beserta sub-tugasnya.` });
    return;
  }

  // 10. Quoted reply handlers for Edit (Reschedule & Rename) and Subtasks
  const rescheduleMatch = trimmedText.match(/^(?:ubah\s*waktu|ganti\s*waktu|reschedule|jadwal\s*ulang)[:\s]+(.+)$/i);
  const renameMatch = trimmedText.match(/^(?:ubah\s*tugas|ganti\s*tugas|ubah\s*judul|ganti\s*judul|rename)[:\s]+(.+)$/i);
  const subtaskReplyMatch = trimmedText.match(/^(?:subtask|tambah\s*subtask|anak\s*tugas)[:\s]+(.+)$/i);

  if (rescheduleMatch || renameMatch || subtaskReplyMatch) {
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

    if (!targetTask) {
      await sock.sendMessage(remoteJid, {
        text: '⚠️ Tidak menemukan tugas yang ingin diubah. Balas (quote) pesan tugas terkait atau gunakan perintah spesifik.',
      });
      return;
    }

    // A. Reschedule Task
    if (rescheduleMatch && rescheduleMatch[1]) {
      const timeStr = rescheduleMatch[1].trim();
      const localParsed = parseLocalTask(timeStr, new Date(), user.timezone);

      let newDeadline = localParsed.deadline;
      if (!newDeadline) {
        const nlp = await parseTaskMessage(timeStr, { now: new Date(), timezone: user.timezone });
        newDeadline = nlp.deadline;
      }

      if (!newDeadline) {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ Tidak dapat mengenali waktu "${timeStr}". Coba format seperti: _"besok jam 15:00"_ atau _"hari ini jam 20:00"_.`,
        });
        return;
      }

      const res = await rescheduleTask(db, {
        taskId: targetTask.id,
        userJid: remoteJid,
        newDeadline,
        leadMinutes: user.leadReminderMinutes,
        rawInput: trimmedText,
      });

      if (res) {
        const deadlineStr = formatDateTime(newDeadline, user.timezone);
        const oldDeadlineStr = res.oldDeadline
          ? formatDateTime(res.oldDeadline, user.timezone)
          : 'Belum ada jadwal';
        await sock.sendMessage(remoteJid, {
          text: `🔄 *Jadwal Berhasil Diperbarui!*\n📝 Tugas: *${targetTask.task}*\n⏰ Waktu lama: ${oldDeadlineStr}\n⏰ Waktu baru: *${deadlineStr}*\n\nPengingat otomatis telah disesuaikan kembali. ✨`,
        });
        return;
      }
    }

    // B. Rename Task
    if (renameMatch && renameMatch[1]) {
      const newTitle = renameMatch[1].trim();
      const res = await renameTask(db, {
        taskId: targetTask.id,
        userJid: remoteJid,
        newTitle,
        rawInput: trimmedText,
      });

      if (res) {
        await sock.sendMessage(remoteJid, {
          text: `✏️ *Nama Tugas Berhasil Diperbarui!*\n📝 Judul baru: *${newTitle}*`,
        });
        return;
      }
    }

    // C. Add Subtask via Reply
    if (subtaskReplyMatch && subtaskReplyMatch[1]) {
      const rawSubtask = subtaskReplyMatch[1].trim();
      const localParsed = parseLocalTask(rawSubtask, new Date(), user.timezone);
      const subtaskTitle = localParsed.taskTitle || rawSubtask;
      const deadline = localParsed.deadline;
      const remindAt = deadline ? calculateRemindAt(deadline, { leadMinutes: user.leadReminderMinutes }) : null;

      const res = await createSubtask(db, {
        parentId: targetTask.id,
        userJid: remoteJid,
        task: subtaskTitle,
        deadline,
        remindAt,
        status: deadline ? 'pending' : 'pending_deadline',
      });

      if (res) {
        const deadlineStr = deadline ? formatDateTime(deadline, user.timezone) : 'Belum ditentukan';
        const reply = await sock.sendMessage(remoteJid, {
          text: `🌿 *Sub-Tugas Berhasil Ditambahkan!*\n📌 Tugas Utama: *${res.parentTask.task}*\n└─ 📝 Sub-tugas: [ID: ${res.subtask.id}] *${res.subtask.task}*\n⏰ Deadline: *${deadlineStr}*`,
        });
        if (reply?.key?.id) {
          await linkTaskMessage(db, res.subtask.id, reply.key.id);
        }
        return;
      }
    }
  }

  // 11. Quoted reply with completion (✅) or cancellation (❌)
  const isDoneReply =
    ['✅', '✔️', '☑️', '👍'].includes(trimmedText) || /^(selesai|done|\/selesai|\/done)$/i.test(trimmedText);
  const isCancelReply =
    ['❌', '🚫', '🗑️', '✖️'].includes(trimmedText) || /^(batal|cancel|hapus|\/batal|\/cancel|\/hapus)$/i.test(trimmedText);

  if (isDoneReply || isCancelReply) {
    let targetTask = null;
    if (stanzaId) {
      targetTask = await findTaskByMessageId(db, stanzaId);
    }
    if (!targetTask) {
      targetTask = await getLatestRemindedTask(db, remoteJid, 120);
    }
    if (!targetTask) {
      const activeList = await listActiveTasks(db, remoteJid);
      if (activeList.length === 1 && activeList[0]) {
        targetTask = activeList[0];
      }
    }

    if (targetTask && targetTask.status !== 'resolved' && targetTask.status !== 'cancelled') {
      if (isDoneReply) {
        const resolved = await resolveTask(db, targetTask.id, remoteJid);
        if (resolved) {
          const affirmation = await generateAffirmation(resolved.task);
          await sock.sendMessage(remoteJid, {
            text: `🎉 *Tugas Selesai!*\n"${resolved.task}"\n\n_${affirmation}_`,
          });
          return;
        }
      } else if (isCancelReply) {
        const cancelled = await cancelTask(db, targetTask.id, remoteJid);
        if (cancelled) {
          await sock.sendMessage(remoteJid, {
            text: `🗑️ *Tugas Dibatalkan:*\n"${cancelled.task}"\n\nTugas ini sudah dicoret dari daftar aktifmu.`,
          });
          return;
        }
      }
    }
  }

  // 11.5. Quick extension or prompt for active/overdue tasks
  const isQuickExtension =
    /^(1|1️⃣|\+30\s*(?:menit|mnt|m)|30\s*(?:menit|mnt|m)|2|2️⃣|\+1\s*(?:jam|h)|1\s*jam|60\s*(?:menit|mnt|m)|3|3️⃣|besok|besok\s*pagi|besok\s*09:00)$/i.test(trimmedText);
  const isExtendPrompt = /^(buat\s*lagi(?:\s*task)?|jadwal\s*ulang|tambah\s*waktu|perpanjang)$/i.test(trimmedText);

  // Check if quoted message belongs to a pending (active) task
  let quotedPendingTask = null;
  if (stanzaId) {
    const matched = await findTaskByMessageId(db, stanzaId);
    if (matched && matched.status === 'pending') {
      quotedPendingTask = matched;
    }
  }

  // Handle if user quoted an active task OR if user typed quick extension without quoting (and no pending_deadline task exists)
  if (quotedPendingTask || isQuickExtension || isExtendPrompt) {
    let targetPendingTask = quotedPendingTask;

    // If not quoted, only look for pending task if no pending_deadline task is waiting for input
    if (!targetPendingTask) {
      const pendingDeadlineWaiting = await getLatestPendingDeadlineTask(db, remoteJid, 15);
      if (!pendingDeadlineWaiting) {
        targetPendingTask =
          (await getLatestRemindedTask(db, remoteJid, 120)) ||
          (await listActiveTasks(db, remoteJid)).find((t) => t.status === 'pending') ||
          null;
      }
    }

    if (targetPendingTask) {
      if (isExtendPrompt) {
        await sock.sendMessage(remoteJid, {
          text: `Mau perpanjang berapa lama untuk tugas *"${targetPendingTask.task}"* agar tidak ke-skip? 😊\n\n1️⃣ Balas *1* (+30 menit)\n2️⃣ Balas *2* (+1 jam)\n3️⃣ Balas *3* (besok jam 09:00)\n\nAtau balas *ubah waktu: <waktu baru>* ✨`,
        });
        return;
      }

      let newDeadline: Date | null = null;
      const now = new Date();

      if (/^(1|1️⃣|\+30\s*(?:menit|mnt|m)|30\s*(?:menit|mnt|m))$/i.test(trimmedText)) {
        newDeadline = new Date(now.getTime() + 30 * 60 * 1000);
      } else if (/^(2|2️⃣|\+1\s*(?:jam|h)|1\s*jam|60\s*(?:menit|mnt|m))$/i.test(trimmedText)) {
        newDeadline = new Date(now.getTime() + 60 * 60 * 1000);
      } else if (/^(3|3️⃣|besok|besok\s*pagi|besok\s*09:00)$/i.test(trimmedText)) {
        const parsed = parseLocalTask('besok jam 09:00', now, user.timezone);
        newDeadline = parsed.deadline || new Date(now.getTime() + 24 * 60 * 60 * 1000);
      } else if (stanzaId) {
        // Direct temporal expression on quoted task without "ubah waktu:" prefix
        const parsed = parseLocalTask(trimmedText, now, user.timezone);
        if (parsed.deadline && (!parsed.taskTitle || parsed.taskTitle.trim() === '')) {
          newDeadline = parsed.deadline;
        }
      }

      if (newDeadline) {
        const res = await rescheduleTask(db, {
          taskId: targetPendingTask.id,
          userJid: remoteJid,
          newDeadline,
          leadMinutes: user.leadReminderMinutes,
          now,
          rawInput: trimmedText,
        });

        if (res) {
          const deadlineStr = formatDateTime(newDeadline, user.timezone);
          const reply = await sock.sendMessage(remoteJid, {
            text: `⏱️ *Waktu Ekstra Ditambahkan!*\n📝 Tugas: *${targetPendingTask.task}*\n⏰ Deadline baru: *${deadlineStr}*\n\nJadwal pengingat otomatis telah diaktifkan kembali agar tugasmu tidak terlewat. Semangat! ✨`,
          });
          if (reply?.key?.id) {
            await linkTaskMessage(db, targetPendingTask.id, reply.key.id);
          }
          return;
        }
      }
    }
  }

  // 12. Check if user is replying with a deadline for an existing pending_deadline task
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
    const suggestions = getDynamicTimeSuggestions(user.timezone, new Date());
    let parsedTimeText = trimmedText;

    if (trimmedText === '1' || trimmedText === '1️⃣') {
      parsedTimeText = suggestions[0]?.text || 'hari ini jam 17:00';
    } else if (trimmedText === '2' || trimmedText === '2️⃣') {
      parsedTimeText = suggestions[1]?.text || 'besok jam 09:00';
    } else if (trimmedText === '3' || trimmedText === '3️⃣') {
      parsedTimeText = suggestions[2]?.text || 'besok jam 13:00';
    } else if (/nanti sore/i.test(trimmedText)) {
      parsedTimeText = 'hari ini jam 17:00';
    } else if (/besok pagi/i.test(trimmedText)) {
      parsedTimeText = 'besok jam 09:00';
    }

    const localParsed = parseLocalTask(parsedTimeText, new Date(), user.timezone);
    if (localParsed.deadline) {
      const remindAt = calculateRemindAt(localParsed.deadline, {
        leadMinutes: user.leadReminderMinutes,
      });

      const updated = await updateTaskDeadline(db, pendingTask.id, localParsed.deadline, remindAt, trimmedText);
      if (updated) {
        const deadlineStr = formatDateTime(localParsed.deadline, user.timezone);
        const reply = await sock.sendMessage(remoteJid, {
          text: `✅ *Waktu Disimpan!*\n📝 Tugas: *${updated.task}*\n⏰ Pengingat: *${deadlineStr}*\n\nAku akan ingatkan saat mendekati waktunya. Semangat! ✨${TASK_FOOTER_NOTE}`,
        });
        if (reply?.key?.id) {
          await linkTaskMessage(db, updated.id, reply.key.id);
        }
        return;
      }
    }
  }

  // 13. Natural Language Ingestion for new task
  const nlpResult = await parseTaskMessage(trimmedText, {
    now: new Date(),
    timezone: user.timezone,
    isForwarded,
  });

  if (!nlpResult.isTask) {
    if (/^(halo|hai|hey|p|ping|assalamualaikum|pagi|siang|sore|malam|tes|test)\b/i.test(trimmedText)) {
      console.log('👋 [Sapaan] Membalas salam ramah.');
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

    const suggestions = getDynamicTimeSuggestions(user.timezone, new Date());
    const suggestionList = suggestions.map((s, idx) => `${['1️⃣', '2️⃣', '3️⃣'][idx]} ${s.label}`).join('\n');

    const reply = await sock.sendMessage(remoteJid, {
      text: `📝 *Tugas Siap Dicatat!*\n"${created.task}"\n\nBiar tidak terlewat, kapan sebaiknya aku ingatkan tugas ini? Kamu bisa balas pesan ini dengan waktu yang pas (contoh: *besok jam 2 siang* atau *1 jam lagi*), atau cukup pilih opsi berikut:\n${suggestionList}${TASK_FOOTER_NOTE}`,
    });

    if (reply?.key?.id) {
      await linkTaskMessage(db, created.id, reply.key.id);
    }
    return;
  }

  // Task has a deadline
  const effectiveLeadMinutes = (nlpResult.reminderLeadMinutes && nlpResult.reminderLeadMinutes > 0)
    ? nlpResult.reminderLeadMinutes
    : user.leadReminderMinutes;

  const remindAt = calculateRemindAt(nlpResult.deadline, {
    leadMinutes: effectiveLeadMinutes,
  });

  const created = await createTask(db, {
    userJid: remoteJid,
    task: nlpResult.taskTitle,
    deadline: nlpResult.deadline,
    remindAt,
    status: 'pending',
  });

  const deadlineStr = formatDateTime(nlpResult.deadline, user.timezone);
  let reminderNote = '';
  if (nlpResult.reminderLeadMinutes && nlpResult.reminderLeadMinutes > 0) {
    const leadTxt = nlpResult.reminderLeadMinutes >= 60 && nlpResult.reminderLeadMinutes % 60 === 0
      ? `${nlpResult.reminderLeadMinutes / 60} jam`
      : `${nlpResult.reminderLeadMinutes} menit`;
    const remindStr = remindAt ? formatDateTime(remindAt, user.timezone) : '';
    reminderNote = `\n⏱️ Pengingat Khusus: *${leadTxt} sebelum deadline* (${remindStr})`;
  }

  const reply = await sock.sendMessage(remoteJid, {
    text: `✅ *Tugas Dicatat!*\n📝: *${created.task}*\n⏰ Deadline: *${deadlineStr}*${reminderNote}\n\nAku akan ingatkan mendekati waktu tersebut. Semangat!${TASK_FOOTER_NOTE}`,
  });

  if (reply?.key?.id) {
    await linkTaskMessage(db, created.id, reply.key.id);
  }
}

/**
 * Handles incoming WhatsApp reaction events (e.g. reacting with ✅ to resolve or ❌ to cancel)
 */
export async function handleIncomingReaction(sock: any, reactionEvent: any): Promise<void> {
  const reactionText =
    typeof reactionEvent.reaction === 'string'
      ? reactionEvent.reaction
      : (reactionEvent.reaction?.text || reactionEvent.text || '');

  if (!reactionText) return;

  const messageId = reactionEvent.key?.id;
  const rawRemoteJid = reactionEvent.key?.remoteJid || reactionEvent.reaction?.key?.remoteJid;
  if (!messageId || !rawRemoteJid) return;

  const remoteJid = jidNormalizedUser(rawRemoteJid);
  const user = await ensureUserSettings(db, remoteJid);
  if (!user.isAllowed) return;

  const matchedTask = await findTaskByMessageId(db, messageId);
  if (!matchedTask || matchedTask.status === 'resolved' || matchedTask.status === 'cancelled') {
    return;
  }

  // Handle completion reactions (✅, ✔️, etc.)
  if (['✅', '✔️', '☑️', '👍'].includes(reactionText)) {
    const resolved = await resolveTask(db, matchedTask.id, remoteJid);
    if (resolved) {
      const affirmation = await generateAffirmation(resolved.task);
      await sock.sendMessage(remoteJid, {
        text: `🎉 *Tugas Selesai!*\n"${resolved.task}"\n\n_${affirmation}_`,
      });
    }
    return;
  }

  // Handle cancellation reactions (❌, 🚫, 🗑️, etc.)
  if (['❌', '🚫', '🗑️', '✖️'].includes(reactionText)) {
    const cancelled = await cancelTask(db, matchedTask.id, remoteJid);
    if (cancelled) {
      await sock.sendMessage(remoteJid, {
        text: `🗑️ *Tugas Dibatalkan:*\n"${cancelled.task}"\n\nTugas ini sudah dicoret dari daftar aktifmu.`,
      });
    }
    return;
  }
}
