// Tests for the admin login page.
//
// Verifies the required UI behaviours: username + password fields, password
// show/hide toggle, loading state, and a friendly error message on invalid
// credentials. `next/navigation` and the API client are stubbed so the test
// exercises the page's own logic (no network).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
// Mutable `next` query value so tests can exercise the return-to-page logic.
let nextParam: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nextParam ? { next: nextParam } : {}),
}));

const authMe = vi.fn();
const authLogin = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { ...actual.api, authMe: () => authMe(), authLogin: (u: string, p: string) => authLogin(u, p) },
  };
});

import AdminLoginPage from "@/app/admin/login/page";
import { ApiClientError } from "@/lib/api";

beforeEach(() => {
  replace.mockReset();
  nextParam = null;
  authMe.mockReset().mockResolvedValue({ authenticated: false, username: null });
  authLogin.mockReset();
});

describe("admin login page", () => {
  it("renders username, password and submit fields", async () => {
    render(<AdminLoginPage />);
    expect(screen.getByLabelText("Benutzername")).toBeInTheDocument();
    expect(screen.getByLabelText("Passwort")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anmelden" })).toBeInTheDocument();
  });

  it("toggles password visibility", async () => {
    const user = userEvent.setup();
    render(<AdminLoginPage />);
    const pw = screen.getByLabelText("Passwort") as HTMLInputElement;
    expect(pw.type).toBe("password");
    await user.click(screen.getByRole("button", { name: "Passwort anzeigen" }));
    expect((screen.getByLabelText("Passwort") as HTMLInputElement).type).toBe("text");
    await user.click(screen.getByRole("button", { name: "Passwort verbergen" }));
    expect((screen.getByLabelText("Passwort") as HTMLInputElement).type).toBe("password");
  });

  it("logs in with valid credentials and redirects to the start page", async () => {
    const user = userEvent.setup();
    authLogin.mockResolvedValue({ ok: true, username: "admin" });
    render(<AdminLoginPage />);
    await user.type(screen.getByLabelText("Benutzername"), "admin");
    await user.type(screen.getByLabelText("Passwort"), "dbasicherheit26");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    await waitFor(() => expect(authLogin).toHaveBeenCalledWith("admin", "dbasicherheit26"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("returns to the originally requested page after login", async () => {
    const user = userEvent.setup();
    nextParam = "/muendliche-pruefung";
    authLogin.mockResolvedValue({ ok: true, username: "admin" });
    render(<AdminLoginPage />);
    await user.type(screen.getByLabelText("Benutzername"), "admin");
    await user.type(screen.getByLabelText("Passwort"), "dbasicherheit26");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/muendliche-pruefung"));
  });

  it("ignores an external next target (no open redirect)", async () => {
    const user = userEvent.setup();
    nextParam = "https://evil.example.com/steal";
    authLogin.mockResolvedValue({ ok: true, username: "admin" });
    render(<AdminLoginPage />);
    await user.type(screen.getByLabelText("Benutzername"), "admin");
    await user.type(screen.getByLabelText("Passwort"), "dbasicherheit26");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(replace).not.toHaveBeenCalledWith("https://evil.example.com/steal");
  });

  it("ignores a protocol-relative next target (no open redirect)", async () => {
    const user = userEvent.setup();
    nextParam = "//evil.example.com";
    authLogin.mockResolvedValue({ ok: true, username: "admin" });
    render(<AdminLoginPage />);
    await user.type(screen.getByLabelText("Benutzername"), "admin");
    await user.type(screen.getByLabelText("Passwort"), "dbasicherheit26");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("shows a friendly error on invalid credentials", async () => {
    const user = userEvent.setup();
    authLogin.mockRejectedValue(new ApiClientError("invalid credentials", 401));
    render(<AdminLoginPage />);
    await user.type(screen.getByLabelText("Benutzername"), "admin");
    await user.type(screen.getByLabelText("Passwort"), "falsch");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Benutzername oder Passwort ist falsch.");
  });

  it("shows a rate-limit message on 429", async () => {
    const user = userEvent.setup();
    authLogin.mockRejectedValue(new ApiClientError("too many", 429));
    render(<AdminLoginPage />);
    await user.type(screen.getByLabelText("Benutzername"), "admin");
    await user.type(screen.getByLabelText("Passwort"), "x");
    await user.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Zu viele Fehlversuche");
  });

  it("redirects to the requested page when already authenticated", async () => {
    nextParam = "/fragen";
    authMe.mockResolvedValue({ authenticated: true, username: "admin" });
    render(<AdminLoginPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/fragen"));
  });
});
