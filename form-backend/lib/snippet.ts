import type { FormDoc } from '#lib/forms';

// Field names come from an admin-set schema, but they land inside HTML attributes
// in markup a customer pastes into their own site. Escape them.
function attr(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const INPUT_TYPE: Record<string, string> = {
  email: 'email',
  url: 'url',
  number: 'number',
  date: 'date',
  rating: 'number',
  phone: 'tel',
  file: 'file',
  text: 'text',
};

function renderField(def: any): string {
  const name = attr(def.name);
  const required = def.required ? ' required' : '';

  if (def.type === 'textarea') {
    return `  <label>${name}<br><textarea name="${name}"${required}></textarea></label>`;
  }
  if (def.type === 'select') {
    const opts = (def.options || [])
      .map((o: string) => `      <option value="${attr(o)}">${attr(o)}</option>`)
      .join('\n');
    return `  <label>${name}<br>\n    <select name="${name}"${required}>\n${opts}\n    </select>\n  </label>`;
  }
  const type = INPUT_TYPE[def.type] || 'text';
  return `  <label>${name}<br><input type="${type}" name="${name}"${required}></label>`;
}

/**
 * Ready-to-paste HTML for this form. Reflects the declared schema; falls back to a
 * sensible starter form when no schema is set (which is the default, since a
 * schema-less form accepts anything).
 */
export function buildSnippet(form: FormDoc, baseUrl: string): string {
  const action = `${String(baseUrl).replace(/\/+$/, '')}/f/${attr(form.uuid)}`;
  const honeypot = attr(form.honeypot || '_gotcha');

  const defs = (form.fields || []) as any[];
  const body = defs.length
    ? defs.map(renderField).join('\n\n')
    : [
        '  <label>name<br><input type="text" name="name" required></label>',
        '',
        '  <label>email<br><input type="email" name="email" required></label>',
        '',
        '  <label>message<br><textarea name="message"></textarea></label>',
      ].join('\n');

  return [
    `<form action="${action}" method="POST" enctype="multipart/form-data">`,
    body,
    '',
    '  <!-- Bots fill this in; people never see it. Leave it in. -->',
    `  <input name="${honeypot}" style="display:none" tabindex="-1" autocomplete="off" aria-hidden="true">`,
    '',
    '  <button type="submit">Send</button>',
    '</form>',
  ].join('\n');
}
