import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Hash a plaintext password with a 16-byte random hex salt using scrypt. */
export function hashPassword(plain: string): string {
  const saltHex = randomBytes(16).toString('hex');
  const hashHex = scryptSync(plain, saltHex, 64).toString('hex');
  return `${saltHex}:${hashHex}`;
}

/** Verify a plaintext password against a `${saltHex}:${hashHex}` scrypt hash in constant time. */
export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;

  const [saltHex, hashHex] = parts;
  if (!saltHex || !hashHex || hashHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hashHex)) {
    return false;
  }

  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length === 0) return false;

  const actual = scryptSync(plain, saltHex, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
