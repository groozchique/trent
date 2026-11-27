const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_ACCOUNT = 10;
const MAX_FAILURES_PER_IP = 30;
const MAX_BUCKETS = 500;

type FailureBucket = {
  timestamps: number[];
};

const globalForRateLimit = globalThis as unknown as {
  __trentLoginFailures?: Map<string, FailureBucket>;
};

const buckets =
  globalForRateLimit.__trentLoginFailures ??
  (globalForRateLimit.__trentLoginFailures = new Map<string, FailureBucket>());

function pruneWindow(timestamps: number[], nowMs: number): number[] {
  const cutoff = nowMs - WINDOW_MS;
  return timestamps.filter((ts) => ts > cutoff);
}

function pruneExpiredBuckets(nowMs: number): void {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    const active = pruneWindow(bucket.timestamps, nowMs);
    if (active.length === 0) {
      buckets.delete(key);
    } else {
      bucket.timestamps = active;
    }
  }
}

function checkBucket(
  key: string,
  limit: number,
  nowMs: number,
): { allowed: boolean; retryAfterSec: number } {
  const bucket = buckets.get(key);
  if (!bucket) return { allowed: true, retryAfterSec: 0 };

  const active = pruneWindow(bucket.timestamps, nowMs);
  if (active.length === 0) {
    buckets.delete(key);
    return { allowed: true, retryAfterSec: 0 };
  }
  bucket.timestamps = active;

  if (active.length >= limit) {
    const oldest = active[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - nowMs) / 1000));
    return { allowed: false, retryAfterSec };
  }

  return { allowed: true, retryAfterSec: 0 };
}

function recordBucketFailure(key: string, nowMs: number): void {
  const existing = buckets.get(key);
  const active = existing ? pruneWindow(existing.timestamps, nowMs) : [];
  active.push(nowMs);
  buckets.set(key, { timestamps: active });
}

/** Extract client IP from reverse-proxy headers (`X-Forwarded-For`, `X-Real-IP`). */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp || 'unknown';
}

/** Check whether a login attempt for `(ip, username)` is allowed under the sliding-window rate limit. */
export function checkLoginRateLimit(
  ip: string,
  username: string,
  nowMs: number = Date.now(),
): { allowed: boolean; retryAfterSec: number } {
  const ipCheck = checkBucket(`ip:${ip}`, MAX_FAILURES_PER_IP, nowMs);
  if (!ipCheck.allowed) return ipCheck;

  const accountKey = `acct:${ip}:${username.trim().toLowerCase()}`;
  return checkBucket(accountKey, MAX_FAILURES_PER_ACCOUNT, nowMs);
}

/** Record a failed login attempt for both IP and IP+username buckets. */
export function recordLoginFailure(
  ip: string,
  username: string,
  nowMs: number = Date.now(),
): void {
  pruneExpiredBuckets(nowMs);
  recordBucketFailure(`ip:${ip}`, nowMs);
  recordBucketFailure(`acct:${ip}:${username.trim().toLowerCase()}`, nowMs);
}

/** Clear account failure counter after a successful login. */
export function clearLoginFailures(ip: string, username: string): void {
  buckets.delete(`acct:${ip}:${username.trim().toLowerCase()}`);
}

/** Reset all in-memory login rate-limit buckets (for unit/integration tests). */
export function resetLoginRateLimits(): void {
  buckets.clear();
}
