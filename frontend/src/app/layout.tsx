import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
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
    <html lang="de">
      <body>
        <Header />
        <main className="page">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
