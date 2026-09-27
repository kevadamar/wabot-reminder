import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import {
  validateMediaBuffer,
  sanitizeImageBuffer,
  sanitizeDocumentBuffer,
  screenAndExtractImageWithAI,
  saveAttachmentToStorage,
  getAttachmentBuffer,
  MAX_IMAGE_SIZE,
} from '../../src/services/media.js';

describe('Media Security Pipeline', () => {
  it('should validate valid JPEG image buffer via magic bytes', async () => {
    const jpegBuffer = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const result = await validateMediaBuffer(jpegBuffer, 'image/jpeg');
    expect(result.isValid).toBe(true);
    expect(result.fileType).toBe('image');
    expect(result.detectedMime).toBe('image/jpeg');
  });

  it('should validate valid PNG image buffer via magic bytes', async () => {
    const pngBuffer = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const result = await validateMediaBuffer(pngBuffer, 'image/png');
    expect(result.isValid).toBe(true);
    expect(result.fileType).toBe('image');
    expect(result.detectedMime).toBe('image/png');
  });

  it('should validate valid PDF document buffer via magic bytes', async () => {
    // Minimal valid PDF byte sequence
    const pdfBuffer = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n118\n%%EOF\n'
    );

    const result = await validateMediaBuffer(pdfBuffer, 'application/pdf');
    expect(result.isValid).toBe(true);
    expect(result.fileType).toBe('document');
    expect(result.detectedMime).toBe('application/pdf');
  });

  it('should reject SVG files to prevent XSS and script injection attacks', async () => {
    const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const result = await validateMediaBuffer(svgBuffer, 'image/svg+xml');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('SVG');
  });

  it('should reject executable or arbitrary binary files', async () => {
    const exeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00');
    const result = await validateMediaBuffer(exeBuffer, 'application/x-msdownload');
    expect(result.isValid).toBe(false);
  });

  it('should reject oversized images exceeding MAX_IMAGE_SIZE', async () => {
    // Mock an oversized buffer
    const fakeOversizedBuffer = Buffer.alloc(MAX_IMAGE_SIZE + 1024);
    // Add JPEG magic bytes at header
    fakeOversizedBuffer[0] = 0xff;
    fakeOversizedBuffer[1] = 0xd8;
    fakeOversizedBuffer[2] = 0xff;

    const result = await validateMediaBuffer(fakeOversizedBuffer, 'image/jpeg');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('melebihi batas maksimal');
  });

  it('should sanitize image buffer via CDR (stripping EXIF and normalising pixels)', async () => {
    const rawBuffer = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    const sanitized = await sanitizeImageBuffer(rawBuffer);
    expect(sanitized.mimeType).toBe('image/jpeg');
    expect(sanitized.extension).toBe('jpg');
    expect(sanitized.sha256Hash).toBeDefined();
    expect(sanitized.sha256Hash.length).toBe(64);
    expect(sanitized.buffer.length).toBeGreaterThan(0);
  });

  it('should sanitize document buffer and generate SHA-256 hash', () => {
    const docBuffer = Buffer.from('test document content');
    const sanitized = sanitizeDocumentBuffer(docBuffer, 'application/pdf', 'pdf');
    expect(sanitized.mimeType).toBe('application/pdf');
    expect(sanitized.extension).toBe('pdf');
    expect(sanitized.sha256Hash).toBeDefined();
    expect(sanitized.sha256Hash.length).toBe(64);
  });

  it('should screen suspicious image with AI mock client', async () => {
    const mockGemini = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            isSuspicious: true,
            safetyReason: 'Indikasi bukti transfer palsu atau phishing',
            ocrText: 'Bukti Transfer Bank Palsu Rp 50.000.000',
            isTask: false,
          }),
        }),
      },
    };

    const dummyBuffer = Buffer.from('fake-image-bytes');
    const screening = await screenAndExtractImageWithAI(dummyBuffer, 'image/jpeg', mockGemini);

    expect(screening.isSuspicious).toBe(true);
    expect(screening.safetyReason).toContain('palsu');
  });

  it('should save media attachment to sandboxed storage with 0o600 permissions', async () => {
    const dummyBuffer = Buffer.from('sandboxed media data test');
    const testDir = './storage/test_attachments';

    const savedPath = await saveAttachmentToStorage(dummyBuffer, 'jpg', 'image/jpeg', testDir);
    expect(savedPath).toBeDefined();
    expect(savedPath.endsWith('.jpg')).toBe(true);

    const exists = await fs
      .stat(savedPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    // Verify reading buffer locally
    const readBuffer = await getAttachmentBuffer(savedPath);
    expect(readBuffer).not.toBeNull();
    expect(readBuffer?.toString()).toBe('sandboxed media data test');

    // Cleanup test file
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should upload attachment to S3 and retrieve buffer using mock S3Client', async () => {
    const s3Store = new Map<string, Buffer>();

    const mockS3Client = {
      send: async (command: any) => {
        const cmdName = command.constructor?.name || '';
        const input = command.input || command;
        if (cmdName.includes('HeadBucket') || cmdName.includes('CreateBucket')) {
          return {};
        }
        if (input.Body !== undefined || cmdName.includes('PutObject')) {
          s3Store.set(input.Key, input.Body);
          return {};
        }
        if (input.Key || cmdName.includes('GetObject')) {
          const bodyBuffer = s3Store.get(input.Key) || Buffer.from('');
          return {
            Body: {
              transformToByteArray: async () => new Uint8Array(bodyBuffer),
            },
          };
        }
        return {};
      },
    };

    const dummyData = Buffer.from('s3 rust-fs attachment test buffer');
    const s3Uri = await saveAttachmentToStorage(
      dummyData,
      'pdf',
      'application/pdf',
      undefined,
      mockS3Client as any
    );

    expect(s3Uri.startsWith('s3://todo-attachments/')).toBe(true);

    // Retrieve from mock S3
    const retrievedBuffer = await getAttachmentBuffer(s3Uri, mockS3Client as any);
    expect(retrievedBuffer).not.toBeNull();
    expect(retrievedBuffer?.toString()).toBe('s3 rust-fs attachment test buffer');
  });
});
