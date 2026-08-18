"use client";
import { useEffect, useRef, useState } from "react";

export function SearchBar({
  value,
  onChange,
  placeholder = "IHK, Stadt oder Bundesland suchen …",
  debounceMs = 300,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  debounceMs?: number;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external value changes (e.g. reset) into the input.
  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function handleInput(v: string) {
    setLocal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(v), debounceMs);
  }

  return (
    <div className="searchbar" role="search">
      <span className="searchbar__icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" strokeLinecap="round" />
        </svg>
      </span>
      <input
        className="searchbar__input"
        type="search"
        value={local}
        onChange={(e) => handleInput(e.target.value)}
        placeholder={placeholder}
        aria-label="IHK suchen"
      />
      {local && (
        <button
          className="searchbar__clear"
          onClick={() => handleInput("")}
          aria-label="Suche löschen"
          type="button"
        >
          ✕
        </button>
      )}
    </div>
  );
}
