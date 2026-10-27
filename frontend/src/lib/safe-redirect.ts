// Open-redirect protection for the post-login `next` target.
//
// The middleware sends visitors to `/admin/login?next=<original path>`. After a
// successful login we navigate back there. Because `next` is attacker-
// controllable (it arrives in a URL), it must be validated before use: only
// same-origin, absolute *paths* are accepted — never a full URL, a
// protocol-relative `//host` reference, or a value containing a scheme.

/** Fallback destination when no usable `next` value is present. */
export const DEFAULT_REDIRECT = "/";

/**
 * Normalise a raw `next` value into a safe same-origin path.
 * Returns `DEFAULT_REDIRECT` for anything that is not clearly an internal path.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_REDIRECT;
  // Reject control characters / whitespace tricks (e.g. "\n//evil").
  const value = raw.trim();
  if (value === "") return DEFAULT_REDIRECT;
  // Must be an absolute path on this origin.
  if (!value.startsWith("/")) return DEFAULT_REDIRECT;
  // "//evil.com" and "/\evil.com" are treated as protocol-relative URLs by
  // browsers — reject both.
  if (value.startsWith("//") || value.startsWith("/\\")) return DEFAULT_REDIRECT;
  // A backslash anywhere can be normalised to "/" by some clients.
  if (value.includes("\\")) return DEFAULT_REDIRECT;
  // Reject anything that already looks like a scheme (defence in depth).
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return DEFAULT_REDIRECT;
  // Never bounce back to the login page itself (would be pointless/loopy).
  if (value === "/admin/login" || value.startsWith("/admin/login?")) {
    return DEFAULT_REDIRECT;
  }
  return value;
}
