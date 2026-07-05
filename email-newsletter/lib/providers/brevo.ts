import type { EmailProvider, EmailMessage, SendResult } from './types';

// Brevo (https://developers.brevo.com) — JSON transactional send API, api-key header.
// Env: BREVO_API_KEY. Success is HTTP 201 with { messageId }.
// Note: free/low tiers cap sends PER DAY (e.g. 300/day) — large lists pace over
// multiple days under the hourly cap. Prices by emails sent, not by contact count.
export const brevoProvider: EmailProvider = {
  async send({ to, subject, html, unsubscribeUrl, fromEmail, fromName }: EmailMessage): Promise<SendResult> {
    const apiKey = process.env.BREVO_API_KEY;
    const from = fromEmail || process.env.FROM_EMAIL;
    const name = fromName || process.env.FROM_NAME || 'Newsletter';

    const body: any = {
      sender: { email: from, name },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    };
    if (unsubscribeUrl) {
      body.headers = {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };
    }

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey || '', 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseText = await response.text();
      if (response.ok) {
        let providerId: string | null = null;
        try { providerId = JSON.parse(responseText).messageId; } catch {}
        return { ok: true, providerId, statusCode: response.status };
      }
      const ra = parseInt(response.headers.get('retry-after') || '', 10);
      console.error(`Brevo error (${response.status}):`, responseText);
      return { ok: false, error: responseText, statusCode: response.status, retryAfter: Number.isFinite(ra) ? ra : undefined };
    } catch (err: any) {
      console.error('Brevo request failed:', err.message);
      return { ok: false, error: err.message };
    }
  },
};
