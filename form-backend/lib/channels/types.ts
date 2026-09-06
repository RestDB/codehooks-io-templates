import type { FormDoc } from '#lib/forms';
import type { SendResult } from '#lib/providers/types';

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
  deliver(ctx: DeliveryContext): Promise<SendResult>;
}
