import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Staff PIN hashing (§7.2 step 4).
 *
 * v1 compared a plaintext PIN with `===` against an env var and accepted any request
 * when that var was unset. v2 stores only a scrypt hash, per shop, and compares in
 * constant time.
 *
 * Stored form is §9's `scrypt$<N>$<salt-b64>$<hash-b64>`. The parameters live in the
 * string rather than only in code so a future cost increase can be rolled out without
 * invalidating existing hashes — a hash written at one N still verifies at its own N.
 */

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 32768; // 2^15, per §7.2
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * scrypt needs roughly `128 * N * r` bytes — 32 MiB at these parameters, which is
 * exactly Node's default `maxmem` and therefore fails the check. Give it headroom
 * explicitly rather than quietly dropping N to fit.
 */
const MAXMEM = 64 * 1024 * 1024;

export const PIN_PATTERN = /^\d{4,8}$/;

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

async function derive(pin: string, salt: Buffer, n: number): Promise<Buffer> {
  return scrypt(pin, salt, KEYLEN, { N: n, r: R, p: P, maxmem: MAXMEM });
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(pin, salt, N);
  return `scrypt$${N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/**
 * Constant-time verify. Returns false on anything malformed rather than throwing:
 * a corrupted `pinHash` must read as "wrong PIN", never as "no PIN set" — failing
 * open here is precisely the v1 defect this file exists to prevent.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  // Guard the cost factor before handing it to scrypt: a hostile or corrupted value
  // like 2^30 would otherwise be a denial of service against ourselves.
  if (!Number.isInteger(n) || n < 1024 || n > N || (n & (n - 1)) !== 0) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[2], "base64");
    expected = Buffer.from(parts[3], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== KEYLEN) return false;

  let actual: Buffer;
  try {
    actual = await derive(pin, salt, n);
  } catch {
    return false;
  }

  // Lengths are equal by construction above, so timingSafeEqual cannot throw here.
  return timingSafeEqual(actual, expected);
}
