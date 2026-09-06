import { makeBrevo } from '#lib/providers/brevo';
import { makeMailgun } from '#lib/providers/mailgun';
import type { EmailMessage, EmailProvider, SendResult } from '#lib/providers/types';

function selected(): EmailProvider {
  const name = (process.env.EMAIL_PROVIDER || 'brevo').toLowerCase();
  if (name === 'mailgun') {
    return makeMailgun(
      process.env.MAILGUN_API_KEY || '',
      process.env.MAILGUN_DOMAIN || '',
      String(process.env.MAILGUN_EU || 'false') === 'true'
    );
  }
  return makeBrevo(process.env.BREVO_API_KEY || '');
}

export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  return selected().send(msg);
}

export type { EmailMessage, EmailProvider, SendResult };
