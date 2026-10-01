import makeWASocket, {
  DisconnectReason,
  fetchLatestWaWebVersion,
  useMultiFileAuthState,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import { config } from '../config/index.js';
import { handleIncomingMessage, handleIncomingReaction, formatDateTime } from './handlers/router.js';
import { checkAndDispatchReminders, generateReminderMessage } from '../services/reminder.js';
import { db } from '../db/index.js';
import { tasks, taskHistory } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { ensureUserSettings, getTaskAttachments, linkTaskMessage } from '../services/task.js';
import { getAttachmentBuffer } from '../services/media.js';
import { ensureAuthDirectory, saveCredentialsSafely } from './auth.js';
import { dispatchMorningDigests } from '../services/morning-digest.js';
import { runtimeHealth, telemetry } from '../services/telemetry.js';

const logger = pino({ level: config.logLevel });
let activeSchedulerInterval: ReturnType<typeof setInterval> | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let currentSocket: any = null;
let schedulerRunning = false;
let stopping = false;

function stopScheduler(): void {
  if (activeSchedulerInterval) clearInterval(activeSchedulerInterval);
  activeSchedulerInterval = null;
}

export function stopBot(): void {
  stopping = true;
  stopScheduler();
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  reconnectTimeout = null;
  try {
    currentSocket?.end(undefined);
  } catch {}
  currentSocket = null;
}

export async function startBot() {
  await ensureAuthDirectory(config.authDir);
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version, isLatest } = await fetchLatestWaWebVersion().catch(() => ({
    version: [2, 3000, 1015901307] as any,
    isLatest: false,
  }));

  logger.info(`Starting Baileys using WA Web v${version.join('.')}, isLatest: ${isLatest}`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
  });
  currentSocket = sock;

  // Save updated credentials
  sock.ev.on('creds.update', async () => {
    await saveCredentialsSafely(config.authDir, saveCreds, (error) => {
      logger.error({ err: error, authDir: config.authDir }, 'Failed to persist Baileys credentials');
    });
  });

  // Connection lifecycle
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n======================================================');
      console.log('📱 Scan QR Code berikut dengan aplikasi WhatsApp Anda:');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      stopScheduler();
      runtimeHealth.whatsappStatus = shouldReconnect ? 'reconnecting' : 'logged_out';
      runtimeHealth.whatsappChangedAt = new Date();
      telemetry.increment('whatsapp_connection_total', {
        outcome: shouldReconnect ? 'reconnecting' : 'logged_out',
      });
      logger.warn({ event: 'whatsapp_connection_closed', shouldReconnect }, 'WhatsApp connection closed');
      if (shouldReconnect && !stopping && !reconnectTimeout) {
        reconnectTimeout = setTimeout(() => {
          reconnectTimeout = null;
          startBot().catch((err) => {
            logger.error({ event: 'whatsapp_reconnect_failed', err }, 'WhatsApp reconnect failed');
          });
        }, 3000);
      }
    } else if (connection === 'open') {
      const botNumber = sock.user?.id ? sock.user.id.split(':')[0] : 'Unknown';
      runtimeHealth.whatsappStatus = 'connected';
      runtimeHealth.whatsappChangedAt = new Date();
      telemetry.increment('whatsapp_connection_total', { outcome: 'connected' });
      console.log(`\n✅ WhatsApp Bot berhasil terhubung! Nomor: ${botNumber}`);
    }
  });

  const botSentMessageIds = new Set<string>();

  // Wrap sock.sendMessage to record outgoing IDs
  const originalSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid: string, content: any, options?: any) => {
    const res = await originalSendMessage(jid, content, options);
    if (res?.key?.id) {
      botSentMessageIds.add(res.key.id);
      if (botSentMessageIds.size > 500) {
        const first = botSentMessageIds.values().next().value;
        if (first) botSentMessageIds.delete(first);
      }
    }
    return res;
  };

  // Message listener
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : '';

    for (const msg of messages) {
      // 1. Skip if message was sent by the bot's automated handler
      if (msg.key?.id && botSentMessageIds.has(msg.key.id)) continue;

      const rawJid = msg.key?.remoteJid || '';
      const normalizedRemote = jidNormalizedUser(rawJid);
      const isSelfChat = botJid && normalizedRemote === botJid;

      // 2. If sent from this account to another person, skip. But allow self-chat!
      if (msg.key.fromMe && !isSelfChat) continue;

      try {
        const startedAt = performance.now();
        telemetry.increment('message_received_total', { type: 'message', outcome: 'accepted' });
        await handleIncomingMessage(sock, msg);
        telemetry.observe('message_handler_duration_ms', Math.round(performance.now() - startedAt), {
          operation: 'message',
          outcome: 'success',
        });
      } catch (err) {
        telemetry.increment('message_handler_total', { operation: 'message', outcome: 'failed' });
        telemetry.recordEvent({
          component: 'router',
          operation: 'message',
          outcome: 'failed',
          provider: null,
          errorCode: 'HANDLER_ERROR',
          durationMs: null,
        });
        logger.error({ event: 'message_handler_failed', err }, 'Error processing incoming message');
      }
    }
  });

  // Reaction listener
  sock.ev.on('messages.reaction', async (reactions) => {
    const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : '';

    for (const r of reactions) {
      const rawJid = r.key?.remoteJid || r.reaction?.key?.remoteJid || '';
      const normalizedRemote = jidNormalizedUser(rawJid);
      const isSelfChat = Boolean(botJid && normalizedRemote === botJid);

      // Only skip reactions if they were sent by this bot account to another person
      if (r.reaction?.key?.fromMe && !isSelfChat) continue;

      try {
        const startedAt = performance.now();
        await handleIncomingReaction(sock, r);
        telemetry.observe('message_handler_duration_ms', Math.round(performance.now() - startedAt), {
          operation: 'reaction',
          outcome: 'success',
        });
      } catch (err) {
        telemetry.increment('message_handler_total', { operation: 'reaction', outcome: 'failed' });
        telemetry.recordEvent({
          component: 'router',
          operation: 'reaction',
          outcome: 'failed',
          provider: null,
          errorCode: 'HANDLER_ERROR',
          durationMs: null,
        });
        logger.error({ event: 'reaction_handler_failed', err }, 'Error processing message reaction');
      }
    }
  });

  // Background scheduler (runs every 60 seconds, one cycle at a time)
  stopScheduler();
  const runSchedulerCycle = async () => {
    if (schedulerRunning || stopping) {
      telemetry.increment('scheduler_cycle_total', { operation: 'combined', outcome: 'skipped' });
      return;
    }
    if (runtimeHealth.schedulerPaused) {
      telemetry.increment('scheduler_cycle_total', { operation: 'combined', outcome: 'paused' });
      return;
    }
    if (runtimeHealth.whatsappStatus !== 'connected') {
      telemetry.increment('scheduler_cycle_total', { operation: 'combined', outcome: 'disconnected' });
      return;
    }
    schedulerRunning = true;
    const cycleStartedAt = performance.now();
    try {
      if (runtimeHealth.reminderCronEnabled) {
        const reminderCount = await checkAndDispatchReminders(db, async (task, isOverdue) => {
          const user = await ensureUserSettings(db, task.userJid);
          const deadlineStr = task.deadline
            ? formatDateTime(new Date(task.deadline), user.timezone)
            : '';

          let parentTitle: string | null = null;
          if (task.parentId) {
            const parent = await db.select().from(tasks).where(eq(tasks.id, task.parentId)).limit(1);
            parentTitle = parent[0]?.task ?? null;
          }

          const alertText = await generateReminderMessage(task, isOverdue, deadlineStr, undefined, parentTitle);

          // Direct Media Reminder: Send media image/PDF with alertText as caption if attachment exists
          let sent: any = null;
          try {
            const attachments = await getTaskAttachments(db, task.id);
            if (attachments.length > 0 && attachments[0]) {
              const primary = attachments[0];
              const buffer = await getAttachmentBuffer(primary.storagePath);

              if (buffer) {
                if (primary.fileType === 'image') {
                  sent = await sock.sendMessage(task.userJid, {
                    image: buffer,
                    caption: alertText,
                  });
                } else if (primary.fileType === 'document') {
                  sent = await sock.sendMessage(task.userJid, {
                    document: buffer,
                    fileName: primary.fileName,
                    mimetype: primary.mimeType,
                    caption: alertText,
                  });
                }
              }
            }
          } catch (mediaErr: any) {
            logger.warn({ err: mediaErr, taskId: task.id }, 'Gagal mengirim pengingat dengan lampiran media, beralih ke teks');
          }

          // Fallback to text reminder if no media attachment or media send was skipped
          if (!sent) {
            sent = await sock.sendMessage(task.userJid, { text: alertText });
          }

          return sent?.key?.id ?? null;
        });
        runtimeHealth.lastReminderCycleAt = new Date();
        telemetry.observe('reminder_dispatch_count', reminderCount, { outcome: 'success' });
      }

      if (runtimeHealth.morningDigestCronEnabled) {
        const digestResult = await dispatchMorningDigests(db, {
          sendMessage: async (userJid, text) => {
            const sent = await sock.sendMessage(userJid, { text });
            return sent?.key?.id ?? null;
          },
        });
        runtimeHealth.lastMorningDigestCycleAt = new Date();
        telemetry.observe('morning_digest_due_count', digestResult.due, { outcome: 'success' });
        if (digestResult.sent > 0) {
          telemetry.observe('morning_digest_sent_count', digestResult.sent, { outcome: 'success' });
        }
        if (digestResult.failed > 0) {
          telemetry.observe('morning_digest_failed_count', digestResult.failed, { outcome: 'failed' });
        }
      }
      telemetry.increment('scheduler_cycle_total', { operation: 'combined', outcome: 'success' });
    } catch (err) {
      telemetry.increment('scheduler_cycle_total', { operation: 'combined', outcome: 'failed' });
      telemetry.recordEvent({
        component: 'scheduler',
        operation: 'combined_cycle',
        outcome: 'failed',
        provider: null,
        errorCode: 'SCHEDULER_ERROR',
        durationMs: Math.round(performance.now() - cycleStartedAt),
      });
      logger.error({ event: 'scheduler_cycle_failed', err }, 'Error in scheduler cycle');
    } finally {
      telemetry.observe('scheduler_cycle_duration_ms', Math.round(performance.now() - cycleStartedAt), {
        operation: 'combined',
      });
      schedulerRunning = false;
    }
  };

  activeSchedulerInterval = setInterval(runSchedulerCycle, 60 * 1000);

  return { sock, reminderInterval: activeSchedulerInterval };
}

/**
 * Triggers a manual reminder for a task immediately.
 * Usable from the dashboard manual reminder trigger action.
 */
export async function triggerTaskReminder(
  db: any,
  taskId: number,
  customSend?: (userJid: string, content: any) => Promise<any>
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const taskList = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const task = taskList[0];
  if (!task) {
    return { success: false, error: 'TASK_NOT_FOUND' };
  }
  if (task.status === 'resolved' || task.status === 'cancelled') {
    return { success: false, error: 'TASK_ALREADY_CLOSED' };
  }

  const socketToUse = customSend ? null : currentSocket;
  if (!customSend && (!socketToUse || runtimeHealth.whatsappStatus !== 'connected')) {
    return { success: false, error: 'WHATSAPP_NOT_CONNECTED' };
  }

  const user = await ensureUserSettings(db, task.userJid);
  const deadlineStr = task.deadline
    ? formatDateTime(new Date(task.deadline), user.timezone)
    : 'Tanpa deadline';

  let parentTitle: string | null = null;
  if (task.parentId) {
    const parent = await db.select().from(tasks).where(eq(tasks.id, task.parentId)).limit(1);
    parentTitle = parent[0]?.task ?? null;
  }

  const isOverdue = task.deadline ? new Date(task.deadline).getTime() < Date.now() : false;
  const alertText = await generateReminderMessage(task, isOverdue, deadlineStr, undefined, parentTitle, {
    userName: user.name,
    isManualTrigger: true,
  });

  let sent: any = null;
  const sendFn = customSend || ((jid: string, content: any) => socketToUse.sendMessage(jid, content));

  try {
    const attachments = await getTaskAttachments(db, task.id);
    if (attachments.length > 0 && attachments[0]) {
      const primary = attachments[0];
      const buffer = await getAttachmentBuffer(primary.storagePath);
      if (buffer) {
        if (primary.fileType === 'image') {
          sent = await sendFn(task.userJid, {
            image: buffer,
            caption: alertText,
          });
        } else if (primary.fileType === 'document') {
          sent = await sendFn(task.userJid, {
            document: buffer,
            fileName: primary.fileName,
            mimetype: primary.mimeType,
            caption: alertText,
          });
        }
      }
    }
  } catch (mediaErr: any) {
    logger.warn({ err: mediaErr, taskId: task.id }, 'Manual reminder attachment error, falling back to text');
  }

  if (!sent) {
    sent = await sendFn(task.userJid, { text: alertText });
  }

  const messageId = sent?.key?.id ?? null;
  const newRemindedLevel = isOverdue ? 2 : 1;

  await db
    .update(tasks)
    .set({
      reminded: newRemindedLevel,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id));

  if (messageId) {
    await linkTaskMessage(db, task.id, messageId);
  }

  await db.insert(taskHistory).values({
    taskId: task.id,
    userJid: task.userJid,
    changeType: 'reminded',
    fieldChanged: 'reminded',
    oldValue: String(task.reminded),
    newValue: String(newRemindedLevel),
    rawInput: 'Dashboard Manual Trigger',
    createdAt: new Date(),
  });

  telemetry.increment('reminder_dispatch_total', { type: 'manual', outcome: 'success' });

  return { success: true, messageId: messageId ?? undefined };
}
