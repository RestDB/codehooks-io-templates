// One place that decides what a notification recipient is.
//
// Before this existed, an address was first inspected at DELIVERY time, by a
// `r.includes('@')` filter inside the email channel, which dropped anything else
// silently and wrote no delivery row. An owner who typed `team.customer.example`
// saved happily, submitted a test, got no email, and opened the "Recent delivery
// attempts" panel built for exactly that question — to find it empty, which is
// indistinguishable from "notifications are off".
//
// So the same rule now runs twice, deliberately: at PATCH time, where the
// customer can still fix it, and at delivery time, where anything that got in by
// another route (an older row, a direct datastore write) leaves a terminal
// delivery row saying why.

/**
 * Deliberately the same shape as `lib/notify.ts`'s reply-to test: no whitespace,
 * one `@`, a dot in the domain. It rejects `Name <a@b.com>` — that form passes a
 * bare `includes('@')` but is not what the providers accept as a `to` value.
 */
export const RECIPIENT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RejectedRecipient = { target: string; reason: string };

export type RecipientPartition = {
  valid: string[];
  rejected: RejectedRecipient[];
};

/** Render an unusable entry for an error message without echoing an unbounded blob back. */
function describe(entry: unknown): string {
  if (typeof entry === 'string') return entry.trim().slice(0, 120);
  return `${typeof entry} value`;
}

/**
 * Split configured recipients into the ones that can be sent to and the ones that
 * cannot, with a reason for each rejection. Pure, so both call sites — the PATCH
 * validator and the delivery channel — share one verdict and one test.
 */
export function partitionRecipients(input: unknown): RecipientPartition {
  const valid: string[] = [];
  const rejected: RejectedRecipient[] = [];
  const list = Array.isArray(input) ? input : [];

  for (const entry of list) {
    if (typeof entry !== 'string') {
      rejected.push({ target: describe(entry), reason: 'Recipient is not a text value' });
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) continue; // A blank entry is nothing to report, just nothing to send to.
    if (!RECIPIENT_RE.test(trimmed)) {
      rejected.push({
        target: trimmed,
        reason: `Not a valid email address: ${trimmed}`,
      });
      continue;
    }
    if (valid.includes(trimmed)) continue; // The same address twice is one email, not two.
    valid.push(trimmed);
  }

  return { valid, rejected };
}

export type RecipientCheck = {
  ok: boolean;
  /** Set when ok is false. Names the offending address so the customer can fix it. */
  error?: string;
  /** Set when ok is true: the trimmed, de-duplicated addresses to store. */
  recipients?: string[];
};

/**
 * Validate what a PATCH wants to store. Rejects the whole update rather than
 * quietly dropping the bad entry: a half-saved recipient list is the failure this
 * exists to prevent.
 */
export function checkRecipients(input: unknown): RecipientCheck {
  if (input === undefined || input === null) return { ok: true, recipients: [] };
  if (!Array.isArray(input)) {
    return { ok: false, error: 'notify.email.recipients must be a list of email addresses' };
  }
  const { valid, rejected } = partitionRecipients(input);
  if (rejected.length) {
    return {
      ok: false,
      error: `Invalid recipient${rejected.length > 1 ? 's' : ''}: ${rejected
        .map((r) => r.target)
        .join(', ')}`,
    };
  }
  return { ok: true, recipients: valid };
}
