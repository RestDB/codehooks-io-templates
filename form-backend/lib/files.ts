import { filestore } from 'codehooks-js';
import { PassThrough } from 'stream';
import { randomUUID } from 'crypto';
import type { MultipartFile } from '#lib/multipart';

export type StoredFile = {
  id: string;
  field: string;
  filename: string;
  contentType: string;
  size: number;
  path: string;
};

// Uploads are attacker-supplied, so filenames are never used as storage paths.
function safeName(name: string): string {
  return String(name || 'file').toLowerCase().replace(/[^a-z0-9.-]/g, '-').slice(0, 80);
}

export async function saveUploads(
  formId: string,
  submissionId: string,
  files: MultipartFile[],
  maxBytes: number
): Promise<StoredFile[]> {
  const stored: StoredFile[] = [];
  for (const f of files) {
    if (f.content.length === 0) continue;
    if (f.content.length > maxBytes) {
      throw new Error(`File ${f.filename} exceeds the upload limit`);
    }
    const id = randomUUID();
    const path = `/uploads/${formId}/${submissionId}/${id}-${safeName(f.filename)}`;
    const stream = new PassThrough();
    stream.end(f.content);
    await filestore.saveFile(path, stream);
    stored.push({
      id,
      field: f.field,
      filename: f.filename,
      contentType: f.contentType,
      size: f.content.length,
      path,
    });
  }
  return stored;
}
