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

function flattenFields(raw: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) fields[k] = flattenValue(v);
  return fields;
}

export async function parseBody(req: any, maxBytes: number): Promise<ParsedBody> {
  const contentType = String(req.headers?.['content-type'] || '');

  // Codehooks does not parse multipart — stream the raw bytes and parse them ourselves.
  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    const boundary = boundaryFromContentType(contentType);
    // Returning an empty body here would store a blank submission and report
    // success — silent data loss. Signal the failure so the caller can 400.
    if (!boundary) throw new Error('MALFORMED_BODY');
    const raw = await readRequestBody(req, maxBytes);
    const parsed = parseMultipart(raw, boundary);
    // Multipart fields go through the SAME flattenValue as every other content
    // type, so a repeated name produces one joined string either way.
    return { fields: flattenFields(parsed.fields), files: parsed.files };
  }

  // JSON and urlencoded arrive pre-parsed on req.body.
  const body = req.body;
  if (body && typeof body === 'object') {
    return { fields: flattenFields(body as Record<string, unknown>), files: [] };
  }
  return { fields: {}, files: [] };
}
