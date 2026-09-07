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

// `created` and `status` are admin-owned export columns (the real submission
// timestamp and triage status), not submitted data. A submission can carry a
// field literally named "status" or "created" — any input's `name` attribute
// is submitter-controlled. Overwriting the real admin column with that value
// would be worse (index.ts spreads admin fields last so that can't happen at
// the value level either), but silently EXCLUDING the submitted field is
// still data loss — a customer's own "status" field would vanish from every
// export with no column carrying it and no sign it ever existed. Instead,
// give the colliding data field its own header that can't collide with the
// two admin columns, so both values survive.
const RESERVED_COLUMNS = new Set(['created', 'status']);

function candidateHeader(key: string): string {
  return RESERVED_COLUMNS.has(key) ? `${key} (submitted)` : key;
}

// The single place a submitted data key is mapped to its export column
// header — collectColumns() (the header row) and index.ts's export route
// (each value row) both need the EXACT same decision for a given key, so it
// is made once, here, and shared rather than recomputed independently in two
// places that could drift apart.
//
// First-seen order across all rows, exactly as before renaming existed.
// `used` seeds with the two admin headers (always present, per index.ts's
// `columns = ['created', 'status', ...dataColumns]`) so a colliding key is
// renamed on first sight; if the renamed header is ITSELF already taken —
// e.g. a submission has both a `status` field and a field literally named
// "status (submitted)" — keep suffixing with a counter until the header is
// unique. The export must never let two different values share one header.
export function mapDataColumns(rows: Array<{ data: Record<string, unknown> }>): Map<string, string> {
  const headerForKey = new Map<string, string>();
  const used = new Set<string>(RESERVED_COLUMNS);
  for (const row of rows) {
    for (const key of Object.keys(row.data || {})) {
      if (headerForKey.has(key)) continue;
      let header = candidateHeader(key);
      let n = 2;
      while (used.has(header)) {
        header = `${candidateHeader(key)} (${n})`;
        n++;
      }
      used.add(header);
      headerForKey.set(key, header);
    }
  }
  return headerForKey;
}

export function collectColumns(rows: Array<{ data: Record<string, unknown> }>): string[] {
  return Array.from(mapDataColumns(rows).values());
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const lines = [columns.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(row[c])).join(','));
  }
  return lines.join('\r\n');
}
