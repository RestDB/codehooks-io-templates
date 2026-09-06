import type { FormDoc } from '#lib/forms';
import type { SendResult } from '#lib/providers/types';
import type { RejectedRecipient } from '#lib/recipients';

export type DeliveryContext = {
  form: FormDoc;
  submission: any;
  target: string;
  baseUrl: string;
};

// One interface for every notification channel. All retry, backoff and
// transient-vs-permanent logic lives in the `deliver` worker, never here — so
// adding a channel is one file with no delivery logic to duplicate.
export interface Channel {
  name: string;
  /** Recipients for this form, or [] when the channel is not configured. */
  targets(form: FormDoc): string[];
  /**
   * Configured recipients this channel refuses, with a reason each. Dropping one
   * silently is what made a mistyped address indistinguishable from "notifications
   * are off" — `processSubmission` records these as terminal delivery rows so the
   * diagnostics panel can name the problem.
   */
  rejectedTargets(form: FormDoc): RejectedRecipient[];
  deliver(ctx: DeliveryContext): Promise<SendResult>;
}
