// A pluggable email provider. Add one by implementing EmailProvider and
// registering it in ./index.ts. Nothing outside this directory knows which
// provider is active.

export type Attachment = {
  filename: string;
  contentType: string;
  content: Buffer;
};

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  attachments?: Attachment[];
};

export type SendResult = {
  ok: boolean;
  providerId?: string | null;
  statusCode?: number;   // drives the worker's retry logic
  retryAfter?: number;   // seconds, from a Retry-After header when present
  error?: string;
};

export interface EmailProvider {
  send(msg: EmailMessage): Promise<SendResult>;
}
