import type { EmailMessage, SendResult, EmailProvider } from './types';
import { mailgunProvider } from './mailgun';
import { brevoProvider } from './brevo';

// Registered providers, selected at runtime by the EMAIL_PROVIDER env var.
const providers: Record<string, EmailProvider> = {
  mailgun: mailgunProvider,
  brevo: brevoProvider,
};

export function getProviderName(): string {
  return (process.env.EMAIL_PROVIDER || 'mailgun').toLowerCase();
}

// Unified send — the only thing the rest of the app calls. Defaults to Mailgun
// when EMAIL_PROVIDER is unset or unrecognised (keeps existing deploys working).
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const provider = providers[getProviderName()] || mailgunProvider;
  return provider.send(msg);
}

export type { EmailMessage, SendResult, EmailProvider };
