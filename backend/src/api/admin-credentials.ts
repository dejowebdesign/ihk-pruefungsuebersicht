// Admin credential resolution + verification.
//
// Credentials come exclusively from the environment — never from source code
// and never stored in the database. Two forms are supported:
//
//   ADMIN_USERNAME + ADMIN_PASSWORD_HASH   ← preferred (scrypt hash)
//   ADMIN_USERNAME + ADMIN_PASSWORD        ← plaintext, local/dev convenience
//
// The legacy shared-secret ADMIN_TOKEN (Bearer) is handled separately in
// admin-auth.ts so existing clients keep working.

import { constantTimeEqual, verifyPasswordHash } from "./passwords";

export const DEFAULT_ADMIN_USERNAME = "admin";

/** Configured admin username (defaults to "admin" when a password is set). */
export function adminUsername(): string {
  return process.env.ADMIN_USERNAME?.trim() || DEFAULT_ADMIN_USERNAME;
}

/** True when a password (hash or plaintext) is configured. */
export function adminPasswordConfigured(): boolean {
  return Boolean(
    (process.env.ADMIN_PASSWORD_HASH && process.env.ADMIN_PASSWORD_HASH.length > 0) ||
      (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length > 0),
  );
}

/** True when username/password login is usable. */
export function credentialsLoginConfigured(): boolean {
  return adminPasswordConfigured();
}

/**
 * Verify a username/password pair. Always performs a comparison even when the
 * username does not match, so the response time does not reveal which part was
 * wrong. Returns true only when both match.
 */
export function verifyCredentials(username: string, password: string): boolean {
  const expectedUser = adminUsername();
  const userOk = constantTimeEqual(username, expectedUser);

  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (hash && hash.length > 0) {
    const passOk = verifyPasswordHash(password, hash);
    return userOk && passOk;
  }
  const plain = process.env.ADMIN_PASSWORD;
  if (plain && plain.length > 0) {
    const passOk = constantTimeEqual(password, plain);
    return userOk && passOk;
  }
  return false;
}
