/**
 * Optional rate limiter for Groq API calls.
 *
 * Uses a simple serial queue: each request waits until the minimum interval
 * since the last request has elapsed. This guarantees we never exceed the
 * configured RPM regardless of concurrency upstream.
 *
 * Disabled by default — enable via GUARDIAN_RATE_LIMIT_ENABLED=true.
 */

const enabled = process.env.GUARDIAN_RATE_LIMIT_ENABLED === "true";
const rpm = Math.max(
  1,
  parseInt(process.env.GUARDIAN_RATE_LIMIT_RPM || "80", 10) || 80
);
const intervalMs = Math.ceil(60_000 / rpm);

let nextAllowedTime = 0;

/**
 * Wait until the next request slot is available.
 * No-op when rate limiting is disabled.
 */
export async function waitForRateLimit(): Promise<void> {
  if (!enabled) return;

  const now = Date.now();
  if (now >= nextAllowedTime) {
    nextAllowedTime = now + intervalMs;
    return;
  }

  const waitMs = nextAllowedTime - now;
  nextAllowedTime += intervalMs;
  await new Promise((r) => setTimeout(r, waitMs));
}
