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

  // Anything that is not an array used to yield {valid: [], rejected: []} — no
  // target, no rejected row, therefore NO DELIVERY ROW AT ALL. That is precisely
  // the silence this module exists to abolish, reachable by any form whose
  // `recipients` is a bare string: saved by curl before the PATCH gate existed, or
  // written straight to the datastore. The panel showed nothing, which is
  // indistinguishable from notifications being switched off.
  //
  // A bare string is the one non-array shape with an obvious, safe intent — one
  // address — so it is COERCED to a single-element list and then judged like any
  // other entry: deliverable if it is an address, a terminal `failed` row naming
  // itself if it is not. PATCH still refuses it (see checkRecipients): strict
  // where the customer can fix it, loud where they no longer can.
  //
  // Every other non-array shape (a number, an object, a boolean) has no such
  // reading, so it becomes a visible rejection rather than silence.
  let list: unknown[];
  if (Array.isArray(input)) {
    list = input;
  } else if (typeof input === 'string') {
    list = [input];
  } else if (input === undefined || input === null) {
    list = []; // Nothing configured is not a misconfiguration.
  } else {
    return {
      valid: [],
      rejected: [{
        target: describe(input),
        reason: 'notify.email.recipients must be a list of email addresses',
      }],
    };
  }

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


export type NotifyPatchCheck = {
  ok: boolean;
  /** Set when ok is false: a message naming what is wrong, for a 400. */
  error?: string;
  /** True when the caller should write `recipients` back onto notify.email. */
  assign: boolean;
  /** Set when assign is true: the trimmed, de-duplicated addresses to store. */
  recipients?: string[];
};

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the `notify` sub-document of a PATCH before anything writes into it.
 *
 * This exists because the caller's normalisation step —
 * `patch.notify.email.recipients = check.recipients` — is an assignment into
 * whatever the client sent. `index.ts` is an ES module and therefore strict mode,
 * so `PATCH {"notify": {"email": "a@b.com"}}` made that line throw
 * `TypeError: Cannot create property 'recipients' on string`, in a handler with no
 * try/catch: the client got a platform error instead of the 400 with a named cause
 * that the validator was added to produce.
 *
 * Pure, so the shape matrix is testable without a datastore or a deploy.
 */
export function checkNotifyPatch(notify: unknown): NotifyPatchCheck {
  if (notify === undefined) return { ok: true, assign: false };

  if (!isPlainObject(notify)) {
    return { ok: false, assign: false, error: 'notify must be an object' };
  }

  const email = (notify as any).email;
  // Absent is fine — a PATCH may set only `notify.webhook`, or clear the key. It
  // is also the pre-existing behaviour: there is nothing to normalise.
  if (email === undefined || email === null) return { ok: true, assign: false };

  if (!isPlainObject(email)) {
    return {
      ok: false,
      assign: false,
      error: 'notify.email must be an object with `enabled` and `recipients`',
    };
  }

  const check = checkRecipients(email.recipients);
  if (!check.ok) return { ok: false, assign: false, error: check.error };
  return { ok: true, assign: true, recipients: check.recipients };
}
