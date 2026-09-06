import { filestore } from 'codehooks-js';
import { planAttachments, MAX_ATTACH_MB_DEFAULT } from '#lib/attachments';
import { buildNotification } from '#lib/notify';
// The `#lib/*` imports map appends `.ts` to the given path with no directory-index
// fallback, so the bare `#lib/providers` does not resolve (confirmed: it looks for
// `lib/providers.ts`, which does not exist) — `#lib/providers/index` is the form
// already used elsewhere in this codebase (see test/providers.test.ts).
import { sendEmail } from '#lib/providers/index';
import type { Channel, DeliveryContext } from '#lib/channels/types';
import type { FormDoc } from '#lib/forms';
import type { SendResult } from '#lib/providers/types';
import type { Attachment } from '#lib/providers/types';

function budgetBytes(): number {
  return (Number(process.env.MAX_ATTACH_MB) || MAX_ATTACH_MB_DEFAULT) * 1024 * 1024;
}

export const emailChannel: Channel = {
  name: 'email',

  targets(form: FormDoc): string[] {
    const cfg: any = (form as any).notify?.email;
    if (!cfg?.enabled) return [];
    return (cfg.recipients || []).filter((r: string) => typeof r === 'string' && r.includes('@'));
  },

  async deliver(ctx: DeliveryContext): Promise<SendResult> {
    const cfg: any = (ctx.form as any).notify?.email || {};
    const files = (ctx.submission.files || []).map((f: any) => ({
      id: f.id, filename: f.filename, contentType: f.contentType, size: f.size, path: f.path,
    }));

    const plan = cfg.attachFiles === false
      ? { attach: [], tooLarge: files }
      : planAttachments(files, budgetBytes());

    const note = buildNotification({
      formName: ctx.form.name,
      subjectTemplate: cfg.subjectTemplate || '',
      fields: ctx.submission.data || {},
      fieldDefs: (ctx.form.fields || []) as any,
      meta: {
        created: ctx.submission.created,
        ip: ctx.submission.meta?.ip || '',
        referer: ctx.submission.meta?.referer || '',
      },
      plan,
      submissionId: ctx.submission._id,
      baseUrl: ctx.baseUrl,
    });

    const attachments: Attachment[] = [];
    for (const file of plan.attach) {
      try {
        const content = await filestore.readFileAsBuffer(file.path);
        attachments.push({ filename: file.filename, contentType: file.contentType, content });
      } catch (err: any) {
        // A missing file must not lose the whole notification — the link is still in
        // the body, so send what we have.
        console.error('Attachment unreadable, sending without it:', file.path, err.message);
      }
    }

    return sendEmail({
      to: ctx.target,
      subject: note.subject,
      text: note.text,
      fromEmail: process.env.FROM_EMAIL || 'forms@example.com',
      fromName: process.env.FROM_NAME || 'Form Backend',
      replyTo: note.replyTo || undefined,
      attachments,
    });
  },
};
