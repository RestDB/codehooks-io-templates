export type MultipartFile = {
  field: string;
  filename: string;
  contentType: string;
  content: Buffer;
};

// A repeated field name (checkbox group, multi-select) keeps every value, so the
// multipart path produces the same shape the platform gives us for urlencoded
// bodies. body.ts collapses both through the one flattenValue().
export type MultipartResult = {
  fields: Record<string, string | string[]>;
  files: MultipartFile[];
};

export function boundaryFromContentType(contentType: string): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const b = (m[1] || m[2] || '').trim();
  return b || null;
}

export function parseMultipart(buf: Buffer, boundary: string): MultipartResult {
  // Object.create(null): a field literally named `constructor`, `toString` or any other
  // Object.prototype member would otherwise read the inherited value here, take the
  // repeated-name branch below, and store a corrupted value while still reporting success.
  const result: MultipartResult = { fields: Object.create(null), files: [] };
  const delim = Buffer.from('--' + boundary);
  const delimWithCRLF = Buffer.from('\r\n--' + boundary);

  // Find the first boundary (no preceding CRLF, appears at offset 0)
  let start = buf.indexOf(delim);
  if (start < 0) return result;
  start += delim.length;

  while (start < buf.length) {
    // "--" immediately after a boundary marks the closing delimiter
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
    start += 2; // skip the CRLF that follows the boundary

    const headerEnd = buf.indexOf('\r\n\r\n', start);
    if (headerEnd < 0) break;
    const headers = buf.slice(start, headerEnd).toString('utf8');

    const bodyStart = headerEnd + 4;
    // Search for subsequent boundaries with CRLF prefix (RFC 2046 compliance).
    // Binary content cannot contain \r\n--boundary without these being actual delimiters.
    let next = buf.indexOf(delimWithCRLF, bodyStart);

    let endPos: number;
    if (next < 0) {
      // No boundary found; must be the last part.
      // Content goes to end of buffer, minus any trailing CRLF before closing delimiter.
      endPos = buf.length;
      if (endPos >= 2 && buf[endPos - 2] === 0x0d && buf[endPos - 1] === 0x0a) {
        endPos -= 2;
      }
    } else {
      // Boundary found at position next (which points to \r in \r\n--boundary).
      // Content ends before the CRLF.
      endPos = next;
    }

    const content = buf.slice(bodyStart, Math.max(bodyStart, endPos));

    const nameMatch = /name="([^"]*)"/.exec(headers);
    const fileMatch = /filename="([^"]*)"/.exec(headers);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);

    if (nameMatch) {
      const field = nameMatch[1];
      if (fileMatch && fileMatch[1] !== '') {
        result.files.push({
          field,
          filename: fileMatch[1],
          contentType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
          content,
        });
      } else if (!fileMatch) {
        const value = content.toString('utf8');
        const existing = result.fields[field];
        if (existing === undefined) {
          result.fields[field] = value;
        } else if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          result.fields[field] = [existing, value];
        }
      }
      // filename="" is an empty file input — ignore it entirely
    }

    if (next < 0) break;
    start = next + 2 + delim.length; // Skip \r\n and then --boundary
  }

  return result;
}

// Codehooks does not parse multipart bodies, but req is a readable stream.
// Draining it yields the exact bytes; verified byte-perfect up to 2MB.
export function readRequestBody(req: any, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    req.on('data', (c: any) => {
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
      total += b.length;
      if (total > maxBytes) {
        return settle(() => reject(new Error('PAYLOAD_TOO_LARGE')));
      }
      chunks.push(b);
    });
    req.on('end', () => settle(() => resolve(Buffer.concat(chunks))));
    req.on('error', (e: any) => settle(() => reject(e)));
  });
}
