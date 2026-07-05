import type { AppSettings } from './settings';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// These pages are public — validate settings used in CSS/JS/attribute contexts so a
// malicious stored value can't inject script (esp. the color values in the <script> block).
function safeColor(c: unknown, fallback: string): string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{1,20}$/.test(c) ? c : fallback;
}
function safeUrl(u: unknown): string {
  if (typeof u !== 'string' || (!/^https?:\/\//i.test(u) && !u.startsWith('/'))) return '';
  return u.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');
}

function websiteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'website';
  }
}

function pageShell(title: string, content: string, settings: AppSettings): string {
  const logoUrl = safeUrl(settings.logoUrl);
  const logo = logoUrl
    ? `<img src="${logoUrl}" alt="${escapeHtml(settings.appName)}" class="h-10 mx-auto mb-6" />`
    : `<div class="text-2xl font-bold text-ink mb-6">${escapeHtml(settings.appName)}</div>`;
  const favicon = logoUrl
    ? `<link rel="icon" href="${logoUrl}" />`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — ${escapeHtml(settings.appName)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: { extend: { colors: {
        primary: '${safeColor(settings.primaryColor, '#4F46E5')}',
        ink: '${safeColor(settings.textColor, '#1F2937')}',
      } } }
    }
  </script>
  ${favicon}
  <style>body { font-family: 'Helvetica Neue', Arial, sans-serif; }</style>
</head>
<body class="bg-zinc-50 min-h-screen flex items-center justify-center p-4">
  <div class="bg-white rounded-2xl shadow-sm border border-zinc-200 max-w-md w-full p-8 text-center">
    ${logo}
    ${content}
  </div>
</body>
</html>`;
}

function backLink(settings: AppSettings): string {
  if (!settings.websiteUrl) return '';
  const url = safeUrl(settings.websiteUrl);
  if (!url) return '';
  return `<a href="${url}" class="text-primary font-medium hover:underline">← Back to ${escapeHtml(websiteLabel(settings.websiteUrl))}</a>`;
}

export function confirmedPage(settings: AppSettings): string {
  return pageShell("You're subscribed", `
    <div class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6" style="background:${safeColor(settings.primaryColor, '#4F46E5')}1a;">
      <svg class="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
      </svg>
    </div>
    <h1 class="text-2xl font-bold text-ink mb-2">You're subscribed!</h1>
    <p class="text-gray-500 mb-6">Your email has been confirmed. Thanks for joining ${escapeHtml(settings.appName)}.</p>
    ${backLink(settings)}
  `, settings);
}

export function unsubscribedPage(settings: AppSettings): string {
  return pageShell('Unsubscribed', `
    <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
      <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
      </svg>
    </div>
    <h1 class="text-2xl font-bold text-ink mb-2">Unsubscribed</h1>
    <p class="text-gray-500 mb-6">You've been removed from the list. Sorry to see you go!</p>
    ${backLink(settings)}
  `, settings);
}

export function errorPage(message: string, settings: AppSettings): string {
  return pageShell('Error', `
    <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
      <svg class="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </div>
    <h1 class="text-2xl font-bold text-ink mb-2">Something went wrong</h1>
    <p class="text-gray-500 mb-6">${escapeHtml(message)}</p>
    ${backLink(settings)}
  `, settings);
}
