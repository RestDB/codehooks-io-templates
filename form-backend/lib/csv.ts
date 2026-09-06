// A leading =, +, - or @ makes spreadsheet software treat a cell as a formula.
// Submissions are untrusted, so prefix those with an apostrophe.
//
// Two subtleties:
//  - Leading whitespace does NOT protect: Excel still parses "\t=1+1" as a formula,
//    so test the first NON-whitespace character (a known CSV-injection bypass).
//  - Genuine numbers are exempt. "-5" starts with '-' but is data, and prefixing it
//    would import a legitimate negative number as text.
function neutralise(value: string): string {
  const trimmed = value.trimStart();
  if (!/^[=+\-@]/.test(trimmed)) return value;
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return value;
  return `'${value}`;
}

function escapeCell(value: unknown): string {
  const s = neutralise(value === null || value === undefined ? '' : String(value));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function collectColumns(rows: Array<{ data: Record<string, string> }>): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row.data || {})) {
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const lines = [columns.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(row[c])).join(','));
  }
  return lines.join('\r\n');
}
