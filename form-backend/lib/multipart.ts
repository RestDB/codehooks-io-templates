export type MultipartFile = {
  field: string;
  filename: string;
  contentType: string;
  content: Buffer;
};

export type MultipartResult = {
  fields: Record<string, string>;
  files: MultipartFile[];
};

export function boundaryFromContentType(contentType: string): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const b = (m[1] || m[2] || '').trim();
  return b || null;
}

export function parseMultipart(buf: Buffer, boundary: string): MultipartResult {
  const result: MultipartResult = { fields: {}, files: [] };
  const delim = Buffer.from('--' + boundary);

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
    let next = buf.indexOf(delim, bodyStart);
    if (next < 0) next = buf.length;

    // -2 strips the CRLF that precedes the next boundary
    const content = buf.slice(bodyStart, Math.max(bodyStart, next - 2));

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
        result.fields[field] = content.toString('utf8');
      }
      // filename="" is an empty file input — ignore it entirely
    }

    start = next + delim.length;
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
