import { LlmError } from './errors.js';
import { extractJsonObject } from './text.js';
import type { LlmRiskCategory, LlmRiskVerdict } from '../risk.js';

const SENTIMENTS = new Set(['distress', 'toxic', 'frustrated', 'neutral', 'positive']);
const RISK_CATEGORY_VALUES = ['none', 'gambling', 'scam', 'phishing', 'malware'] as const;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function parseRiskCategory(value: unknown): LlmRiskCategory | null {
  return typeof value === 'string' && (RISK_CATEGORY_VALUES as readonly string[]).includes(value)
    ? (value as LlmRiskCategory)
    : null;
}

function parseRiskVerdict(value: unknown): LlmRiskVerdict {
  if (!value || typeof value !== 'object') return { category: 'none', reason: null };
  const data = value as Record<string, unknown>;
  const category = parseRiskCategory(data.category);
  if (!category || category === 'none') return { category: 'none', reason: null };
  const reason = typeof data.reason === 'string' && data.reason.trim() ? data.reason.trim().slice(0, 300) : null;
  return { category, reason };
}

export const NLP_JSON_SCHEMA = {
  type: 'object',
  properties: {
    isTask: { type: 'boolean' },
    taskTitle: { type: 'string' },
    deadline: { type: 'string' },
    needsDeadline: { type: 'boolean' },
    reminderLeadMinutes: { type: 'integer' },
    sentiment: { type: 'string', enum: ['distress', 'toxic', 'frustrated', 'neutral', 'positive'] },
    risk: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: [...RISK_CATEGORY_VALUES] },
        reason: { type: 'string' },
      },
      required: ['category'],
    },
  },
  required: ['isTask', 'taskTitle', 'needsDeadline', 'sentiment'],
} as const;

export interface NlpModelOutput {
  isTask: boolean;
  taskTitle: string;
  deadline: string | null;
  needsDeadline: boolean;
  reminderLeadMinutes: number | null;
  sentiment: 'distress' | 'toxic' | 'frustrated' | 'neutral' | 'positive';
  risk: LlmRiskVerdict;
}

export function parseNlpModelOutput(text: string, now: Date): NlpModelOutput {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(extractJsonObject(text)) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof LlmError) throw err;
    throw new LlmError('invalid_output');
  }
  if (typeof data.isTask !== 'boolean' || typeof data.taskTitle !== 'string' || data.taskTitle.length > 4000) {
    throw new LlmError('invalid_output');
  }
  let deadline: string | null = null;
  if (data.deadline !== undefined && data.deadline !== null && data.deadline !== '') {
    if (typeof data.deadline !== 'string') throw new LlmError('invalid_output');
    const parsed = new Date(data.deadline);
    if (Number.isNaN(parsed.getTime())) throw new LlmError('invalid_output');
    const delta = parsed.getTime() - now.getTime();
    if (delta < -2 * YEAR_MS || delta > 5 * YEAR_MS) throw new LlmError('invalid_output');
    deadline = parsed.toISOString();
  }
  let reminderLeadMinutes: number | null = null;
  if (typeof data.reminderLeadMinutes === 'number' && Number.isFinite(data.reminderLeadMinutes) && data.reminderLeadMinutes > 0) {
    reminderLeadMinutes = Math.min(Math.max(Math.round(data.reminderLeadMinutes), 1), 10080);
  }
  const sentiment = SENTIMENTS.has(String(data.sentiment))
    ? (data.sentiment as NlpModelOutput['sentiment'])
    : 'neutral';
  return {
    isTask: data.isTask,
    taskTitle: data.taskTitle,
    deadline,
    needsDeadline: Boolean(data.needsDeadline),
    reminderLeadMinutes,
    sentiment,
    risk: parseRiskVerdict(data.risk),
  };
}

export const LINK_REVIEW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: [...RISK_CATEGORY_VALUES] },
    reason: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['category', 'summary'],
} as const;

export interface LinkReviewModelOutput {
  verdict: LlmRiskVerdict;
  summary: string | null;
}

export function parseLinkReviewOutput(text: string): LinkReviewModelOutput {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(extractJsonObject(text)) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof LlmError) throw err;
    throw new LlmError('invalid_output');
  }
  if (!parseRiskCategory(data.category)) throw new LlmError('invalid_output');
  const summary =
    typeof data.summary === 'string'
      ? data.summary.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)
      : '';
  return { verdict: parseRiskVerdict(data), summary: summary || null };
}

export const VISION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    isSuspicious: { type: 'boolean' },
    riskCategory: { type: 'string', enum: [...RISK_CATEGORY_VALUES] },
    safetyReason: { type: 'string' },
    ocrText: { type: 'string' },
    isTask: { type: 'boolean' },
    taskTitle: { type: 'string' },
    suggestedDeadline: { type: 'string' },
  },
  required: ['isSuspicious', 'ocrText', 'isTask'],
} as const;

export interface VisionModelOutput {
  isSuspicious: boolean;
  riskCategory: LlmRiskCategory;
  safetyReason: string | null;
  ocrText: string;
  isTask: boolean;
  taskTitle: string;
  suggestedDeadline: string | null;
}

export function parseVisionModelOutput(text: string): VisionModelOutput {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(extractJsonObject(text)) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof LlmError) throw err;
    throw new LlmError('invalid_output');
  }
  if (typeof data.isSuspicious !== 'boolean') throw new LlmError('invalid_output');
  let suggestedDeadline: string | null = null;
  if (typeof data.suggestedDeadline === 'string' && data.suggestedDeadline) {
    const parsed = new Date(data.suggestedDeadline);
    suggestedDeadline = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const riskCategory = parseRiskCategory(data.riskCategory);
  return {
    isSuspicious: data.isSuspicious,
    riskCategory: data.isSuspicious ? (riskCategory && riskCategory !== 'none' ? riskCategory : 'scam') : 'none',
    safetyReason: typeof data.safetyReason === 'string' ? data.safetyReason.slice(0, 500) : null,
    ocrText: typeof data.ocrText === 'string' ? data.ocrText.slice(0, 4000) : '',
    isTask: Boolean(data.isTask),
    taskTitle: typeof data.taskTitle === 'string' ? data.taskTitle.slice(0, 500) : '',
    suggestedDeadline,
  };
}
