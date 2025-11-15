import * as crypto from 'crypto';

/**
 * Verify Slack request signature
 * This ensures the request actually came from Slack
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  signingSecret: string,
  requestSignature: string,
  timestamp: string,
  body: string
): boolean {
  // Check timestamp to prevent replay attacks (within 5 minutes)
  const time = Math.floor(Date.now() / 1000);
  if (Math.abs(time - parseInt(timestamp)) > 300) {
    console.warn('Slack request timestamp too old');
    return false;
  }

  // Create signature base string
  const sigBaseString = `v0:${timestamp}:${body}`;

  // Create HMAC SHA256 signature
  const hmac = crypto.createHmac('sha256', signingSecret);
  hmac.update(sigBaseString);
  const computedSignature = `v0=${hmac.digest('hex')}`;

  // Compare signatures using time-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(computedSignature),
    Buffer.from(requestSignature)
  );
}

/**
 * Handle URL verification challenge from Slack
 * This is called when you first configure your Event Subscriptions URL
 */
export function handleUrlVerification(challenge: string): any {
  return {
    challenge,
  };
}
