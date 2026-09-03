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
