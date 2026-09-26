export const config = {
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/todo_bot',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  defaultTimezone: process.env.TIMEZONE || 'Asia/Jakarta',
  defaultReminderLeadMinutes: parseInt(process.env.DEFAULT_REMINDER_LEAD_MINUTES || '30', 10),
  authDir: process.env.AUTH_DIR || './auth_info',
  logLevel: process.env.LOG_LEVEL || 'info',
  antigravityBridgeUrl: process.env.ANTIGRAVITY_BRIDGE_URL || '',
};
