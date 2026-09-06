import type { EmailMessage, EmailProvider, SendResult } from '#lib/providers/types';

export function makeMailgun(
  apiKey: string,
  domain: string,
  eu: boolean,
  fetchImpl: any = fetch
): EmailProvider {
  const host = eu ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
  return {
    async send(msg: EmailMessage): Promise<SendResult> {
      const form = new FormData();
      form.append('from', `${msg.fromName} <${msg.fromEmail}>`);
      form.append('to', msg.to);
      form.append('subject', msg.subject);
      form.append('text', msg.text);
      if (msg.replyTo) form.append('h:Reply-To', msg.replyTo);
      for (const a of msg.attachments || []) {
        form.append('attachment', new Blob([a.content], { type: a.contentType }), a.filename);
      }

      try {
        const res = await fetchImpl(`${host}/v3/${domain}/messages`, {
          method: 'POST',
          headers: { authorization: 'Basic ' + Buffer.from(`api:${apiKey}`).toString('base64') },
          body: form,
        });
        const payload: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            ok: false,
            statusCode: res.status,
            retryAfter: Number(res.headers?.get?.('retry-after')) || undefined,
            error: payload?.message || `Mailgun responded ${res.status}`,
          };
        }
        return { ok: true, providerId: payload?.id ?? null, statusCode: res.status };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    },
  };
}
