"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/api";
import { writeCachedIdentity } from "@/lib/auth";

// useSearchParams() requires a Suspense boundary when the page is statically
// rendered, so the form lives in its own component.
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-page"><div className="login-card">Lädt …</div></div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If a session already exists, don't show the form again.
    api
      .me()
      .then(({ user }) => {
        writeCachedIdentity(user);
        router.replace(user.role === "admin" ? "/admin" : "/");
      })
      .catch(() => {});
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("Bitte Benutzername und Passwort eingeben.");
      return;
    }
    setSubmitting(true);
    try {
      const { user } = await api.login(username.trim(), password);
      writeCachedIdentity(user);
      // `next` is only honoured for a target the role may actually open, so a
      // crafted link cannot bounce a participant into an admin page.
      const target =
        next && (user.role === "admin" || next === "/" || next.startsWith("/muendliche-pruefung"))
          ? next
          : user.role === "admin"
            ? "/admin"
            : "/";
      router.replace(target);
    } catch (e: unknown) {
      setError(
        e instanceof ApiClientError && e.status === 401
          ? "Benutzername oder Passwort ist falsch, oder das Konto ist deaktiviert."
          : e instanceof ApiClientError
            ? e.message
            : "Anmeldung fehlgeschlagen.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit} aria-label="Anmeldung">
        <h1 className="login-card__title">Anmeldung</h1>
        <p className="login-card__subtitle">
          Bitte mit den Zugangsdaten anmelden. Der Zugriff ist auf die freigegebenen Bereiche
          beschränkt.
        </p>

        <div className="login-field">
          <label htmlFor="login-username">Benutzername</label>
          <input
            id="login-username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>

        <div className="login-field">
          <label htmlFor="login-password">Passwort</label>
          <input
            id="login-password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <button className="btn btn--primary login-submit" type="submit" disabled={submitting}>
          {submitting ? "Anmelden …" : "Anmelden"}
        </button>
        <p className="login-card__hint">
          Teilnehmer sehen die IHK-Übersicht und ihre eigenen mündlichen Prüfungen.{" "}
          <Link href="/">Zur Übersicht</Link>
        </p>
      </form>
    </div>
  );
}
