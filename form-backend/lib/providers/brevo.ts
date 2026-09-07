import type { EmailMessage, EmailProvider, SendResult } from '#lib/providers/types';

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export function makeBrevo(apiKey: string, fetchImpl: any = fetch): EmailProvider {
  return {
    async send(msg: EmailMessage): Promise<SendResult> {
      const body: any = {
        sender: { email: msg.fromEmail, name: msg.fromName },
        to: [{ email: msg.to }],
        subject: msg.subject,
        textContent: msg.text,
      };
      if (msg.replyTo) body.replyTo = { email: msg.replyTo };
      if (msg.attachments && msg.attachments.length) {
        body.attachment = msg.attachments.map((a) => ({
          name: a.filename,
          content: a.content.toString('base64'),
        }));
      }

      try {
        const res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
        });
        const payload: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            ok: false,
            statusCode: res.status,
            retryAfter: Number(res.headers?.get?.('retry-after')) || undefined,
            error: payload?.message || `Brevo responded ${res.status}`,
          };
        }
        return { ok: true, providerId: payload?.messageId ?? null, statusCode: res.status };
      } catch (err: any) {
        // Network-level failure — retryable.
        return { ok: false, error: err.message };
      }
    },
  };
}
