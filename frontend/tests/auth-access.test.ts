import { describe, it, expect, beforeEach } from "vitest";
import {
  canAccessPath,
  isPublicPath,
  isWithin,
  readCachedIdentity,
  writeCachedIdentity,
  clearCachedIdentity,
  roleLabel,
  canManageExams,
  IDENTITY_CACHE_KEY,
} from "@/lib/auth";

// The client-side policy must mirror the server's: an examiner gets `/`, the
// IHK detail pages `/ihk/:id` (reached from the cards) and
// `/muendliche-pruefung*`, nothing else. These helpers only decide what the UI
// offers — the enforcement is server-side — but a mismatch would produce
// confusing dead ends, so the rules are pinned here.

beforeEach(() => {
  localStorage.clear();
});

describe("path matching", () => {
  it("matches an exact prefix", () => {
    expect(isWithin("/fragen", ["/fragen"])).toBe(true);
  });

  it("matches nested paths under a prefix", () => {
    expect(isWithin("/muendliche-pruefung/abc123", ["/muendliche-pruefung"])).toBe(true);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    expect(isWithin("/fragen-archiv", ["/fragen"])).toBe(false);
    expect(isWithin("/fragenarchiv", ["/fragen"])).toBe(false);
  });

  it("treats '/' as the exact root only", () => {
    expect(isWithin("/", ["/"])).toBe(true);
    expect(isWithin("/fragen", ["/"])).toBe(false);
  });
});

describe("examiner access", () => {
  const allowed = [
    "/",
    "/ihk/abc",
    "/ihk/ihk-koeln",
    "/muendliche-pruefung",
    "/muendliche-pruefung/exam-1",
  ];

  for (const path of allowed) {
    it(`allows the examiner ${path}`, () => {
      expect(canAccessPath("examiner", path)).toBe(true);
    });
  }

  // Everything outside the examiner's area — including every admin surface and
  // the retired compare page — must stay closed.
  const blocked = [
    "/fragen",
    "/fallbeispiele",
    "/vergleich",
    "/admin",
    "/admin/users",
    "/import",
    "/tabellen",
  ];

  for (const path of blocked) {
    it(`blocks the examiner ${path}`, () => {
      expect(canAccessPath("examiner", path)).toBe(false);
    });
  }
});

describe("admin access", () => {
  const paths = [
    "/",
    "/muendliche-pruefung",
    "/muendliche-pruefung/x",
    "/ihk/abc",
    "/fragen",
    "/fallbeispiele",
    "/admin",
    "/admin/users",
  ];

  for (const path of paths) {
    it(`allows the admin ${path}`, () => {
      expect(canAccessPath("admin", path)).toBe(true);
    });
  }

  it("blocks the admin from nothing on this list (sanity check)", () => {
    expect(paths.every((p) => canAccessPath("admin", p))).toBe(true);
  });
});

describe("oral exam rights", () => {
  it("both roles may run exams", () => {
    expect(canManageExams("admin")).toBe(true);
    expect(canManageExams("examiner")).toBe(true);
  });

  it("no role value means no exam rights", () => {
    expect(canManageExams(null)).toBe(false);
    expect(canManageExams(undefined)).toBe(false);
  });
});

describe("public routes", () => {
  it("only /login is public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/fragen")).toBe(false);
  });
});

describe("identity cache", () => {
  it("round-trips a valid identity", () => {
    writeCachedIdentity({ id: "u1", username: "anna", role: "examiner", active: true });
    expect(readCachedIdentity()).toEqual({
      id: "u1",
      username: "anna",
      role: "examiner",
      active: true,
    });
  });

  it("returns null when nothing is cached", () => {
    expect(readCachedIdentity()).toBeNull();
  });

  it("ignores corrupt cache content", () => {
    localStorage.setItem(IDENTITY_CACHE_KEY, "not-json{");
    expect(readCachedIdentity()).toBeNull();
  });

  it("rejects a cached role that is not a known role", () => {
    localStorage.setItem(
      IDENTITY_CACHE_KEY,
      JSON.stringify({ id: "u", username: "x", role: "superadmin", active: true }),
    );
    expect(readCachedIdentity()).toBeNull();
  });

  it("clears the cache", () => {
    writeCachedIdentity({ id: "u", username: "x", role: "admin", active: true });
    clearCachedIdentity();
    expect(readCachedIdentity()).toBeNull();
  });

  it("never stores a password or token field", () => {
    writeCachedIdentity({ id: "u", username: "x", role: "admin", active: true });
    const raw = localStorage.getItem(IDENTITY_CACHE_KEY)!;
    expect(raw).not.toMatch(/password|token|hash/i);
  });
});

describe("labels", () => {
  it("renders German role names", () => {
    expect(roleLabel("admin")).toBe("Administrator");
    expect(roleLabel("examiner")).toBe("Prüfer");
  });
});

describe("retired participant role", () => {
  it("is not a valid cached role any more", () => {
    localStorage.setItem(
      IDENTITY_CACHE_KEY,
      JSON.stringify({ id: "u", username: "x", role: "participant", active: true }),
    );
    expect(readCachedIdentity()).toBeNull();
  });

  it("grants no page access (it is not a known role)", () => {
    // canAccessPath only knows admin/examiner; the retired role must not be
    // treated as an examiner by accident.
    expect(canAccessPath("participant" as never, "/")).toBe(false);
    expect(canAccessPath("participant" as never, "/muendliche-pruefung")).toBe(false);
  });
});
