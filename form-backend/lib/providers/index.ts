import { makeBrevo } from '#lib/providers/brevo';
import { makeMailgun } from '#lib/providers/mailgun';
import type { EmailMessage, EmailProvider, SendResult } from '#lib/providers/types';

function selected(): EmailProvider {
  const name = (process.env.EMAIL_PROVIDER || 'brevo').toLowerCase().trim();

  if (name === 'mailgun') {
    const key = process.env.MAILGUN_API_KEY || '';
    const domain = process.env.MAILGUN_DOMAIN || '';
    if (!key || !domain) {
      throw new Error('EMAIL_PROVIDER=mailgun requires MAILGUN_API_KEY and MAILGUN_DOMAIN');
    }
    return makeMailgun(key, domain, String(process.env.MAILGUN_EU || 'false') === 'true');
  }

  if (name === 'brevo') {
    const key = process.env.BREVO_API_KEY || '';
    if (!key) throw new Error('EMAIL_PROVIDER=brevo requires BREVO_API_KEY');
    return makeBrevo(key);
  }

  // A typo must not silently become a different provider.
  throw new Error(`Unknown EMAIL_PROVIDER "${name}" — expected "brevo" or "mailgun"`);
}

export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  return selected().send(msg);
}

export type { EmailMessage, EmailProvider, SendResult };
