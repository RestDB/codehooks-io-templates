import { Datastore } from 'codehooks-js';
import { randomUUID } from 'crypto';
import type { FieldDef } from '#lib/validation';

export type FormDoc = {
  _id?: string;
  uuid: string;
  name: string;
  enabled: boolean;
  fields: FieldDef[];
  strict: boolean;
  redirectUrl: string;
  allowRedirectOverride: boolean;
  allowedDomains: string[];
  honeypot: string;
  retentionDays: number;
  created: string;
  updated: string;
  stats: { total: number; spam: number; lastSubmissionAt: string | null };
};

export function defaultForm(name: string): FormDoc {
  const now = new Date().toISOString();
  return {
    uuid: randomUUID(),
    name: String(name || 'Untitled').trim().slice(0, 100) || 'Untitled',
    enabled: true,
    fields: [],
    strict: false,
    redirectUrl: '',
    allowRedirectOverride: false,
    allowedDomains: [],
    honeypot: '_gotcha',
    retentionDays: 0,
    created: now,
    updated: now,
    stats: { total: 0, spam: 0, lastSubmissionAt: null },
  };
}

export async function getFormByUuid(uuid: string): Promise<FormDoc | null> {
  const conn = await Datastore.open();
  const rows = await conn.getMany('forms', { uuid }).toArray();
  return rows.length ? (rows[0] as FormDoc) : null;
}

// `/admin/api/forms/:id` addresses a form by its Mongo _id while
// `/:formId/submissions` addresses it by uuid. Passing the wrong one was not an
// error — it returned an empty inbox for a form with a thousand submissions —
// so the inbox routes accept EITHER identifier through this one lookup.
export async function resolveForm(idOrUuid: string): Promise<FormDoc | null> {
  if (!idOrUuid) return null;
  const byUuid = await getFormByUuid(idOrUuid);
  if (byUuid) return byUuid;
  try {
    const conn = await Datastore.open();
    const byId = await conn.findOneOrNull('forms', idOrUuid);
    return (byId as FormDoc) || null;
  } catch {
    // A malformed _id makes the driver throw rather than return null.
    return null;
  }
}
