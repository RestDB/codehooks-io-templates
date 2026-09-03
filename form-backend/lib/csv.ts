// A leading =, +, - or @ makes spreadsheet software treat a cell as a formula.
// Submissions are untrusted, so prefix those with an apostrophe.
function neutralise(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
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
