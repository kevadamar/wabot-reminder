import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.js';

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
  detectedMime?: string;
  detectedExt?: string;
  fileType?: 'image' | 'document';
}

export interface SanitizedMediaResult {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  sha256Hash: string;
  fileSize: number;
}

export interface AIScreeningResult {
  isSuspicious: boolean;
  safetyReason?: string | null;
  ocrText: string;
  isTask: boolean;
  taskTitle?: string;
  suggestedDeadline?: string | null;
}

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_DOC_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_DOC_MIMES = new Set(['application/pdf']);

/**
 * Validates a buffer via Magic Bytes and File Signature (Layer 1 Gatekeeper)
 */
export async function validateMediaBuffer(buffer: Buffer, claimedMime?: string): Promise<FileValidationResult> {
  if (!buffer || buffer.length === 0) {
    return { isValid: false, error: 'File kosong atau buffer tidak valid.' };
  }

  // Pre-screen for SVG / XML attack vectors (which are text-based and might not have binary signatures)
  const headerSample = buffer.subarray(0, 512).toString('utf-8').toLowerCase();
  if (
    claimedMime?.toLowerCase().includes('svg') ||
    claimedMime?.toLowerCase().includes('xml') ||
    headerSample.includes('<svg') ||
    headerSample.includes('<?xml')
  ) {
    return {
      isValid: false,
      error: 'File SVG/XML ditolak demi keamanan (vektor XSS/script injection).',
    };
  }

  // 1. Inspect Magic Bytes
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) {
    return {
      isValid: false,
      error: 'Format file tidak dikenali atau signature biner mencurigakan.',
    };
  }

  const mime = detected.mime.toLowerCase();
  const ext = detected.ext.toLowerCase();

  // 2. Reject SVG or executable formats explicitly
  if (mime.includes('svg') || ext === 'svg' || mime.includes('xml') || ext === 'xml') {
    return {
      isValid: false,
      error: 'File SVG/XML ditolak demi keamanan (vektor XSS/script injection).',
      detectedMime: mime,
      detectedExt: ext,
    };
  }

  // 3. Classify Image
  if (ALLOWED_IMAGE_MIMES.has(mime)) {
    if (buffer.length > MAX_IMAGE_SIZE) {
      return {
        isValid: false,
        error: `Ukuran gambar melebihi batas maksimal (Maks 5 MB). Ukuran file: ${(buffer.length / (1024 * 1024)).toFixed(1)} MB`,
        detectedMime: mime,
        detectedExt: ext,
      };
    }
    return {
      isValid: true,
      detectedMime: mime,
      detectedExt: ext,
      fileType: 'image',
    };
  }

  // 4. Classify Document
  if (ALLOWED_DOC_MIMES.has(mime)) {
    if (buffer.length > MAX_DOC_SIZE) {
      return {
        isValid: false,
        error: `Ukuran dokumen melebihi batas maksimal (Maks 10 MB). Ukuran file: ${(buffer.length / (1024 * 1024)).toFixed(1)} MB`,
        detectedMime: mime,
        detectedExt: ext,
      };
    }
    return {
      isValid: true,
      detectedMime: mime,
      detectedExt: ext,
      fileType: 'document',
    };
  }

  return {
    isValid: false,
    error: `Tipe file '${mime}' (${ext}) tidak diizinkan. Hanya menerima format: JPG, PNG, WEBP, dan PDF.`,
    detectedMime: mime,
    detectedExt: ext,
  };
}

export interface SanitizeImageOptions {
  maxDimension?: number;
  quality?: number;
}

/**
 * Sanitizes image buffer via Content Disarming & Reconstruction (CDR) with Sharp (Layer 2)
 * Strips EXIF/GPS, removes hidden chunks, normalizes pixels, and scales within max bounding box.
 * Default max dimension is 4096 (High quality / 4K), compact is 2048 (2K).
 */
export async function sanitizeImageBuffer(
  buffer: Buffer,
  options?: SanitizeImageOptions
): Promise<SanitizedMediaResult> {
  const maxDim = options?.maxDimension ?? 4096;
  const quality = options?.quality ?? 85;

  const cleanBuffer = await sharp(buffer)
    .rotate() // Auto-orient based on EXIF before stripping
    .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, progressive: true, force: false })
    .toBuffer();

  const sha256Hash = crypto.createHash('sha256').update(cleanBuffer).digest('hex');

  return {
    buffer: cleanBuffer,
    mimeType: 'image/jpeg',
    extension: 'jpg',
    sha256Hash,
    fileSize: cleanBuffer.length,
  };
}

/**
 * Processes document buffer and generates SHA-256 hash
 */
export function sanitizeDocumentBuffer(buffer: Buffer, mimeType: string, extension: string): SanitizedMediaResult {
  const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');
  return {
    buffer,
    mimeType,
    extension,
    sha256Hash,
    fileSize: buffer.length,
  };
}

let defaultGeminiClient: any = null;
function getGeminiClient() {
  if (!defaultGeminiClient && config.geminiApiKey) {
    defaultGeminiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return defaultGeminiClient;
}

/**
 * Multimodal AI Screening: Checks for scam/fraud/phishing & performs OCR task extraction (Layer 4)
 */
export async function screenAndExtractImageWithAI(
  buffer: Buffer,
  mimeType = 'image/jpeg',
  customClient?: any
): Promise<AIScreeningResult> {
  const gemini = customClient !== undefined ? customClient : getGeminiClient();

  if (!gemini) {
    return {
      isSuspicious: false,
      safetyReason: null,
      ocrText: '',
      isTask: false,
    };
  }

  const prompt = `Analisis gambar berikut untuk keperluan asisten to-do WhatsApp pribadi.
Instruksi:
1. Periksa Keamanan: Apakah gambar ini mengandung indikasi penipuan, bukti transfer perbankan palsu/manipulasi, ajakan instalasi APK berbahaya, atau modus scam/phishing? (isSuspicious: true/false, safetyReason: string | null).
2. Lakukan OCR: Baca teks penting di dalam gambar (struk, invoice, tiket, jadwal rapat, papan tulis).
3. Ekstraksi Tugas: Tentukan apakah gambar ini mengindikasikan sebuah tugas yang perlu diselesaikan (isTask: true/false, taskTitle: string, suggestedDeadline: ISO string atau null).

Balas HANYA dengan JSON valid tanpa markdown formatting:
{"isSuspicious": boolean, "safetyReason": string | null, "ocrText": string, "isTask": boolean, "taskTitle": string, "suggestedDeadline": string | null}`;

  try {
    const base64Data = buffer.toString('base64');
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini Vision API timeout (4s)')), 4000)
    );

    const response: any = await Promise.race([
      gemini.models.generateContent({
        model: config.geminiModel,
        contents: [
          prompt,
          {
            inlineData: {
              data: base64Data,
              mimeType,
            },
          },
        ],
        config: {
          thinkingConfig: {
            thinkingLevel: config.geminiThinkingLevel as any,
          },
        },
      }),
      timeoutPromise,
    ]);

    const responseText = response.text?.trim() || '';
    const cleanedJson = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanedJson);

    return {
      isSuspicious: Boolean(parsed.isSuspicious),
      safetyReason: parsed.safetyReason || null,
      ocrText: parsed.ocrText || '',
      isTask: Boolean(parsed.isTask),
      taskTitle: parsed.taskTitle || '',
      suggestedDeadline: parsed.suggestedDeadline || null,
    };
  } catch (err: any) {
    console.warn(`[MediaAI] Gemini Vision analysis error (${err?.message || err}), menggunakan fallback aman...`);
    return {
      isSuspicious: false,
      safetyReason: null,
      ocrText: '',
      isTask: false,
    };
  }
}

let s3ClientInstance: S3Client | null = null;
let s3BucketVerified = false;

export function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      credentials: {
        accessKeyId: config.s3AccessKey,
        secretAccessKey: config.s3SecretKey,
      },
      forcePathStyle: config.s3ForcePathStyle,
    });
  }
  return s3ClientInstance;
}

export async function ensureS3Bucket(s3: S3Client, bucketName: string): Promise<void> {
  if (s3BucketVerified) return;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    s3BucketVerified = true;
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucketName }));
      s3BucketVerified = true;
      console.log(`🪣 [S3 Storage] Bucket '${bucketName}' berhasil dibuat/diverifikasi.`);
    } catch (err: any) {
      console.warn(`[S3 Storage] Info bucket '${bucketName}': ${err?.message || err}`);
    }
  }
}

/**
 * Saves sanitized media buffer to S3 (Rust FS / MinIO) or sandboxed local storage
 */
export async function saveAttachmentToStorage(
  buffer: Buffer,
  extension: string,
  mimeType = 'application/octet-stream',
  baseDir = './storage/attachments',
  customS3?: S3Client
): Promise<string> {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const randomId = crypto.randomUUID();
  const key = `${year}/${month}/${randomId}.${extension}`;

  // If S3 storage driver is active or customS3 provided
  if ((config.storageDriver === 's3' && config.s3AccessKey) || customS3) {
    try {
      const s3 = customS3 || getS3Client();
      await ensureS3Bucket(s3, config.s3Bucket);
      await s3.send(
        new PutObjectCommand({
          Bucket: config.s3Bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        })
      );
      console.log(`☁️ [S3 Storage] File berhasil di-upload ke S3: s3://${config.s3Bucket}/${key}`);
      return `s3://${config.s3Bucket}/${key}`;
    } catch (err: any) {
      console.error(`[S3 Storage] Gagal upload ke S3 (${err?.message || err}), beralih ke penyimpanan lokal...`);
    }
  }

  // Fallback / Default: Local sandboxed storage
  const targetDir = path.join(baseDir, year, month);
  await fs.mkdir(targetDir, { recursive: true });

  const filename = `${randomId}.${extension}`;
  const fullPath = path.join(targetDir, filename);

  await fs.writeFile(fullPath, buffer, { mode: 0o600 });
  return fullPath;
}

/**
 * Retrieves attachment binary buffer from S3 or local storage
 */
export async function getAttachmentBuffer(
  storagePath: string,
  customS3?: S3Client
): Promise<Buffer | null> {
  if (!storagePath) return null;

  if (storagePath.startsWith('s3://')) {
    try {
      const s3Uri = storagePath.replace('s3://', '');
      const slashIndex = s3Uri.indexOf('/');
      const bucket = slashIndex !== -1 ? s3Uri.slice(0, slashIndex) : config.s3Bucket;
      const key = slashIndex !== -1 ? s3Uri.slice(slashIndex + 1) : s3Uri;

      const s3 = customS3 || getS3Client();
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );

      if (response.Body) {
        const bytes = await response.Body.transformToByteArray();
        return Buffer.from(bytes);
      }
      return null;
    } catch (err: any) {
      console.error(`[S3 Storage] Gagal mengunduh file dari S3 (${storagePath}): ${err?.message || err}`);
      return null;
    }
  }

  // Local storage path
  try {
    const exists = await fs
      .stat(storagePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) return null;
    return await fs.readFile(storagePath);
  } catch (err: any) {
    console.error(`[LocalStorage] Gagal membaca file dari disk (${storagePath}): ${err?.message || err}`);
    return null;
  }
}
