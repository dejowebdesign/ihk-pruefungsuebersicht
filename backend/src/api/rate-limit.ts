// Login rate limiting: slows down credential brute-forcing.
//
// A simple fixed-window counter keyed by client IP + username. After
// MAX_ATTEMPTS failures within the window, further attempts are refused with
// 429 until the window rolls over. Successful logins reset the counter.
//
// In-process (single-instance deployment). Configuration via env:
//   ADMIN_LOGIN_MAX_ATTEMPTS   (default 5)
//   ADMIN_LOGIN_WINDOW_MINUTES (default 15)

interface Attempt {
  count: number;
  windowStart: number;
}

const attempts = new Map<string, Attempt>();

function maxAttempts(): number {
  const raw = Number(process.env.ADMIN_LOGIN_MAX_ATTEMPTS ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
}

function windowMs(): number {
  const raw = Number(process.env.ADMIN_LOGIN_WINDOW_MINUTES ?? "");
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : 15;
  return minutes * 60 * 1000;
}

/** True when the key is currently locked out (too many failures). */
export function isRateLimited(key: string, now: number = Date.now()): boolean {
  const a = attempts.get(key);
  if (!a) return false;
  if (now - a.windowStart >= windowMs()) {
    attempts.delete(key);
    return false;
  }
  return a.count >= maxAttempts();
}

/** Record a failed attempt for the key. */
export function recordFailure(key: string, now: number = Date.now()): void {
  const a = attempts.get(key);
  if (!a || now - a.windowStart >= windowMs()) {
    attempts.set(key, { count: 1, windowStart: now });
    return;
  }
  a.count++;
}

/** Clear the counter for a key (after a successful login). */
export function clearFailures(key: string): void {
  attempts.delete(key);
}

/** Remaining attempts before lockout (>= 0). */
export function remainingAttempts(key: string, now: number = Date.now()): number {
  const a = attempts.get(key);
  if (!a || now - a.windowStart >= windowMs()) return maxAttempts();
  return Math.max(0, maxAttempts() - a.count);
}

/** Reset all counters (tests). */
export function resetRateLimiter(): void {
  attempts.clear();
}
