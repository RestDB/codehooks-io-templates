import type { AppSettings } from './settings';

// Neutral email palette — backgrounds/borders stay brand-agnostic; the accent
// (buttons) comes from settings.primaryColor and headings from settings.textColor.
const BG = '#F4F4F5';
const CARD = '#ffffff';
const BORDER = '#E4E4E7';
const BODY_TEXT = '#3F3F46';
const MUTED = '#71717A';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Settings are admin-set but render into mail/pages seen by untrusted recipients,
// so validate the values used in CSS/attribute contexts (defense-in-depth XSS guard).
function safeColor(c: unknown, fallback: string): string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{1,20}$/.test(c) ? c : fallback;
}
function safeUrl(u: unknown): string {
  if (typeof u !== 'string' || (!/^https?:\/\//i.test(u) && !u.startsWith('/'))) return '';
  return u.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');
}

// The brand mark: the uploaded logo, or the app name as text when no logo is set.
function brandElement(settings: AppSettings): string {
  const logo = safeUrl(settings.logoUrl);
  return logo
    ? `<img src="${logo}" alt="${escapeHtml(settings.appName)}" style="height:40px;" />`
    : `<span style="font-size:20px;font-weight:700;color:${safeColor(settings.textColor, BODY_TEXT)};">${escapeHtml(settings.appName)}</span>`;
}

// Normalize emailBrand; anything unexpected falls back to 'top'.
function brandPosition(settings: AppSettings): 'top' | 'bottom' | 'none' {
  return settings.emailBrand === 'bottom' || settings.emailBrand === 'none' ? settings.emailBrand : 'top';
}

function emailHeader(settings: AppSettings): string {
  if (brandPosition(settings) !== 'top') return '';
  return `<tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid ${BORDER};">
    ${brandElement(settings)}
  </td></tr>`;
}

function emailFooter(unsubscribeUrl: string, settings: AppSettings): string {
  const lines: string[] = [];
  if (brandPosition(settings) === 'bottom') {
    lines.push(`<div style="margin:0 0 16px;">${brandElement(settings)}</div>`);
  }
  if (settings.footerText) {
    lines.push(`<p style="color:${MUTED};font-size:12px;line-height:1.5;margin:0 0 8px;">${escapeHtml(settings.footerText).replace(/\n/g, '<br>')}</p>`);
  }
  if (settings.footerCompanyName || settings.footerAddress) {
    // Flatten the address onto one compact line (strip per-line trailing commas, comma-join).
    const addr = (settings.footerAddress || '').split('\n').map((s) => s.replace(/,\s*$/, '').trim()).filter(Boolean).join(', ');
    const parts = [settings.footerCompanyName, addr].filter(Boolean).join(' · ');
    lines.push(`<p style="color:${MUTED};font-size:11px;line-height:1.4;margin:0 0 8px;">${escapeHtml(parts)}</p>`);
  }
  lines.push(`<p style="color:${MUTED};font-size:12px;margin:0;">
    <a href="${unsubscribeUrl}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>
  </p>`);
  return `<tr><td style="background:${BG};padding:20px 40px;text-align:center;border-top:1px solid ${BORDER};">
    ${lines.join('\n    ')}
  </td></tr>`;
}

function emailShell(settings: AppSettings, content: string, unsubscribeUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BG};font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:${CARD};border-radius:12px;overflow:hidden;max-width:600px;width:100%;border:1px solid ${BORDER};">
        ${emailHeader(settings)}
        <tr><td style="padding:40px;">
          ${content}
        </td></tr>
        ${emailFooter(unsubscribeUrl, settings)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

interface ConfirmationEmailParams {
  confirmUrl: string;
  unsubscribeUrl: string;
  listName: string;
  settings: AppSettings;
}

export function confirmationEmail({ confirmUrl, unsubscribeUrl, listName, settings }: ConfirmationEmailParams): { subject: string; html: string } {
  const subject = `Confirm your subscription to ${settings.appName}`;

  const content = `
    <h2 style="color:${safeColor(settings.textColor, BODY_TEXT)};font-size:20px;margin:0 0 16px;font-weight:600;">Hey there!</h2>
    <p style="color:${BODY_TEXT};font-size:16px;line-height:1.6;margin:0 0 24px;">
      Thanks for signing up for the ${escapeHtml(settings.appName)} ${escapeHtml(listName)} list. Please confirm your email to complete your subscription.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
      <tr><td style="background:${safeColor(settings.primaryColor, '#4F46E5')};border-radius:8px;padding:14px 32px;">
        <a href="${confirmUrl}" style="color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;display:inline-block;">
          Confirm your email
        </a>
      </td></tr>
    </table>
    <p style="color:${MUTED};font-size:14px;line-height:1.5;margin:0;">
      If you didn't sign up for ${escapeHtml(settings.appName)}, you can safely ignore this email.
    </p>`;

  return { subject, html: emailShell(settings, content, unsubscribeUrl) };
}

interface NewsletterEmailParams {
  subject: string;
  body: string;
  unsubscribeUrl: string;
  settings: AppSettings;
}

export function newsletterEmail({ body, unsubscribeUrl, settings }: NewsletterEmailParams): string {
  const content = `<div style="color:${BODY_TEXT};font-size:16px;line-height:1.6;">${body.replace(/<img /g, '<img style="max-width:100%;height:auto;border-radius:8px;" ')}</div>`;
  return emailShell(settings, content, unsubscribeUrl);
}

interface NewsletterTextParams {
  body: string;
  unsubscribeUrl: string;
  settings: AppSettings;
}

// Plain-text campaign body. The admin types plain text (no Markdown) and it is sent
// verbatim as text/plain — reads like a personal note. We still append the compliance
// footer: optional footer text, the CAN-SPAM company/mailing address, and a bare
// unsubscribe URL (the one-click List-Unsubscribe header is set separately by the provider).
export function newsletterText({ body, unsubscribeUrl, settings }: NewsletterTextParams): string {
  const footer: string[] = [];
  if (settings.footerText) footer.push(settings.footerText.trim());
  if (settings.footerCompanyName || settings.footerAddress) {
    const addr = (settings.footerAddress || '').split('\n').map((s) => s.replace(/,\s*$/, '').trim()).filter(Boolean).join(', ');
    footer.push([settings.footerCompanyName, addr].filter(Boolean).join(' · '));
  }
  footer.push(`Unsubscribe: ${unsubscribeUrl}`);

  // Normalize the body's line endings, trim trailing whitespace, then a divider + footer.
  const cleanBody = body.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  return `${cleanBody}\n\n—\n${footer.join('\n')}\n`;
}
