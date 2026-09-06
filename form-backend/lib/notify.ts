import { signFileToken } from '#lib/signed-links';
import type { AttachmentPlan } from '#lib/attachments';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NotificationInput = {
  formName: string;
  subjectTemplate: string;
  fields: Record<string, string>;
  fieldDefs: Array<{ name: string; type: string }>;
  meta: { created: string; ip: string; referer: string };
  plan: AttachmentPlan;
  submissionId: string;
  baseUrl: string;
};

/**
 * Whose address to reply to. A schema-declared email field wins; otherwise the
 * first value that looks like an address. Deterministic so it can be tested.
 */
export function pickReplyTo(
  fields: Record<string, string>,
  defs: Array<{ name: string; type: string }>
): string | null {
  for (const def of defs || []) {
    if (def.type === 'email') {
      const v = (fields?.[def.name] || '').trim();
      if (EMAIL_RE.test(v)) return v;
    }
  }
  for (const v of Object.values(fields || {})) {
    const s = String(v || '').trim();
    if (EMAIL_RE.test(s)) return s;
  }
  return null;
}

export function renderSubject(
  template: string,
  formName: string,
  fields: Record<string, string>
): string {
  const t = template && template.trim() ? template : 'New submission: {{form}}';
  const rendered = t.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    if (key === 'form') return formName;
    return fields?.[key] ?? '';
  });
  // A subject is a header. Collapse CR/LF and other control characters so a submitted
  // value cannot inject one, regardless of what the provider does downstream.
  return rendered.replace(/[\r\n\t -]+/g, ' ').trim().slice(0, 200);
}

export function buildNotification(input: NotificationInput): {
  subject: string;
  text: string;
  replyTo: string | null;
} {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(input.fields || {})) {
    // Indent continuation lines: untrusted values must never start a line at column 0,
    // where a forged "--- files ---" marker would be indistinguishable from the real one.
    const safe = String(value ?? '').replace(/\r?\n/g, '\n    ');
    lines.push(`${key}: ${safe}`);
  }

  lines.push('');
  lines.push('--- submission ---');
  lines.push(`received: ${input.meta.created}`);
  if (input.meta.ip) lines.push(`ip: ${input.meta.ip}`);
  if (input.meta.referer) lines.push(`referer: ${input.meta.referer}`);

  const all = [...input.plan.attach, ...input.plan.tooLarge];
  if (all.length) {
    lines.push('');
    lines.push('--- files ---');
    for (const file of input.plan.attach) {
      lines.push(`${file.filename} (attached)`);
      lines.push(`  ${input.baseUrl}/files/${signFileToken(input.submissionId, file.id)}`);
    }
    for (const file of input.plan.tooLarge) {
      lines.push(`${file.filename} (too large to attach)`);
      lines.push(`  ${input.baseUrl}/files/${signFileToken(input.submissionId, file.id)}`);
    }
  }

  return {
    subject: renderSubject(input.subjectTemplate, input.formName, input.fields),
    text: lines.join('\n'),
    replyTo: pickReplyTo(input.fields, input.fieldDefs),
  };
}
