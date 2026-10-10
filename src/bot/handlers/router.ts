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
  findSameScheduleTasks,
  confirmTask,
  getLatestPendingConfirmationTask,
  hasEnoughTitleLetters,
  MIN_TASK_TITLE_LETTERS,
  HELD_TASK_STATUSES,
  confirmRiskTask,
  holdTaskForRisk,
} from '../../services/task.js';
import {
  assessMediaRisk,
  assessTextRisk,
  mergeRisk,
  RISK_CATEGORIES,
  type RiskAssessment,
  type RiskCategory,
} from '../../services/risk.js';
import { runLinkFollowUp, type LinkReview } from '../../services/link-review.js';
import {
  parseTaskMessage,
  parseLocalTask,
  detectSentiment,
  isTimeOnlyExpression,
  getTimezoneOffsetMinutes,
} from '../../services/nlp.js';
import type { Task } from '../../db/schema.js';
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
import { and, eq } from 'drizzle-orm';
import { tasks } from '../../db/schema.js';
import { jidNormalizedUser, downloadMediaMessage } from '@whiskeysockets/baileys';
import { getAdminInstagram, buildRestrictedAccessMessage } from '../../services/settings.js';

/**
 * Resolves a task from a quoted message by matching stanzaId in task_messages,
 * or extracting [ID: <number>] from quoted text as a fallback.
 */
async function resolveQuotedTask(
  db: any,
  remoteJid: string,
  stanzaId?: string,
  quotedText?: string
): Promise<{ task: any | null; isExplicitQuote: boolean }> {
  if (!stanzaId) {
    return { task: null, isExplicitQuote: false };
  }

  // 1. Direct match in task_messages table
  const matched = await findTaskByMessageId(db, stanzaId);
  if (matched && matched.userJid === remoteJid) {
    return { task: matched, isExplicitQuote: true };
  }

  // 2. Fallback: Extract [ID: 123] or #123 from quoted text if present
  if (quotedText) {
    const idMatch = quotedText.match(/(?:\[ID:\s*(\d+)\]|ID:\s*(\d+)|#(\d+))/i);
    const rawId = idMatch ? (idMatch[1] || idMatch[2] || idMatch[3]) : null;
    const extractedId = rawId ? parseInt(rawId, 10) : null;
    if (extractedId && !isNaN(extractedId)) {
      const taskRows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, extractedId), eq(tasks.userJid, remoteJid)))
        .limit(1);
      if (taskRows[0]) {
        return { task: taskRows[0], isExplicitQuote: true };
      }
    }
  }

  return { task: null, isExplicitQuote: true };
}

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

const RISK_LABELS: Record<RiskCategory, string> = {
  gambling: 'judi online (judol)',
  scam: 'modus penipuan',
  phishing: 'link phishing',
  malware: 'aplikasi/APK berbahaya',
  blocked: 'situs yang diblokir pemerintah',
};

const RISK_TIPS: Record<RiskCategory, string> = {
  malware: '📵 Jangan install file APK dari chat ya, itu modus paling sering buat nyedot isi m-banking.',
  phishing: '🔗 Jangan isi data login, OTP, atau data kartu di link yang nggak kamu kenal. Cek alamat situsnya pelan-pelan dulu.',
  scam: '🛡️ Bank, kurir, dan instansi resmi nggak pernah minta OTP, PIN, atau transfer "biaya admin" lewat chat.',
  gambling: '🎰 Judi online didesain bikin kalah dan sering jadi pintu ke pinjol & penipuan. Mending jauhi dulu ya 🙏',
  blocked:
    '🚫 Situs yang diblokir biasanya berisi judi online, penipuan, atau konten ilegal, atau domainnya sudah dipakai pihak lain. Kalau kamu yakin ini situs resmi, pastikan dulu alamatnya benar ya.',
};

/** `notice`: the alert concerns a task that is no longer active, so there is nothing to confirm. */
type RiskAlertMode = 'task' | 'media' | 'info' | 'notice';

function buildRiskAlertText(
  risk: RiskAssessment,
  mode: RiskAlertMode,
  title?: string,
  options: { subject?: string; intro?: string } = {}
): string {
  const labels = risk.categories.map((c) => RISK_LABELS[c]).join(' & ');
  const reasons = risk.reasons.slice(0, 3).map((r) => `• ${r}`).join('\n');
  const tip = risk.categories[0] ? RISK_TIPS[risk.categories[0]] : '';
  const subject = options.subject ?? (mode === 'media' ? 'Lampiran ini' : 'Pesan ini');
  const titleLine = title ? `\n📝 *"${title.replace(/\s+/g, ' ').trim().slice(0, 80)}"*\n` : '';
  const intro = options.intro ? `${options.intro}\n\n` : '';

  const header =
    `${intro}🚨 *Eits, tahan dulu ya!* ${subject} punya ciri-ciri *${labels}* 🧐${titleLine}\n` +
    `Yang bikin aku curiga:\n${reasons}\n\n${tip}`;

  if (mode === 'info') {
    return `${header}\n\nAku nggak mencatat apa-apa dari pesan ini. Kalau memang ada tugas yang mau dicatat, tulis ulang pakai bahasamu sendiri ya ✨`;
  }
  if (mode === 'notice') {
    return `${header}\n\nTugasnya sudah nggak aktif, jadi aku cuma mau ngingetin: hati-hati kalau mau membuka link itu ya 🙏`;
  }

  const holdNote = mode === 'media' ? 'Lampirannya aku simpan sementara, tapi tugasnya' : 'Tugasnya';
  return (
    `${header}\n\n` +
    `Kalau kamu yakin ini aman (misalnya memang catatan pribadimu), aku tetap catat kok:\n` +
    `✅ Balas *lanjut* / *aman*: tetap dicatat\n` +
    `❌ Balas *batal*: buang aja\n\n` +
    `_${holdNote} belum aktif dan belum akan diingatkan sampai kamu pilih._`
  );
}

async function askRiskConfirmation(
  sock: any,
  remoteJid: string,
  heldTask: Task,
  risk: RiskAssessment,
  mode: 'task' | 'media'
): Promise<void> {
  console.warn(`🚨 [Risiko] Tugas ditahan (${risk.categories.join(',')}), menunggu konfirmasi pengguna.`);
  const reply = await sock.sendMessage(remoteJid, { text: buildRiskAlertText(risk, mode, heldTask.task) });
  if (reply?.key?.id) {
    await linkTaskMessage(db, heldTask.id, reply.key.id);
  }
}

const LINK_CHECK_INTRO = '🔎 *Hasil cek link*: aku sudah membuka halamannya di browser terpisah buat dicek.';

function describeLink(review: LinkReview): string {
  return review.finalHost && review.finalHost !== review.host ? `${review.host} → ${review.finalHost}` : review.host;
}

function buildLinkCheckNote(reviews: LinkReview[]): string {
  const lines = reviews.map((review) => {
    if (review.status === 'unreachable') {
      return `⚠️ *${review.host}*: nggak bisa aku buka buat dicek (situsnya nggak merespons atau nggak ditemukan). Hati-hati kalau mau membukanya ya.`;
    }
    const about = review.summary?.replace(/[.!?…\s]+$/, '') || (review.title ? `"${review.title}"` : null);
    return `✅ *${describeLink(review)}*: nggak ada tanda bahaya${about ? `, isinya: ${about}` : ''}.`;
  });
  const footer = reviews.some((review) => review.status === 'safe')
    ? '\n\n_Tetap jangan isi OTP / PIN / password di situs yang nggak kamu kenal ya._'
    : '';
  return `🔎 *Hasil cek link*\n${lines.join('\n')}${footer}`;
}

async function handleLinkReviews(sock: any, remoteJid: string, taskId: number | null, reviews: LinkReview[]): Promise<void> {
  const dangerous = reviews.filter((review) => review.status === 'dangerous');
  if (dangerous.length === 0) {
    const reply = await sock.sendMessage(remoteJid, { text: buildLinkCheckNote(reviews) });
    if (taskId && reply?.key?.id) await linkTaskMessage(db, taskId, reply.key.id);
    return;
  }

  const risk: RiskAssessment = {
    flagged: true,
    categories: RISK_CATEGORIES.filter((c) => dangerous.some((review) => review.risk.categories.includes(c))),
    reasons: [...new Set(dangerous.flatMap((review) => review.risk.reasons))],
  };
  const options = { subject: `Link *${dangerous.map(describeLink).join(', ')}*`, intro: LINK_CHECK_INTRO };
  const held = taskId ? await holdTaskForRisk(db, taskId, remoteJid, 'link_review') : null;
  if (held) {
    console.warn(`🚨 [Risiko] Tugas #${held.id} ditahan setelah cek link (${risk.categories.join(',')}).`);
    const reply = await sock.sendMessage(remoteJid, { text: buildRiskAlertText(risk, 'task', held.task, options) });
    if (reply?.key?.id) await linkTaskMessage(db, held.id, reply.key.id);
    return;
  }
  await sock.sendMessage(remoteJid, { text: buildRiskAlertText(risk, taskId ? 'notice' : 'info', undefined, options) });
}

/** Checks links in the background after the normal reply; the result arrives as a separate message. */
function scheduleLinkFollowUp(sock: any, remoteJid: string, text: string, taskId: number | null): void {
  try {
    runLinkFollowUp(text, (reviews) => handleLinkReviews(sock, remoteJid, taskId, reviews));
  } catch (err) {
    console.error('⚠️ [LinkCheck] Gagal memulai cek link:', err);
  }
}

/**
 * Handles a reply to a risk alert. Confirming activates the task (and still runs the
 * same-schedule check); unrelated text returns false so routing continues.
 */
async function handleRiskReply(
  sock: any,
  remoteJid: string,
  user: { timezone: string },
  heldTask: Task,
  text: string
): Promise<boolean> {
  const decision = classifyConfirmationReply(text);

  if (decision === 'reject') {
    const cancelled = await cancelTask(db, heldTask.id, remoteJid, text);
    if (!cancelled) return false;
    await sock.sendMessage(remoteJid, {
      text: `🛡️ Sip, *"${cancelled.task}"* aku buang ya. Good call, mending aman daripada nyesel! 👍\n\nKalau ada tugas lain yang mau dicatat, langsung kirim aja ✨`,
    });
    return true;
  }

  if (decision !== 'confirm') return false;

  const activated = await confirmRiskTask(db, heldTask.id, remoteJid, text);
  if (!activated) return false;

  if (!activated.deadline) {
    const suggestions = getDynamicTimeSuggestions(user.timezone, new Date());
    const suggestionList = suggestions.map((s, idx) => `${['1️⃣', '2️⃣', '3️⃣'][idx]} ${s.label}`).join('\n');
    const reply = await sock.sendMessage(remoteJid, {
      text: `👌 Oke, aku percaya kamu! *"${activated.task}"* siap dicatat.\n\nTinggal satu lagi: kapan sebaiknya aku ingatkan? Balas pesan ini dengan waktunya (contoh: *besok jam 2 siang*), atau pilih:\n${suggestionList}`,
    });
    if (reply?.key?.id) {
      await linkTaskMessage(db, activated.id, reply.key.id);
    }
    return true;
  }

  const deadline = new Date(activated.deadline);
  const sameSchedule = await findSameScheduleTasks(db, remoteJid, deadline, activated.id);
  if (sameSchedule.length > 0 && activated.remindAt) {
    const held = await updateTaskDeadline(
      db,
      activated.id,
      deadline,
      new Date(activated.remindAt),
      text,
      'pending_confirmation'
    );
    if (held) {
      await askSameScheduleConfirmation(sock, remoteJid, held, sameSchedule, user.timezone);
      return true;
    }
  }

  const reply = await sock.sendMessage(remoteJid, {
    text: `✅ *Tugas Dicatat!*\n📝: *${activated.task}*\n⏰ Deadline: *${formatDateTime(deadline, user.timezone)}*\n\nOke, aku percaya kamu! Tetap hati-hati ya 😉${TASK_FOOTER_NOTE}`,
  });
  if (reply?.key?.id) {
    await linkTaskMessage(db, activated.id, reply.key.id);
  }
  return true;
}

type ShortTitleContext = 'task' | 'subtask' | 'rename';

function buildShortTitleText(title: string, context: ShortTitleContext, currentTitle?: string): string {
  const shown = title.replace(/\s+/g, ' ').trim().slice(0, 40);
  const quoted = shown ? `*"${shown}"*` : '*kosong*';
  const hint =
    context === 'rename'
      ? `Judul *"${currentTitle ?? ''}"* masih aku simpan kok. Coba balas lagi pesan tugasnya, misal: _ubah tugas: Presentasi Pitch Deck_`
      : context === 'subtask'
      ? 'Coba kirim ulang sub-tugasnya, misal: _subtask: Siapkan materi slide besok jam 9 pagi_'
      : 'Coba kirim ulang lengkap dengan waktunya ya, misal: _"Bayar listrik besok jam 2 siang"_';

  return (
    `Eits, nama ${context === 'subtask' ? 'sub-tugas' : 'tugas'}nya cuma ${quoted} nih 🤏😄\n\n` +
    `Kependekan buat aku catat, takutnya pas pengingatnya muncul nanti kamu malah garuk-garuk kepala: "ini tugas apa ya?" 😅\n\n` +
    `Biar jelas, pakai minimal ${MIN_TASK_TITLE_LETTERS} huruf ya. ${hint} ✨`
  );
}

const CONFIRMATION_WINDOW_MINUTES = 15;

const CONFIRM_WORDS = new Set([
  'ya', 'iya', 'iyaa', 'y', 'yes', 'yup', 'yoi', 'gas', 'gass', 'gaskeun', 'lanjut', 'lanjutkan', 'tetap',
  'tetep', 'catat', 'simpan', 'ok', 'oke', 'okee', 'okay', 'sip', 'sipp', 'siap', 'boleh', 'aman', 'santai',
  'gapapa', 'gpp', 'yakin', '✅', '👍',
]);
const REJECT_WORDS = new Set([
  'batal', 'batalin', 'gajadi', 'ga', 'gak', 'nggak', 'ngga', 'enggak', 'tidak', 'jangan', 'no', 'nope',
  'cancel', 'hapus', 'skip', '❌', '🚫',
]);
const FILLER_WORDS = new Set(['aja', 'saja', 'deh', 'dong', 'kok', 'sih', 'kak', 'bro', 'brad', 'min']);

/**
 * Classifies a reply to a same-schedule confirmation prompt as confirm / reject, or null when unrelated.
 */
export function classifyConfirmationReply(text: string): 'confirm' | 'reject' | null {
  const normalized = text
    .toLowerCase()
    .replace(/[\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/\b(?:ga|gak|nggak|ngga|enggak|tidak)\s+(?:apa[\s-]*apa|papa)\b/g, 'gapapa')
    .replace(/\b(?:ga|gak|nggak|ngga|enggak|tidak)\s+jadi\b/g, 'gajadi')
    .replace(/[!.,?~]+/g, ' ');
  const words = normalized.split(/\s+/).filter((w) => w && !FILLER_WORDS.has(w));
  if (words.length === 0 || words.length > 4) return null;
  if (words.every((w) => CONFIRM_WORDS.has(w))) return 'confirm';
  if (words.every((w) => REJECT_WORDS.has(w))) return 'reject';
  return null;
}

function startOfLocalDay(date: Date, timezone: string): Date {
  const dayMs = 24 * 60 * 60 * 1000;
  const offsetMs = getTimezoneOffsetMinutes(timezone, date) * 60 * 1000;
  return new Date(Math.floor((date.getTime() + offsetMs) / dayMs) * dayMs - offsetMs);
}

/**
 * Parses a "move it to another time" reply. A bare time (e.g. "jam 15:30") keeps the
 * day of the held task instead of jumping to today.
 */
function parseReplacementTime(text: string, heldTask: Task, timezone: string, now: Date): Date | null {
  const cleaned = text
    .trim()
    .replace(/^(?:ganti|ubah|pindah(?:in)?|geser|jadi(?:in)?)\s+(?:ke\s+)?/i, '')
    .replace(/(?:\s+(?:aja|saja|deh|dong|ya+|kak|kok|sih))+[!.\s]*$/i, '')
    .trim();
  if (!cleaned) return null;

  const anchor =
    heldTask.deadline && isTimeOnlyExpression(cleaned).isTimeOnly
      ? startOfLocalDay(new Date(heldTask.deadline), timezone)
      : now;
  let parsed = parseLocalTask(cleaned, anchor, timezone);
  if (parsed.deadline && parsed.deadline.getTime() <= now.getTime() && anchor !== now) {
    parsed = parseLocalTask(cleaned, now, timezone);
  }
  if (!parsed.deadline || parsed.taskTitle.trim() !== '') return null;
  return parsed.deadline;
}

function buildSameScheduleConfirmText(heldTask: Task, sameSchedule: Task[], timezone: string): string {
  const deadlineStr = heldTask.deadline ? formatDateTime(new Date(heldTask.deadline), timezone) : '';
  const shown = sameSchedule.slice(0, 3).map((t) => `• [ID: ${t.id}] ${t.task}`).join('\n');
  const more = sameSchedule.length > 3 ? `\n_...dan ${sameSchedule.length - 3} tugas lainnya_` : '';
  const existingLabel = sameSchedule.length > 1 ? `${sameSchedule.length} jadwal` : 'jadwal';

  return (
    `Eh, bentar dulu! 👀 Di *${deadlineStr}* kamu udah punya ${existingLabel} nih:\n${shown}${more}\n\n` +
    `Kalau *"${heldTask.task}"* aku pasang di jam yang sama, nanti pengingatnya datang barengan dan takutnya malah bikin bingung yang mana duluan 😅\n\n` +
    `Mau gimana?\n` +
    `✅ Balas *gas* / *ya*: tetap dicatat, pengingatnya aku kirim berurutan biar nggak numpuk\n` +
    `⏰ Balas jam lain (cth: *jam 14:30*): aku geser jadwalnya\n` +
    `❌ Balas *batal*: nggak jadi dicatat`
  );
}

async function askSameScheduleConfirmation(
  sock: any,
  remoteJid: string,
  heldTask: Task,
  sameSchedule: Task[],
  timezone: string
): Promise<void> {
  const reply = await sock.sendMessage(remoteJid, {
    text: buildSameScheduleConfirmText(heldTask, sameSchedule, timezone),
  });
  if (reply?.key?.id) {
    await linkTaskMessage(db, heldTask.id, reply.key.id);
  }
}

/**
 * Handles a reply to a same-schedule confirmation prompt. Returns false when the
 * text is unrelated so the regular routing continues.
 */
async function handleSameScheduleReply(
  sock: any,
  remoteJid: string,
  user: { timezone: string; leadReminderMinutes: number },
  heldTask: Task,
  text: string
): Promise<boolean> {
  const decision = classifyConfirmationReply(text);

  if (decision === 'confirm') {
    const confirmed = await confirmTask(db, heldTask.id, remoteJid, text);
    if (!confirmed) return false;
    const deadlineStr = confirmed.deadline ? formatDateTime(new Date(confirmed.deadline), user.timezone) : '-';
    const reply = await sock.sendMessage(remoteJid, {
      text: `✅ *Tugas Dicatat!*\n📝: *${confirmed.task}*\n⏰ Deadline: *${deadlineStr}*\n\nSiap, tetap aku pasang di jam yang sama! Pengingatnya nanti aku kirim satu per satu dengan jeda singkat biar nggak numpuk 😉${TASK_FOOTER_NOTE}`,
    });
    if (reply?.key?.id) {
      await linkTaskMessage(db, confirmed.id, reply.key.id);
    }
    return true;
  }

  if (decision === 'reject') {
    const cancelled = await cancelTask(db, heldTask.id, remoteJid, text);
    if (!cancelled) return false;
    const kept = cancelled.deadline ? await findSameScheduleTasks(db, remoteJid, new Date(cancelled.deadline)) : [];
    const keptNote = kept.length > 0 ? `\nJadwal *${kept.map((t) => t.task).join(', ')}* tetap aman kok.` : '';
    await sock.sendMessage(remoteJid, {
      text: `👌 Oke, *"${cancelled.task}"* nggak jadi aku catat.${keptNote}\n\nKalau mau dicatat di waktu lain, kirim aja lagi tugasnya ya! ✨`,
    });
    return true;
  }

  const now = new Date();
  const newDeadline = parseReplacementTime(text, heldTask, user.timezone, now);
  if (!newDeadline) return false;

  if (newDeadline.getTime() <= now.getTime()) {
    await sock.sendMessage(remoteJid, {
      text: `⚠️ Jam *${formatDateTime(newDeadline, user.timezone)}* udah lewat nih 😅 Coba kirim jam lain yang masih akan datang ya!`,
    });
    return true;
  }

  const remindAt = calculateRemindAt(newDeadline, { leadMinutes: user.leadReminderMinutes, now });
  const sameSchedule = await findSameScheduleTasks(db, remoteJid, newDeadline, heldTask.id);
  if (sameSchedule.length > 0) {
    const held = await updateTaskDeadline(db, heldTask.id, newDeadline, remindAt, text, 'pending_confirmation');
    if (held) await askSameScheduleConfirmation(sock, remoteJid, held, sameSchedule, user.timezone);
    return true;
  }

  const updated = await updateTaskDeadline(db, heldTask.id, newDeadline, remindAt, text);
  if (!updated) return false;
  const reply = await sock.sendMessage(remoteJid, {
    text: `✅ *Waktu Disimpan!*\n📝 Tugas: *${updated.task}*\n⏰ Pengingat: *${formatDateTime(newDeadline, user.timezone)}*\n\nSip, sekarang jadwalnya nggak bentrok lagi. Aku ingatkan pas mendekati waktunya ya! ✨${TASK_FOOTER_NOTE}`,
  });
  if (reply?.key?.id) {
    await linkTaskMessage(db, updated.id, reply.key.id);
  }
  return true;
}

export const TASK_FOOTER_NOTE = `\n\n💡 _Tips: Ingin ubah jadwal, judul, atau tambah sub-tugas? Cukup balas pesan ini:_\n• *ubah waktu: <waktu baru>* (cth: _ubah waktu: besok jam 3 sore_)\n• *ubah tugas: <nama baru>* (cth: _ubah tugas: Presentasi Q3_)\n• *subtask: <sub-tugas & waktu>* (cth: _subtask: Cetak materi jam 9 pagi_)`;

const HELP_MESSAGE = `Halo! 👋 Aku asisten pengingat tugasmu. Kamu bisa santai ngobrol atau gunakan panduan ringkas ini:

📌 *Mencatat Tugas Baru:*
• Ketik langsung tugasmu: _"Besok jam 8 pagi ke kantor, ingatkan 10 menit sebelumnya"_
• Fleksibel atur pengingat per-tugas: _"ingatkan 30 menit sebelum"_, _"ingatkan 1 jam sebelumnya"_, atau _"ingatkan H-1"_
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
• Bisa langsung ditentukan per tugas di dalam pesan (cth: _"ingatkan 15 menit sebelum"_)
• */setting reminder <menit>* : Atur waktu pengingat awal default (cth: _/setting reminder 10_)
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
    case 'confirm':
      return `• [${dateStr}] 👌 Dikonfirmasi tetap di jadwal yang sama dengan tugas lain`;
    case 'confirm_risk':
      return `• [${dateStr}] 🛡️ Dikonfirmasi aman oleh pengguna setelah peringatan risiko`;
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
  const quotedMessage = contextInfo?.quotedMessage;
  const quotedText =
    quotedMessage?.conversation ||
    quotedMessage?.extendedTextMessage?.text ||
    quotedMessage?.imageMessage?.caption ||
    quotedMessage?.documentMessage?.caption ||
    '';

  // 1. Check user permission
  const user = await ensureUserSettings(db, remoteJid, msg.pushName || null, false);
  if (!user.isAllowed) {
    console.warn(`[Akses Dibatasi] Pesan dari user ${remoteJid} direspons santai.`);
    const igHandle = await getAdminInstagram(db);
    await sock.sendMessage(remoteJid, {
      text: buildRestrictedAccessMessage(igHandle),
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

      // Layer 4: Multimodal AI screening (scam/phishing/judol & OCR)
      aiResult = await screenAndExtractImageWithAI(sanitized.buffer, sanitized.mimeType);
    } else {
      sanitized = sanitizeDocumentBuffer(
        buffer,
        validation.detectedMime || 'application/pdf',
        validation.detectedExt || 'pdf'
      );
    }

    let mediaRisk = assessMediaRisk({
      caption,
      ocrText: aiResult?.ocrText ?? '',
      isForwarded,
      vision: aiResult,
    });

    // Save to S3 (Rust FS) or sandboxed local storage
    const storagePath = await saveAttachmentToStorage(sanitized.buffer, sanitized.extension, sanitized.mimeType);
    const fileName =
      docFileName || (validation.fileType === 'image' ? `foto_${Date.now()}.jpg` : `dokumen_${Date.now()}.pdf`);

    // Risky media is never attached to an active task; it gets its own held task until the user confirms.
    const holdRiskyMedia = async (title: string, deadline: Date | null, leadMinutes: number) => {
      const now = new Date();
      const heldDeadline = deadline && deadline.getTime() > now.getTime() ? deadline : null;
      const held = await createTask(db, {
        userJid: remoteJid,
        task: title,
        deadline: heldDeadline,
        remindAt: heldDeadline ? calculateRemindAt(heldDeadline, { leadMinutes, now }) : null,
        status: 'pending_risk_confirmation',
      });
      await addAttachmentToTask(db, {
        taskId: held.id,
        userJid: remoteJid,
        fileName,
        fileType: validation.fileType!,
        mimeType: sanitized.mimeType,
        fileSize: sanitized.fileSize,
        storagePath,
        sha256Hash: sanitized.sha256Hash,
        safetyStatus: 'suspicious',
        ocrExtractedText: aiResult?.ocrText || null,
      });
      await askRiskConfirmation(sock, remoteJid, held, mediaRisk, 'media');
    };

    // Case A: Reply to an existing task
    let attachedTask = null;
    if (stanzaId && !mediaRisk.flagged) {
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

      mediaRisk = mergeRisk(mediaRisk, nlpResult.risk);
      if (mediaRisk.flagged) {
        await holdRiskyMedia(nlpResult.taskTitle || taskText, deadline, effectiveLead);
        return;
      }

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

    if (mediaRisk.flagged) {
      await holdRiskyMedia(genericTitle, null, user.leadReminderMinutes);
      return;
    }

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

      if (t.task.includes('\n')) {
        const lines = t.task.split('\n');
        const firstLine = lines[0];
        const remaining = lines.slice(1).map((l) => `   ${l}`).join('\n');
        reply += `${counter}. [ID: ${t.id}] *${firstLine}*${subCountBadge}\n${remaining}\n   ${deadlineStr}\n`;
      } else {
        reply += `${counter}. [ID: ${t.id}] *${t.task}*${subCountBadge}\n   ${deadlineStr}\n`;
      }

      if (subtasks.length > 0) {
        subtasks.forEach((st) => {
          const stDeadline = st.deadline
            ? `(⏰ ${formatDateTime(new Date(st.deadline), user.timezone)})`
            : '';
          if (st.task.includes('\n')) {
            const stLines = st.task.split('\n');
            const stFirst = stLines[0];
            const stRem = stLines.slice(1).map((l) => `      ${l}`).join('\n');
            reply += `   └─ [ID: ${st.id}] ⏳ *${stFirst}* ${stDeadline}\n${stRem}\n`;
          } else {
            reply += `   └─ [ID: ${st.id}] ⏳ ${st.task} ${stDeadline}\n`;
          }
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
        if (st.task.includes('\n')) {
          const stLines = st.task.split('\n');
          const stFirst = stLines[0];
          const stRem = stLines.slice(1).map((l) => `   ${l}`).join('\n');
          reply += `• [ID: ${st.id}] ⏳ *${stFirst}* ${stDeadline}\n${stRem}\n`;
        } else {
          reply += `• [ID: ${st.id}] ⏳ ${st.task} ${stDeadline}\n`;
        }
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
    if (!newDeadline || newDeadline.getTime() <= Date.now()) {
      const nlp = await parseTaskMessage(timeStr, { now: new Date(), timezone: user.timezone });
      if (nlp.deadline && (!newDeadline || nlp.deadline.getTime() > Date.now())) {
        newDeadline = nlp.deadline;
      }
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

    const reply = await sock.sendMessage(remoteJid, {
      text: `🔄 *Jadwal Berhasil Diperbarui!* [ID: ${taskId}]\n📝 Tugas: *${res.updatedTask.task}*\n⏰ Waktu lama: ${oldDeadlineStr}\n⏰ Waktu baru: *${deadlineStr}*\n\nPengingat otomatis telah disesuaikan kembali. ✨`,
    });
    if (reply?.key?.id) {
      await linkTaskMessage(db, taskId, reply.key.id);
    }
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
    if (!hasEnoughTitleLetters(subtaskTitle)) {
      await sock.sendMessage(remoteJid, { text: buildShortTitleText(subtaskTitle, 'subtask') });
      return;
    }
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
    const resolved = await resolveTask(db, taskId, remoteJid, trimmedText);
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
    const cancelled = await cancelTask(db, taskId, remoteJid, trimmedText);
    if (!cancelled) {
      await sock.sendMessage(remoteJid, { text: `Tugas ID [${taskId}] tidak ditemukan.` });
      return;
    }

    await sock.sendMessage(remoteJid, { text: `❌ Tugas ID [${taskId}] berhasil dibatalkan beserta sub-tugasnya.` });
    return;
  }

  // 9.5. Reply to a confirmation prompt (risk alert or same schedule)
  let heldTask: Task | null = null;
  if (stanzaId) {
    const quoted = await findTaskByMessageId(db, stanzaId);
    if (quoted && quoted.userJid === remoteJid && HELD_TASK_STATUSES.includes(quoted.status)) {
      heldTask = quoted;
    }
  } else {
    heldTask = await getLatestPendingConfirmationTask(db, remoteJid, CONFIRMATION_WINDOW_MINUTES);
  }
  if (heldTask) {
    const handled =
      heldTask.status === 'pending_risk_confirmation'
        ? await handleRiskReply(sock, remoteJid, user, heldTask, trimmedText)
        : await handleSameScheduleReply(sock, remoteJid, user, heldTask, trimmedText);
    if (handled) return;
  }

  // 10. Quoted reply handlers for Edit (Reschedule & Rename) and Subtasks
  const rescheduleMatch = trimmedText.match(/^(?:ubah\s*waktu|ganti\s*waktu|reschedule|jadwal\s*ulang)[:\s]+(.+)$/i);
  const renameMatch = trimmedText.match(/^(?:ubah\s*tugas|ganti\s*tugas|ubah\s*judul|ganti\s*judul|rename)[:\s]+(.+)$/i);
  const subtaskReplyMatch = trimmedText.match(/^(?:subtask|tambah\s*subtask|anak\s*tugas)[:\s]+(.+)$/i);

  if (rescheduleMatch || renameMatch || subtaskReplyMatch) {
    let targetTask = null;
    if (stanzaId) {
      const resolved = await resolveQuotedTask(db, remoteJid, stanzaId, quotedText);
      if (resolved.isExplicitQuote && !resolved.task) {
        await sock.sendMessage(remoteJid, {
          text: '⚠️ Pesan yang kamu balas tidak terhubung ke tugas aktif nih. Mau mengubah tugas yang mana? Coba sebutkan ID tugasnya (contoh: *reschedule <ID> <waktu>* atau *ubah tugas: <judul baru>* sambil balas pesan tugasnya), atau balas langsung pesan tugas yang aktif ya! ✨',
        });
        return;
      }
      targetTask = resolved.task;
    }
    if (!targetTask) {
      const activeList = await listActiveTasks(db, remoteJid);
      if (activeList.length === 1 && activeList[0]) {
        targetTask = activeList[0];
      }
    }

    if (!targetTask) {
      await sock.sendMessage(remoteJid, {
        text: '⚠️ Tidak menemukan tugas yang ingin diubah. Balas (quote) pesan tugas terkait atau gunakan perintah spesifik dengan ID tugas.',
      });
      return;
    }

    // A. Reschedule Task
    if (rescheduleMatch && rescheduleMatch[1]) {
      const timeStr = rescheduleMatch[1].trim();
      const localParsed = parseLocalTask(timeStr, new Date(), user.timezone);

      let newDeadline = localParsed.deadline;
      if (!newDeadline || newDeadline.getTime() <= Date.now()) {
        const nlp = await parseTaskMessage(timeStr, { now: new Date(), timezone: user.timezone });
        if (nlp.deadline && (!newDeadline || nlp.deadline.getTime() > Date.now())) {
          newDeadline = nlp.deadline;
        }
      }

      if (!newDeadline) {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ Tidak dapat mengenali waktu "${timeStr}". Coba format seperti: _"besok jam 15:00"_ atau _"hari ini jam 20:00"_.`,
        });
        return;
      }

      if (newDeadline.getTime() <= Date.now()) {
        await sock.sendMessage(remoteJid, {
          text: `⚠️ Waktu baru (*${formatDateTime(newDeadline, user.timezone)}*) sudah lewat dari jam sekarang nih! 😅 Coba masukkan waktu yang akan datang ya.`,
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
        const reply = await sock.sendMessage(remoteJid, {
          text: `🔄 *Jadwal Berhasil Diperbarui!*\n📝 Tugas: *${targetTask.task}*\n⏰ Waktu lama: ${oldDeadlineStr}\n⏰ Waktu baru: *${deadlineStr}*\n\nPengingat otomatis telah disesuaikan kembali. ✨`,
        });
        if (reply?.key?.id) {
          await linkTaskMessage(db, targetTask.id, reply.key.id);
        }
        return;
      }
    }

    // B. Rename Task
    if (renameMatch && renameMatch[1]) {
      const newTitle = renameMatch[1].trim();
      if (!hasEnoughTitleLetters(newTitle)) {
        await sock.sendMessage(remoteJid, { text: buildShortTitleText(newTitle, 'rename', targetTask.task) });
        return;
      }
      const res = await renameTask(db, {
        taskId: targetTask.id,
        userJid: remoteJid,
        newTitle,
        rawInput: trimmedText,
      });

      if (res) {
        const reply = await sock.sendMessage(remoteJid, {
          text: `✏️ *Nama Tugas Berhasil Diperbarui!*\n📝 Judul baru: *${newTitle}*`,
        });
        if (reply?.key?.id) {
          await linkTaskMessage(db, targetTask.id, reply.key.id);
        }
        return;
      }
    }

    // C. Add Subtask via Reply
    if (subtaskReplyMatch && subtaskReplyMatch[1]) {
      const rawSubtask = subtaskReplyMatch[1].trim();
      const localParsed = parseLocalTask(rawSubtask, new Date(), user.timezone);
      const subtaskTitle = localParsed.taskTitle || rawSubtask;
      if (!hasEnoughTitleLetters(subtaskTitle)) {
        await sock.sendMessage(remoteJid, { text: buildShortTitleText(subtaskTitle, 'subtask') });
        return;
      }
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
      const resolved = await resolveQuotedTask(db, remoteJid, stanzaId, quotedText);
      if (resolved.isExplicitQuote && !resolved.task) {
        await sock.sendMessage(remoteJid, {
          text: '⚠️ Pesan yang kamu balas tidak terhubung ke tugas aktif nih. Mau menyelesaikan tugas yang mana? Coba ketik *selesai <nomor_ID>* (contoh: _selesai 2_), atau balas langsung pesan tugas yang aktif ya! ✨',
        });
        return;
      }
      targetTask = resolved.task;
    }

    if (!targetTask) {
      const activeList = await listActiveTasks(db, remoteJid);
      const actionWord = isDoneReply ? 'menyelesaikan' : 'membatalkan';
      const cmdWord = isDoneReply ? 'selesai' : 'batal';
      const emojiIcon = isDoneReply ? '✅' : '❌';

      if (activeList.length === 0) {
        await sock.sendMessage(remoteJid, {
          text: `Saat ini kamu tidak memiliki tugas aktif untuk di${actionWord === 'menyelesaikan' ? 'selesaikan' : 'batalkan'}. Semuanya sudah beres! 🎉`,
        });
        return;
      }

      let msg = `Mau ${actionWord} tugas yang mana nih? 😊\n\n`;
      const exampleId = activeList[0]?.id ?? 1;
      msg += `Biar nggak salah tugas, sebutkan nomor ID tugasnya atau balas (quote) langsung pesan pengingat tugasnya ya:\n`;
      msg += `• Ketik: *${cmdWord} <nomor_ID>* (contoh: *${cmdWord} ${exampleId}*)\n`;
      msg += `• Atau balas (quote) pesan tugas terkait lalu ketik *${cmdWord}* / emoji ${emojiIcon}\n\n`;
      msg += `📋 *Daftar Tugas Aktif Kamu:*\n`;
      activeList.slice(0, 10).forEach((t) => {
        const deadlineStr = t.deadline ? ` _(Deadline: ${formatDateTime(t.deadline, user.timezone)})_` : '';
        msg += `• *[ID: ${t.id}]* ${t.task}${deadlineStr}\n`;
      });
      if (activeList.length > 10) {
        msg += `_...dan ${activeList.length - 10} tugas lainnya (ketik *list* untuk melihat semua)._\n`;
      }

      await sock.sendMessage(remoteJid, { text: msg.trim() });
      return;
    }

    if (targetTask && targetTask.status !== 'resolved' && targetTask.status !== 'cancelled') {
      if (isDoneReply) {
        const resolved = await resolveTask(db, targetTask.id, remoteJid, `Reply: "${trimmedText}"`);
        if (resolved) {
          const affirmation = await generateAffirmation(resolved.task);
          await sock.sendMessage(remoteJid, {
            text: `🎉 *Tugas Selesai!*\n"${resolved.task}"\n\n_${affirmation}_`,
          });
          return;
        }
      } else if (isCancelReply) {
        const cancelled = await cancelTask(db, targetTask.id, remoteJid, `Reply: "${trimmedText}"`);
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
  const isExtendPrompt = /^(buat\s*lagi(?:\s*task)?|jadwal\s*ulang|tambah\s*waktu|perpanjang|reschedule)$/i.test(trimmedText);

  // Check if quoted message belongs to a pending (active) task
  let quotedPendingTask = null;
  if (stanzaId) {
    const resolved = await resolveQuotedTask(db, remoteJid, stanzaId, quotedText);
    if (resolved.isExplicitQuote && !resolved.task) {
      await sock.sendMessage(remoteJid, {
        text: '⚠️ Pesan yang kamu balas tidak terhubung ke tugas aktif nih. Mau perpanjang waktu tugas yang mana? Sebutkan ID tugasnya (contoh: *reschedule <ID> <waktu>*), atau balas langsung pesan tugasnya ya! ✨',
      });
      return;
    }
    if (resolved.task && resolved.task.status === 'pending') {
      quotedPendingTask = resolved.task;
    }
  }

  // If user sends extend prompt ("buat lagi", "jadwal ulang", "perpanjang", etc.) without quoting an active task
  if (isExtendPrompt && !quotedPendingTask) {
    const activeList = await listActiveTasks(db, remoteJid);
    if (activeList.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: 'Saat ini kamu tidak memiliki tugas aktif untuk dijadwalkan ulang. Mau catat tugas baru? Ketik langsung tugasmu ya! ✨',
      });
      return;
    }

    let msg = `Mau perpanjang waktu tugas yang mana nih? 😊\n\n`;
    const exampleId = activeList[0]?.id ?? 1;
    msg += `Biar tepat sasaran, sebutkan nomor ID tugasnya atau balas (quote) langsung pesan pengingat tugasnya ya:\n`;
    msg += `• Ketik: *reschedule <ID> <waktu_baru>* (contoh: *reschedule ${exampleId} besok jam 10 pagi*)\n`;
    msg += `• Atau balas (quote) pesan tugas terkait lalu ketik waktu tambahannya (misal: *1* untuk +30 menit, atau *ubah waktu: 15:00*)\n\n`;
    msg += `📋 *Daftar Tugas Aktif Kamu:*\n`;
    activeList.slice(0, 10).forEach((t) => {
      const deadlineStr = t.deadline ? ` _(Deadline: ${formatDateTime(t.deadline, user.timezone)})_` : '';
      msg += `• *[ID: ${t.id}]* ${t.task}${deadlineStr}\n`;
    });
    if (activeList.length > 10) {
      msg += `_...dan ${activeList.length - 10} tugas lainnya (ketik *list* untuk melihat semua)._\n`;
    }

    await sock.sendMessage(remoteJid, { text: msg.trim() });
    return;
  }

  // Handle explicit extension time (+30 menit, +1 jam, dll) without quoting
  const isExplicitQuickExtension =
    /^(?:\+30\s*(?:menit|mnt|m)|\+1\s*(?:jam|h)|60\s*(?:menit|mnt|m))$/i.test(trimmedText);
  if (isExplicitQuickExtension && !quotedPendingTask) {
    const activeList = await listActiveTasks(db, remoteJid);
    if (activeList.length === 0) {
      await sock.sendMessage(remoteJid, {
        text: 'Saat ini kamu tidak memiliki tugas aktif untuk diperpanjang. Ketik tugas barumu langsung ya! ✨',
      });
      return;
    }
    const exampleId = activeList[0]?.id ?? 1;
    await sock.sendMessage(remoteJid, {
      text: `Mau menambah waktu untuk tugas yang mana nih? 😊 Balas (quote) langsung pesan pengingat tugasnya, atau ketik *reschedule <nomor_ID> <waktu>* (contoh: *reschedule ${exampleId} 30 menit lagi*) ya! ✨`,
    });
    return;
  }

  // Handle if user quoted an active task to extend/reschedule
  if (quotedPendingTask) {
    if (isExtendPrompt) {
      await sock.sendMessage(remoteJid, {
        text: `Mau perpanjang berapa lama untuk tugas *"${quotedPendingTask.task}"* agar tidak ke-skip? 😊\n\n1️⃣ Balas *1* (+30 menit)\n2️⃣ Balas *2* (+1 jam)\n3️⃣ Balas *3* (besok jam 09:00)\n\nAtau balas *ubah waktu: <waktu baru>* ✨`,
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
    } else {
      // Direct temporal expression on quoted task without "ubah waktu:" prefix
      const parsed = parseLocalTask(trimmedText, now, user.timezone);
      if (parsed.deadline && (!parsed.taskTitle || parsed.taskTitle.trim() === '')) {
        newDeadline = parsed.deadline;
      }
    }

    if (newDeadline) {
      const res = await rescheduleTask(db, {
        taskId: quotedPendingTask.id,
        userJid: remoteJid,
        newDeadline,
        leadMinutes: user.leadReminderMinutes,
        now,
        rawInput: trimmedText,
      });

      if (res) {
        const deadlineStr = formatDateTime(newDeadline, user.timezone);
        const reply = await sock.sendMessage(remoteJid, {
          text: `⏱️ *Waktu Ekstra Ditambahkan!*\n📝 Tugas: *${quotedPendingTask.task}*\n⏰ Deadline baru: *${deadlineStr}*\n\nJadwal pengingat otomatis telah diaktifkan kembali agar tugasmu tidak terlewat. Semangat! ✨`,
        });
        if (reply?.key?.id) {
          await linkTaskMessage(db, quotedPendingTask.id, reply.key.id);
        }
        return;
      }
    }
  }

  // 12. Check if user is replying with a deadline for an existing pending_deadline task
  let pendingTask = null;
  if (stanzaId) {
    const resolved = await resolveQuotedTask(db, remoteJid, stanzaId, quotedText);
    if (resolved.task && resolved.task.status === 'pending_deadline') {
      pendingTask = resolved.task;
    }
  }
  if (!pendingTask && !stanzaId) {
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

      const sameSchedule = await findSameScheduleTasks(db, remoteJid, localParsed.deadline, pendingTask.id);
      if (sameSchedule.length > 0) {
        const held = await updateTaskDeadline(
          db,
          pendingTask.id,
          localParsed.deadline,
          remindAt,
          trimmedText,
          'pending_confirmation'
        );
        if (held) {
          await askSameScheduleConfirmation(sock, remoteJid, held, sameSchedule, user.timezone);
          return;
        }
      }

      const updated = await updateTaskDeadline(db, pendingTask.id, localParsed.deadline, remindAt, trimmedText);
      if (updated) {
        const deadlineStr = formatDateTime(localParsed.deadline, user.timezone);
        const updatedTaskFormatted = updated.task.includes('\n')
          ? `📝 *Tugas:*\n${updated.task}`
          : `📝 Tugas: *${updated.task}*`;
        const reply = await sock.sendMessage(remoteJid, {
          text: `✅ *Waktu Disimpan!*\n${updatedTaskFormatted}\n⏰ Pengingat: *${deadlineStr}*\n\nAku akan ingatkan saat mendekati waktunya. Semangat! ✨${TASK_FOOTER_NOTE}`,
        });
        if (reply?.key?.id) {
          await linkTaskMessage(db, updated.id, reply.key.id);
        }
        return;
      }
    }
  }

  // 13. Natural Language Ingestion for new task
  const isExplicitTodo = /^\/todo\b|^todo:/i.test(trimmedText);
  const sentiment = detectSentiment(trimmedText);
  if (sentiment.isDistress && !isExplicitTodo && !isForwarded) {
    console.log('🫂 [Sentiment] Pengguna mengekspresikan kepenatan/distress, membalas dengan hangat.');
    await sock.sendMessage(remoteJid, {
      text: `Duh, peluk jauh dulu ya... 🫂 Tarik napas pelan-pelan.\n\nHidup atau kerjaan emang kadang bikin kewalahan banget, tapi kamu berharga dan pasti bisa lewatin ini semua. Istirahat sejenak, minum air hangat dulu yuk. Nanti kalau ada to-do list atau tugas kecil yang mau dicicil, kasih tahu aku ya biar aku bantu ingetin satu-satu. Tetap semangat, you're not alone! 💪✨`,
    });
    return;
  }

  if (sentiment.isToxicOnly && !isExplicitTodo && !isForwarded) {
    console.log('🧘‍♂️ [Sentiment] Pesan makian/toxic tanpa tugas, membalas santai dan ramah.');
    await sock.sendMessage(remoteJid, {
      text: `Waduh santai dulu brad/kak! 🧘‍♂️ Tarik napas dalam-dalam, jangan emosi gitu dong nanti cepat tua lho! 😜\n\nKalau ada deadline atau to-do list yang bikin pusing, sini tumpahin ke aku biar aku rapikan jadwalnya dan ingetin tepat waktu. Ada tugas apa nih yang mau dicatat? 📝`,
    });
    return;
  }

  const nlpResult = await parseTaskMessage(trimmedText, {
    now: new Date(),
    timezone: user.timezone,
    isForwarded,
  });
  const risk = mergeRisk(assessTextRisk(trimmedText, { isForwarded }), nlpResult.risk);

  if (!nlpResult.isTask) {
    if (risk.flagged) {
      console.warn(`🚨 [Risiko] Pesan non-tugas berisiko (${risk.categories.join(',')}), mengirim peringatan.`);
      await sock.sendMessage(remoteJid, { text: buildRiskAlertText(risk, 'info') });
      return;
    }

    if (/^(halo|hai|hey|p|ping|assalamualaikum|pagi|siang|sore|malam|tes|test)\b/i.test(trimmedText)) {
      console.log('👋 [Sapaan] Membalas salam ramah.');
      await sock.sendMessage(remoteJid, {
        text: `Halo! 👋 Aku asisten pengingat tugasmu.\n\nAda tugas yang ingin dicatat hari ini? Kamu bisa ketik langsung (contoh: _"Besok jam 2 siang rapat tim"_), atau ketik *help* untuk melihat panduan ya! ✨`,
      });
      scheduleLinkFollowUp(sock, remoteJid, trimmedText, null);
      return;
    }

    if (/^(ok|oke|okee|siap|siapp|sip|sipp|mantap|mantabb|makasih|terima kasih|thanks|thx|tengkyu|yoi|yoii)\b/i.test(trimmedText)) {
      console.log('👍 [Respon Santai] Membalas konfirmasi/terima kasih.');
      await sock.sendMessage(remoteJid, {
        text: `Sip brad/kak! 😉 Kalau ada to-do list atau tugas baru yang mau dicatat atau diingatkan, langsung kirim aja ke sini ya! ✨`,
      });
      scheduleLinkFollowUp(sock, remoteJid, trimmedText, null);
      return;
    }

    const timeOnly = isTimeOnlyExpression(trimmedText);
    if (timeOnly.isTimeOnly) {
      console.log('⏰ [Time Only] Pengguna hanya menyebutkan jam tanpa tanggal/tugas, membalas santai dan interaktif.');
      const displayName = user.name || msg.pushName || 'kak';
      await sock.sendMessage(remoteJid, {
        text: `Hi *${displayName}*! 👋 Kamu ingin set jam *${timeOnly.timeText}* ini ke hari ini atau setahun lagi nih? 😜\n\nEhh astaga, bercandaaa... ✌️ Jangan ngambek ya haha!\n\nBiar jadwalnya tepat sasaran, sebutkan juga harinya dan tugas apa yang mau diingatkan ya. Contohnya:\n• _"Hari ini ${timeOnly.timeText} <nama tugas>"_\n• _"Besok ${timeOnly.timeText} <nama tugas>"_\n\nAtau kalau kamu mau jadwalkan tugas yang belum ada waktunya, sebutkan nama tugasnya ya! ✨`,
      });
      return;
    }

    console.log('💬 [Non-Task / Chit-Chat] Membalas pesan santai dan mengarahkan ke tugas.');
    await sock.sendMessage(remoteJid, {
      text: `Hehe santai dulu brad/kak! 😄 Belum nangkep ada tugas atau deadline dari pesan kamu tadi nih.\n\nAku asisten pengingat tugas & to-do list. Mau catat tugas baru (contoh: _"nanti jam 4 sore jemput adik"_), cek daftar tugas (*list*), atau butuh bantuan (*help*)? Langsung kasih tahu aku ya! ✨`,
    });
    scheduleLinkFollowUp(sock, remoteJid, trimmedText, null);
    return;
  }

  if (!hasEnoughTitleLetters(nlpResult.taskTitle)) {
    await sock.sendMessage(remoteJid, { text: buildShortTitleText(nlpResult.taskTitle, 'task') });
    return;
  }

  const now = new Date();
  if (risk.flagged) {
    // A past deadline is dropped so confirming never fires an instant reminder; the bot asks for a time instead.
    const heldDeadline = nlpResult.deadline && nlpResult.deadline.getTime() > now.getTime() ? nlpResult.deadline : null;
    const heldLead = (nlpResult.reminderLeadMinutes && nlpResult.reminderLeadMinutes > 0)
      ? nlpResult.reminderLeadMinutes
      : user.leadReminderMinutes;
    const held = await createTask(db, {
      userJid: remoteJid,
      task: nlpResult.taskTitle,
      deadline: heldDeadline,
      remindAt: heldDeadline ? calculateRemindAt(heldDeadline, { leadMinutes: heldLead, now }) : null,
      status: 'pending_risk_confirmation',
    });
    await askRiskConfirmation(sock, remoteJid, held, risk, 'task');
    return;
  }

  // Check if deadline is specified but already in the past
  if (nlpResult.deadline && nlpResult.deadline.getTime() <= now.getTime()) {
    const deadlineStr = formatDateTime(nlpResult.deadline, user.timezone);
    await sock.sendMessage(remoteJid, {
      text: `⚠️ Waktu yang kamu sebutkan (*${deadlineStr}*) sepertinya sudah lewat dari jam sekarang nih! 😅\n\nMau aku jadwalkan ke kapan? Coba kirim ulang dengan waktu yang akan datang ya (contoh: *besok jam 10 pagi* atau *1 jam lagi*). ✨`,
    });
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

    const pendingTaskFormatted = created.task.includes('\n')
      ? `\n${created.task}`
      : `\n"${created.task}"`;

    const reply = await sock.sendMessage(remoteJid, {
      text: `📝 *Tugas Siap Dicatat!*${pendingTaskFormatted}\n\nBiar tidak terlewat, kapan sebaiknya aku ingatkan tugas ini? Kamu bisa balas pesan ini dengan waktu yang pas (contoh: *besok jam 2 siang* atau *1 jam lagi*), atau cukup pilih opsi berikut:\n${suggestionList}${TASK_FOOTER_NOTE}`,
    });

    if (reply?.key?.id) {
      await linkTaskMessage(db, created.id, reply.key.id);
    }
    scheduleLinkFollowUp(sock, remoteJid, trimmedText, created.id);
    return;
  }

  // Task has a deadline
  const effectiveLeadMinutes = (nlpResult.reminderLeadMinutes && nlpResult.reminderLeadMinutes > 0)
    ? nlpResult.reminderLeadMinutes
    : user.leadReminderMinutes;

  const remindAt = calculateRemindAt(nlpResult.deadline, {
    leadMinutes: effectiveLeadMinutes,
    now,
  });

  const sameSchedule = await findSameScheduleTasks(db, remoteJid, nlpResult.deadline);
  const created = await createTask(db, {
    userJid: remoteJid,
    task: nlpResult.taskTitle,
    deadline: nlpResult.deadline,
    remindAt,
    status: sameSchedule.length > 0 ? 'pending_confirmation' : 'pending',
  });

  if (sameSchedule.length > 0) {
    await askSameScheduleConfirmation(sock, remoteJid, created, sameSchedule, user.timezone);
    scheduleLinkFollowUp(sock, remoteJid, trimmedText, created.id);
    return;
  }

  const deadlineStr = formatDateTime(nlpResult.deadline, user.timezone);
  let reminderNote = '';
  if (nlpResult.reminderLeadMinutes && nlpResult.reminderLeadMinutes > 0) {
    const leadTxt = nlpResult.reminderLeadMinutes >= 1440 && nlpResult.reminderLeadMinutes % 1440 === 0
      ? `${nlpResult.reminderLeadMinutes / 1440} hari`
      : nlpResult.reminderLeadMinutes >= 60 && nlpResult.reminderLeadMinutes % 60 === 0
      ? `${nlpResult.reminderLeadMinutes / 60} jam`
      : `${nlpResult.reminderLeadMinutes} menit`;

    // Check if the requested lead time overlaps with now or falls in the past
    const isLeadInPast = nlpResult.deadline.getTime() - nlpResult.reminderLeadMinutes * 60 * 1000 <= now.getTime();
    if (isLeadInPast) {
      reminderNote = `\n⏱️ Catatan Pengingat: Karena waktu pengingat yang diminta (*${leadTxt} sebelumnya*) sudah terlewat dari jam sekarang, alarmnya aku pasang pas tepat waktu deadline ya! 😉 (${formatDateTime(remindAt, user.timezone)})`;
    } else {
      reminderNote = `\n⏱️ Pengingat Khusus: *${leadTxt} sebelum deadline* (${formatDateTime(remindAt, user.timezone)})`;
    }
  }

  let cleanNote = '';
  if (nlpResult.sentiment?.hasProfanity) {
    cleanNote = '\n\n_(Tugasnya udah aku catat rapi ya, kata-kata kasarnya udah aku bersihin biar tetep adem dibaca haha 🧘‍♂️ Tetap semangat beresinnya! 💪)_';
  }

  const taskFormatted = created.task.includes('\n')
    ? `📝 *Tugas:*\n${created.task}`
    : `📝: *${created.task}*`;

  const reply = await sock.sendMessage(remoteJid, {
    text: `✅ *Tugas Dicatat!*\n${taskFormatted}\n⏰ Deadline: *${deadlineStr}*${reminderNote}${cleanNote}\n\nAku akan ingatkan mendekati waktu tersebut. Semangat!${TASK_FOOTER_NOTE}`,
  });

  if (reply?.key?.id) {
    await linkTaskMessage(db, created.id, reply.key.id);
  }
  scheduleLinkFollowUp(sock, remoteJid, trimmedText, created.id);
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
    const resolved = await resolveTask(db, matchedTask.id, remoteJid, `Reaction: ${reactionText}`);
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
    const cancelled = await cancelTask(db, matchedTask.id, remoteJid, `Reaction: ${reactionText}`);
    if (cancelled) {
      await sock.sendMessage(remoteJid, {
        text: `🗑️ *Tugas Dibatalkan:*\n"${cancelled.task}"\n\nTugas ini sudah dicoret dari daftar aktifmu.`,
      });
    }
    return;
  }
}
