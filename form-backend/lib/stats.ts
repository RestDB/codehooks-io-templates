// --- Form statistics ---------------------------------------------------------
//
// PLATFORM BEHAVIOUR THAT FAILS SILENTLY. This datastore does NOT interpret dot
// notation in an update as a path into a nested object. `$inc: {'stats.total': 1}`
// creates or updates a TOP-LEVEL field whose NAME contains a dot; it never touches
// `total` inside `stats`. No error is raised. Probed against the deployed platform:
//
//   $inc {'stats.total': 1}        -> {stats: {total: 0}, "stats.total": 1}
//   $set {'stats.lastSubmissionAt'}-> {stats: {...},      "stats.lastSubmissionAt": "X"}
//   $inc {stats: {total: 1}}       -> THROWS "The value of $inc must be an object
//                                     where each property is a number"
//   $inc {statsTotal: 1}           -> {statsTotal: 1}          (works, atomic)
//   $unset {'stats.total': ''}     -> removes the literal key  (works)
//
// So an atomic counter is only possible on a top-level, dot-free field, and a
// nested object can only be written WHOLESALE — which means read-modify-write, and
// therefore lost counts whenever two submissions to the same form overlap.
//
// The trade-off taken: keep the counters flat and atomic, and compose the nested
// `stats` object on the way out. Atomicity wins because absorbing concurrent
// submissions is the entire job of this template — a counter that silently
// undercounts under load would replace one invisible defect with another. The
// public shape (`form.stats.total`) is unchanged, so no consumer has to know.

export type FormStats = { total: number; spam: number; lastSubmissionAt: string | null };

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The stats to report for a form document, whatever era it was written in. Pure.
 *
 * A document written before the counters were flattened carries the true count in
 * a stray literal `"stats.total"` key. That key is FROZEN — nothing writes it any
 * more — so the historical count and the new counter are added together and the
 * total stays correct across the upgrade with no migration step and no race. The
 * legacy nested `stats` object is always zero (nothing ever wrote to it) but is
 * summed in for the same reason: it costs nothing and cannot be wrong.
 */
export function composeStats(doc: any): FormStats {
  const legacy = doc?.stats || {};
  const latest = (a: unknown, b: unknown): string | null => {
    const x = typeof a === 'string' ? a : null;
    const y = typeof b === 'string' ? b : null;
    if (!x) return y;
    if (!y) return x;
    return x > y ? x : y;
  };
  return {
    total: num(doc?.statsTotal) + num(doc?.['stats.total']) + num(legacy.total),
    spam: num(doc?.statsSpam) + num(doc?.['stats.spam']) + num(legacy.spam),
    lastSubmissionAt: latest(
      doc?.statsLastSubmissionAt,
      latest(doc?.['stats.lastSubmissionAt'], legacy.lastSubmissionAt)
    ),
  };
}

/**
 * What `/admin/api/*` returns for a form: the stored counter fields and any stray
 * dotted keys replaced by one composed `stats` object. Returning the raw fields as
 * well would put three different-looking numbers in the same response, which is
 * how this defect stayed invisible in the first place.
 */
export function formView(doc: any): any {
  if (!doc) return doc;
  const view: any = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key === 'statsTotal' || key === 'statsSpam' || key === 'statsLastSubmissionAt') continue;
    if (key === 'stats' || key.startsWith('stats.')) continue;
    view[key] = value;
  }
  view.stats = composeStats(doc);
  return view;
}

/** The atomic update applied to a form's counters when a submission lands. Pure. */
export function statsUpdate(isSpam: boolean, now: string): any {
  return {
    // Top-level and dot-free, so the platform increments it atomically. Both
    // counters are always present so the shape does not depend on the verdict.
    $inc: { statsTotal: 1, statsSpam: isSpam ? 1 : 0 },
    $set: { statsLastSubmissionAt: now },
  };
}
