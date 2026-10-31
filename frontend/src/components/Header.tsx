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
        <Link href="/" className="brand">
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
          <span className="brand__text">Prüfungsübersicht</span>
        </Link>

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
                <span className="session__user" title={roleLabel(user.role)}>
                  <span className="session__name">{user.username}</span>
                  <span className={`session__role session__role--${user.role}`}>
                    {roleLabel(user.role)}
                  </span>
                </span>
                <button className="btn btn--ghost btn--sm" onClick={signOut}>
                  Abmelden
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
    </header>
  );
}
