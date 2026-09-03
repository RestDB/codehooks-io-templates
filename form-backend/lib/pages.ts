// The two HTML pages the public endpoint serves. They live here rather than in
// index.ts (route registration only) so both the thank-you and the failure page
// share one shell — a browser form post must never land on raw JSON.

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title: string, heading: string, bodyHtml: string): string {
  return (
    `<!doctype html><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>` +
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:32rem;` +
    `margin:20vh auto;padding:0 1rem;text-align:center;line-height:1.5">` +
    `<h1 style="font-size:1.5rem;margin:0 0 .5rem">${escapeHtml(heading)}</h1>` +
    bodyHtml +
    `</div>`
  );
}

export function thanksPage(formName: string): string {
  return page(
    'Thank you',
    'Thank you',
    `<p>Your submission to ${escapeHtml(formName)} was received.</p>`
  );
}

export type PageError = { field: string; message: string };

// Shown instead of a JSON body whenever a browser (non-JSON) post is rejected,
// so a mistyped email does not land the visitor on a white page of JSON.
export function errorPage(message: string, errors: PageError[] = []): string {
  const list = errors.length
    ? `<ul style="text-align:left;display:inline-block;margin:0 0 1rem;padding-left:1.25rem">` +
      errors
        .map((e) => `<li>${escapeHtml(e.field)}: ${escapeHtml(e.message)}</li>`)
        .join('') +
      `</ul>`
    : '';
  return page(
    'Submission not accepted',
    'Submission not accepted',
    `<p>${escapeHtml(message)}</p>${list}` +
      `<p><a href="#" onclick="history.back();return false" ` +
      `style="color:#2563eb">Go back and try again</a></p>`
  );
}
