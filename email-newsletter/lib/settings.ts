import { Datastore } from 'codehooks-js';

/**
 * Branding / configuration for the whole app.
 *
 * Everything in here is NON-SECRET and is safe to edit at runtime through the
 * admin Settings UI. Secrets (Mailgun key, JWT secret, admin password) live in
 * environment variables instead — see .env.example.
 *
 * Stored as a single JSON blob in the key/value store under SETTINGS_KEY, so
 * one read returns the whole object and one write replaces it (it's a singleton,
 * not a collection of many documents).
 */
export interface AppSettings {
  // Identity
  appName: string;          // shown in admin UI, emails, and pages
  logoUrl: string | null;   // public image URL (uploaded via Images), or null for no logo
  primaryColor: string;     // hex — buttons, links, accents
  textColor: string;        // hex — headings / strong text

  // Email layout — where the logo/app-name sits in emails. Footer always shows.
  emailBrand: 'top' | 'bottom' | 'none';

  // Sender — fall back to env vars (FROM_EMAIL / FROM_NAME) when blank
  fromEmail: string;
  fromName: string;
  maxPerHour: number;       // proactive cap on emails/hour — paces under provider new-sender limits; 0 = unlimited
  sendingPaused: boolean;   // UI kill-switch to halt all campaign sending (env SENDING_PAUSED also halts)

  // Links
  baseUrl: string;          // absolute base for confirm/unsubscribe links in emails (env BASE_URL fallback)
  websiteUrl: string;       // "back to website" link on public pages

  // Email footer — each line renders only when non-empty
  footerCompanyName: string;  // e.g. "restdb.io"
  footerAddress: string;      // physical mailing address (CAN-SPAM); newlines allowed
  footerText: string;         // free-text line(s) / tagline
}

export const DEFAULT_SETTINGS: AppSettings = {
  appName: 'Codehooks Email',
  logoUrl: null,
  primaryColor: '#4F46E5',
  textColor: '#1F2937',
  emailBrand: 'top',
  fromEmail: '',
  fromName: '',
  maxPerHour: 75,
  sendingPaused: false,
  baseUrl: '',
  websiteUrl: 'https://codehooks.io',
  footerCompanyName: '',
  footerAddress: '',
  footerText: '',
};

const SETTINGS_KEY = 'app_settings';
const KEYSPACE = 'settings';

function parseStored(stored: unknown): Partial<AppSettings> {
  if (!stored) return {};
  if (typeof stored === 'object') return stored as Partial<AppSettings>;
  try {
    return JSON.parse(String(stored));
  } catch {
    return {};
  }
}

/**
 * Read current settings, merged over defaults. Sender + baseUrl fall back to
 * environment variables when not set in the DB, so the template works with a
 * pure env-var setup before anyone opens the Settings UI.
 */
export async function getSettings(): Promise<AppSettings> {
  const conn = await Datastore.open();
  let stored: unknown = null;
  try {
    stored = await conn.get(SETTINGS_KEY, { keyspace: KEYSPACE });
  } catch {
    // key not set yet — fall through to defaults
  }

  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...parseStored(stored) };

  merged.fromEmail = merged.fromEmail || process.env.FROM_EMAIL || '';
  merged.fromName = merged.fromName || process.env.FROM_NAME || merged.appName;
  merged.baseUrl = merged.baseUrl || process.env.BASE_URL || '';

  // The operator env kill-switch forces sending paused, regardless of the stored setting.
  if (process.env.SENDING_PAUSED === 'true') merged.sendingPaused = true;

  return merged;
}

/**
 * Merge a partial update into the stored settings and persist. Returns the new
 * full settings object (defaults applied, but WITHOUT env-var fallbacks so the
 * stored blob stays a faithful record of what the user actually set).
 */
export async function updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const conn = await Datastore.open();
  let stored: unknown = null;
  try {
    stored = await conn.get(SETTINGS_KEY, { keyspace: KEYSPACE });
  } catch {
    // no existing value
  }

  const next: AppSettings = { ...DEFAULT_SETTINGS, ...parseStored(stored), ...partial };
  await conn.set(SETTINGS_KEY, JSON.stringify(next), { keyspace: KEYSPACE });
  return next;
}
