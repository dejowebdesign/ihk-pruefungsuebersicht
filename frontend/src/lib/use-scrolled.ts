"use client";
// Scroll-state hook for the compact header.
//
// The listener is passive and coalesced into a single animation frame, so a
// scroll burst never forces a synchronous layout and never re-renders more than
// once per frame. The two boundaries are asymmetric on purpose: the compact
// header is shorter, which changes what the browser reports at the very same
// offset, so a single threshold would flip back and forth while the user rests
// on it.

import { useEffect, useState } from "react";

export function useScrolled(threshold = 24, hysteresis = 8): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    let state = false;

    const read = () => {
      frame = 0;
      const y = window.scrollY;
      if (!state && y > threshold) state = true;
      else if (state && y < threshold - hysteresis) state = false;
      else return;
      setScrolled(state);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(read);
    };

    // The initial position matters: a reload keeps the scroll offset, so the
    // header must come up already compact instead of animating on first scroll.
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [threshold, hysteresis]);

  return scrolled;
}
