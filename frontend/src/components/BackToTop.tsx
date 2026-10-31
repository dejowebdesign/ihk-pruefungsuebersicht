"use client";
// Round "back to top" control.
//
// Reuses the header's scroll hook so the whole app shares one scroll-detection
// strategy (passive listener, one animation frame, hysteresis); only the
// threshold differs, because the button should appear well after the header has
// compacted rather than the moment the page moves.

import { useScrolled } from "@/lib/use-scrolled";

export function BackToTop() {
  const visible = useScrolled(420, 120);

  function toTop() {
    // Respect the OS motion preference: jump instantly instead of animating.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }

  return (
    <button
      type="button"
      className={`to-top${visible ? " to-top--visible" : ""}`}
      onClick={toTop}
      aria-label="Zurück nach oben"
      title="Zurück nach oben"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}
