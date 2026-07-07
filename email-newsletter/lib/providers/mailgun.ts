import type { EmailProvider, EmailMessage, SendResult } from './types';

// Mailgun (https://documentation.mailgun.com) — form-encoded REST API, Basic auth.
// Env: MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_EU ("true" for the EU region).
export const mailgunProvider: EmailProvider = {
  async send({ to, subject, html, text, unsubscribeUrl, fromEmail, fromName }: EmailMessage): Promise<SendResult> {
    const apiKey = process.env.MAILGUN_API_KEY;
    const domain = process.env.MAILGUN_DOMAIN;
    const isEU = process.env.MAILGUN_EU === 'true';
    const from = fromEmail || process.env.FROM_EMAIL;
    const name = fromName || process.env.FROM_NAME || 'Newsletter';

    const apiBase = isEU ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
    const url = `${apiBase}/v3/${domain}/messages`;

    const form = new URLSearchParams();
    const displayName = String(name).replace(/[\\"]/g, '\\$&'); // RFC 5322: quote display name
    form.append('from', `"${displayName}" <${from}>`);
    form.append('to', to);
    form.append('subject', subject);
    // Send whichever parts are present. A text-only campaign has no html, so Mailgun
    // delivers a genuine text/plain message (reads like a personal note, not a template).
    if (html) form.append('html', html);
    if (text) form.append('text', text);
    if (unsubscribeUrl) {
      form.append('h:List-Unsubscribe', `<${unsubscribeUrl}>`);
      form.append('h:List-Unsubscribe-Post', 'List-Unsubscribe=One-Click');
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${btoa(`api:${apiKey}`)}` },
        body: form,
      });
      const responseText = await response.text();
      if (response.ok) {
        let providerId: string | null = null;
        try { providerId = JSON.parse(responseText).id; } catch {}
        return { ok: true, providerId, statusCode: response.status };
      }
      const ra = parseInt(response.headers.get('retry-after') || '', 10);
      console.error(`Mailgun error (${response.status}):`, responseText);
      return { ok: false, error: responseText, statusCode: response.status, retryAfter: Number.isFinite(ra) ? ra : undefined };
    } catch (err: any) {
      console.error('Mailgun request failed:', err.message);
      return { ok: false, error: err.message };
    }
  },
};
