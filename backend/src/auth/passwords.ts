// Password hashing — scrypt via node:crypto (no external dependency).
//
// Stored format: "scrypt$N$r$p$<saltHex>$<hashHex>". Self-describing so the
// parameters can be raised later without invalidating existing hashes: verify()
// reads N/r/p from the stored string. Plaintext passwords are never stored,
// never logged and never returned by any route.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 16384; // CPU/memory cost
const R = 8; // block size
const P = 1; // parallelisation
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024; // scrypt needs ~128*N*r bytes; give it headroom

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string" || plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Verify a plaintext password against a stored hash. Always does the full
 * scrypt work for well-formed hashes, and compares with timingSafeEqual so the
 * comparison itself leaks no information about the hash.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (typeof plain !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "hex");
    expected = Buffer.from(parts[5], "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = await scrypt(plain, salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** True when the value looks like one of our scrypt hashes (never a raw password). */
export function looksHashed(value: string): boolean {
  return typeof value === "string" && value.startsWith("scrypt$");
}
