import {
  boundaryFromContentType,
  parseMultipart,
  readRequestBody,
} from '#lib/multipart';
import type { MultipartFile } from '#lib/multipart';

export type ParsedBody = {
  fields: Record<string, string>;
  files: MultipartFile[];
};

// Submissions are a flat string map: the inbox, CSV export, and notification
// templates all render values directly, so nested structures are collapsed here.
export function flattenValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(flattenValue).join(', ');
  return JSON.stringify(v);
}

export async function parseBody(req: any, maxBytes: number): Promise<ParsedBody> {
  const contentType = String(req.headers?.['content-type'] || '');

  // Codehooks does not parse multipart — stream the raw bytes and parse them ourselves.
  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    const boundary = boundaryFromContentType(contentType);
    if (!boundary) return { fields: {}, files: [] };
    const raw = await readRequestBody(req, maxBytes);
    return parseMultipart(raw, boundary);
  }

  // JSON and urlencoded arrive pre-parsed on req.body.
  const fields: Record<string, string> = {};
  const body = req.body;
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) {
      fields[k] = flattenValue(v);
    }
  }
  return { fields, files: [] };
}
