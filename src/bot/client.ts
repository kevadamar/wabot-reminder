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
import { ensureUserSettings } from '../services/task.js';
import { ensureAuthDirectory, saveCredentialsSafely } from './auth.js';

const logger = pino({ level: config.logLevel });

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
      logger.warn(
        `Koneksi terputus karena: ${lastDisconnect?.error}, mencoba menyambung ulang: ${shouldReconnect}`
      );
      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      }
    } else if (connection === 'open') {
      const botNumber = sock.user?.id ? sock.user.id.split(':')[0] : 'Unknown';
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
        await handleIncomingMessage(sock, msg);
      } catch (err) {
        logger.error({ err, msgId: msg.key?.id }, 'Error processing incoming message');
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
        await handleIncomingReaction(sock, r);
      } catch (err) {
        logger.error({ err, msgId: r.key?.id }, 'Error processing message reaction');
      }
    }
  });

  // Background reminder cron (runs every 60 seconds)
  const reminderInterval = setInterval(async () => {
    try {
      await checkAndDispatchReminders(db, async (task, isOverdue) => {
        const user = await ensureUserSettings(db, task.userJid);
        const deadlineStr = task.deadline
          ? formatDateTime(new Date(task.deadline), user.timezone)
          : '';

        const alertText = await generateReminderMessage(task, isOverdue, deadlineStr);
        const sent = await sock.sendMessage(task.userJid, { text: alertText });
        return sent?.key?.id ?? null;
      });
    } catch (err) {
      logger.error({ err }, 'Error in reminder scheduler cycle');
    }
  }, 60 * 1000);

  return { sock, reminderInterval };
}
