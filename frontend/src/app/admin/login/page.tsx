"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/api";
import { safeNextPath } from "@/lib/safe-redirect";

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Where to go after a successful login (validated — see safeNextPath).
  const nextPath = safeNextPath(searchParams.get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already logged in, go straight to the requested page (or the start page).
  useEffect(() => {
    api
      .authMe()
      .then((me) => {
        if (me.authenticated) router.replace(nextPath);
      })
      .catch(() => {
        /* not fatal — show the form */
      });
  }, [router, nextPath]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("Bitte Benutzername und Passwort eingeben.");
      return;
    }
    setLoading(true);
    try {
      await api.authLogin(username.trim(), password);
      router.replace(nextPath);
    } catch (e: unknown) {
      if (e instanceof ApiClientError && e.status === 429) {
        setError("Zu viele Fehlversuche. Bitte später erneut versuchen.");
      } else if (e instanceof ApiClientError && e.status === 401) {
        setError("Benutzername oder Passwort ist falsch.");
      } else if (e instanceof ApiClientError && e.status === 503) {
        setError("Die Anmeldung ist auf dem Server nicht konfiguriert.");
      } else {
        setError("Anmeldung fehlgeschlagen. Bitte erneut versuchen.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-login">
      <form className="admin-login__card" onSubmit={onSubmit} aria-label="Anmeldung">
        <h1 className="admin-login__title">Anmeldung</h1>
        <p className="admin-login__hint">
          Dieser Bereich ist zugriffsgeschützt. Bitte mit den Zugangsdaten anmelden.
        </p>

        <div className="oral-field">
          <label htmlFor="login-username">Benutzername</label>
          <input
            id="login-username"
            name="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Benutzername"
            required
            disabled={loading}
          />
        </div>

        <div className="oral-field">
          <label htmlFor="login-password">Passwort</label>
          <div className="admin-login__pw">
            <input
              id="login-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Passwort"
              required
              disabled={loading}
            />
            <button
              type="button"
              className="admin-login__toggle"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
              aria-pressed={showPassword}
              disabled={loading}
            >
              {showPassword ? "Verbergen" : "Anzeigen"}
            </button>
          </div>
        </div>
        {error && (
          <p className="admin-login__error" role="alert">
            {error}
          </p>
        )}

        <button className="btn btn--primary admin-login__submit" type="submit" disabled={loading}>
          {loading ? "Anmelden …" : "Anmelden"}
        </button>

        <p className="admin-login__back">
          <Link href="/">← Zurück zur Startseite</Link>
        </p>
      </form>
    </div>
  );
}

export default function AdminLoginPage() {
  // useSearchParams() must be wrapped in a Suspense boundary for static
  // prerendering; the form itself is the only thing that needs it.
  return (
    <Suspense fallback={<div className="admin-login" />}>
      <AdminLoginForm />
    </Suspense>
  );
}
