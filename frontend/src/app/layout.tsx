import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "IHK Prüfungsübersicht — Sachkundeprüfung §34a",
  description:
    "Vergleiche Prüfungsbedingungen und Informationen der verschiedenen IHK-Standorte für die Sachkundeprüfung §34a.",
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
        <Header />
        <main className="page">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
