import type { Metadata } from "next";
import type { ReactNode } from "react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { BackToTop } from "@/components/BackToTop";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "@/styles/globals.css";

/**
 * Path of the uploaded IHK logo, or `null` when no file is present.
 *
 * The logo is dropped into `frontend/public/` as-is and referenced by its
 * original filename — it is never processed, recoloured or re-encoded. Checking
 * for it here (server-side, once per render) keeps the client free of a 404 and
 * lets the header fall back to its built-in mark when the file is absent.
 */
function findLogo(): string | null {
  const candidates = ["ihk-logo.png", "logo.png", "logo.svg"];
  for (const name of candidates) {
    if (existsSync(join(process.cwd(), "public", name))) return `/${name}`;
  }
  return null;
}

export const metadata: Metadata = {
  title: "IHK Prüfungsübersicht — Sachkundeprüfung §34a",
  description:
    "Prüfungsbedingungen und Informationen der verschiedenen IHK-Standorte für die Sachkundeprüfung §34a.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        {/* Blocking script: applies the stored/OS theme before first paint to
            avoid a white flash in dark mode. Runs synchronously in <head>. */}
        <script
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body>
        <Header logoSrc={findLogo()} />
        <main className="page">{children}</main>
        <Footer />
        <BackToTop />
      </body>
    </html>
  );
}
