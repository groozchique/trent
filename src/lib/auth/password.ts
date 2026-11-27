import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SCRYPT_KEY_LEN = 64;

/** Hash a plaintext password with a 16-byte random hex salt using scrypt. */
export function hashPassword(plain: string): string {
  const saltHex = randomBytes(16).toString('hex');
  const hashHex = scryptSync(plain, saltHex, SCRYPT_KEY_LEN).toString('hex');
  return `${saltHex}:${hashHex}`;
}

/** Asynchronously hash a plaintext password with a 16-byte random hex salt using scrypt. */
export async function hashPasswordAsync(plain: string): Promise<string> {
  const saltHex = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(plain, saltHex, SCRYPT_KEY_LEN)) as Buffer;
  return `${saltHex}:${derived.toString('hex')}`;
}

function parseStoredHash(stored: string): { saltHex: string; expected: Buffer } | null {
  const parts = stored.split(':');
  if (parts.length !== 2) return null;

  const [saltHex, hashHex] = parts;
  if (!saltHex || !hashHex || hashHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hashHex)) {
    return null;
  }

  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== SCRYPT_KEY_LEN) return null;
  return { saltHex, expected };
}

/** Verify a plaintext password against a `${saltHex}:${hashHex}` scrypt hash in constant time. */
export function verifyPassword(plain: string, stored: string): boolean {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;

  const actual = scryptSync(plain, parsed.saltHex, parsed.expected.length);
  return actual.length === parsed.expected.length && timingSafeEqual(actual, parsed.expected);
}

/** Asynchronously verify a plaintext password against a `${saltHex}:${hashHex}` scrypt hash in constant time. */
export async function verifyPasswordAsync(plain: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;

  const actual = (await scryptAsync(plain, parsed.saltHex, parsed.expected.length)) as Buffer;
  return actual.length === parsed.expected.length && timingSafeEqual(actual, parsed.expected);
}

/** Precomputed valid scrypt hash used to equalize login latency when a username does not exist. */
export const DUMMY_PASSWORD_HASH = hashPassword('__trent_dummy_timing_pad__');
