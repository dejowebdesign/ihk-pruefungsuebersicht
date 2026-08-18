"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "IHKs" },
  { href: "/vergleich", label: "Vergleich" },
  { href: "/fragen", label: "Fragen" },
  { href: "/fallbeispiele", label: "Fallbeispiele" },
];

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

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
      </div>
    </header>
  );
}
