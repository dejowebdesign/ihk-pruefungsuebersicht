"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api } from "@/lib/api";

const LINKS = [
  { href: "/", label: "IHKs" },
  { href: "/vergleich", label: "Vergleich" },
  { href: "/fragen", label: "Fragen" },
  { href: "/fallbeispiele", label: "Fallbeispiele" },
  { href: "/muendliche-pruefung", label: "Mündliche Prüfung" },
  { href: "/admin", label: "Admin" },
];

export function Header() {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // No sign-out control on the login page itself.
  const showLogout = path !== "/admin/login";

  async function logout() {
    setLoggingOut(true);
    try {
      await api.authLogout();
    } catch {
      /* ignore — the server session is cleared regardless of client errors */
    }
    setOpen(false);
    // Full navigation so the middleware re-evaluates the (now absent) session.
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="brand">
          <span className="brand__mark" aria-hidden="true">
            IHK
          </span>
          <span>Prüfungsübersicht</span>
        </Link>

        <nav className={`nav${open ? " nav--open" : ""}`} aria-label="Hauptnavigation">
          {LINKS.map((l) => {
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

        <ThemeToggle />

        {showLogout && (
          <button
            className="nav__logout"
            onClick={logout}
            disabled={loggingOut}
            title="Sitzung beenden"
          >
            {loggingOut ? "…" : "Abmelden"}
          </button>
        )}
      </div>
    </header>
  );
}
