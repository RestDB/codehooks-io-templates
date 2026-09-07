// The Datastore has no filtered count: `count(collection)` takes no query, so
// "how many submissions on this form are new" can only be answered by scanning.
// Scanning is bounded and projected to _id, and the caller is told whether the
// answer is exact — showing "5000+" is honest, showing a wrong 5000 is not.

export const COUNT_CAP = 5000;

export type CountResult = { total: number; exact: boolean };

export async function countCapped(
  conn: any,
  collection: string,
  query: Record<string, unknown>,
  cap: number = COUNT_CAP
): Promise<CountResult> {
  try {
    const rows = await conn
      .getMany(collection, query, { hints: { $fields: { _id: 1 } }, limit: cap + 1 })
      .toArray();
    const n = rows.length;
    // The extra row distinguishes "exactly cap" from "cut short".
    return n > cap ? { total: cap, exact: false } : { total: n, exact: true };
  } catch (err: any) {
    // A count is decoration on a page whose real content is the submission list.
    // A counting failure must not take the inbox down with it.
    console.error('countCapped failed for', collection, err?.message);
    return { total: 0, exact: false };
  }
}
