"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useIdentity } from "@/lib/use-identity";
import { useScrolled } from "@/lib/use-scrolled";
import { roleLabel } from "@/lib/auth";

// Navigation is role-aware: examiners only see the areas the server lets them
// open (`/` and `/muendliche-pruefung`). This is presentation only — the actual
// restriction is enforced by middleware and the API gate.
const ALL_LINKS = [
  { href: "/", label: "IHKs", roles: ["admin", "examiner"] },
  { href: "/fragen", label: "Fragen", roles: ["admin"] },
  { href: "/fallbeispiele", label: "Fallbeispiele", roles: ["admin"] },
  { href: "/muendliche-pruefung", label: "Mündliche Prüfung", roles: ["admin", "examiner"] },
  { href: "/admin", label: "Verwaltung", roles: ["admin"] },
];

/**
 * @param logoSrc  Path of the uploaded logo file, or `null` while no file is
 *                 present in `public/`. The decision is made on the server (see
 *                 layout.tsx) so a missing file never renders a broken image and
 *                 the fallback mark is chosen once, not after a failed request.
 */
export function Header({ logoSrc = null }: { logoSrc?: string | null }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const scrolled = useScrolled();
  const { user, loaded, logout } = useIdentity();

  const links = ALL_LINKS.filter((l) => !user || l.roles.includes(user.role));
  const onLoginPage = path === "/login";

  async function signOut() {
    await logout();
    setOpen(false);
    router.replace("/login");
  }

  return (
    <header className={`site-header${scrolled ? " site-header--scrolled" : ""}`}>
      <div className="site-header__inner">
        {/* Left: the logo alone. The wordmark next to it was removed, so the
            bar reads as a single, uncluttered brand mark. */}
        <Link href="/" className="brand" aria-label="IHK Prüfungsübersicht — Startseite">
          {logoSrc ? (
            // The uploaded file, unmodified: original proportions via
            // `object-fit: contain`, no filter and no recolouring.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="brand__logo" src={logoSrc} alt="IHK" />
          ) : (
            <span className="brand__mark" aria-hidden="true">
              IHK
            </span>
          )}
        </Link>

        {/* Middle: always rendered, even when empty (login page), so the three
            header areas never change places between auth states. */}
        <div className="header__center">
          {!onLoginPage && (
            <nav className={`nav${open ? " nav--open" : ""}`} aria-label="Hauptnavigation">
              {links.map((l) => {
                const active = l.href === "/" ? path === "/" : path?.startsWith(l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={active ? "active" : ""}
                    onClick={() => setOpen(false)}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        {/* Right: menu button (mobile), identity and the theme toggle. The
            toggle is the last child, so it stays the rightmost control in every
            state — signed out, admin, examiner, full and compact. */}
        <div className="header__actions">
          <button
            className="nav__toggle"
            onClick={() => setOpen((o) => !o)}
            aria-label="Menü"
            aria-expanded={open}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18" strokeLinecap="round" />
            </svg>
          </button>

          {!onLoginPage && loaded && (
            <div className="session">
              {user ? (
                <>
                  {/* Username + role, both required by the brief: the account,
                      the username and the role label ("Administrator" /
                      "Prüfer") must stay visible. The wrapper is shrinkable so
                      a long name ellipsises instead of widening the bar. */}
                  <span className="session__user" title={`${user.username} — ${roleLabel(user.role)}`}>
                    <span className="session__name">{user.username}</span>
                    <span className={`session__role session__role--${user.role}`}>
                      {roleLabel(user.role)}
                    </span>
                  </span>
                  {/* Sign-out. The label is a span so the very narrow layout can
                      drop the text and keep the icon (still named for screen
                      readers via aria-label), which is what lets the bar fit a
                      320px screen without overflowing. */}
                  <button
                    className="btn btn--ghost btn--sm session__logout"
                    onClick={signOut}
                    aria-label="Abmelden"
                    title="Abmelden"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                    </svg>
                    <span className="session__logout-text">Abmelden</span>
                  </button>
                </>
              ) : (
                <Link className="btn btn--primary btn--sm" href="/login">
                  Anmelden
                </Link>
              )}
            </div>
          )}

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
