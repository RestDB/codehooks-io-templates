// A pluggable email-sending provider. Add a new provider by implementing this
// interface and registering it in ./index.ts. The rest of the app only talks to
// the unified sendEmail() — it never knows which provider is active.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  fromEmail: string;
  fromName: string;
  unsubscribeUrl?: string;
}

export interface SendResult {
  ok: boolean;
  providerId?: string | null;   // provider's message id (Mailgun id / SendGrid X-Message-Id / SES MessageId)
  statusCode?: number;          // HTTP status — drives the worker's retry / rate-limit logic
  retryAfter?: number;          // seconds, from a Retry-After header when present (cooldown breaker)
  error?: string;
}

export interface EmailProvider {
  send(msg: EmailMessage): Promise<SendResult>;
}
