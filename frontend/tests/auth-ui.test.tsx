import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IDENTITY_CACHE_KEY } from "@/lib/auth";

// The Header uses the App Router hooks; these tests render it outside a real
// Next.js router, so the navigation module is stubbed.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Real timers: userEvent and fake timers deadlock against each other.

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="Prüfung löschen?"
        message="Text"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an accessible alertdialog when open", () => {
    render(
      <ConfirmDialog
        open
        title="Prüfung löschen?"
        message={<p>Die Prüfung wird entfernt.</p>}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Prüfung löschen?")).toBeInTheDocument();
    expect(screen.getByText("Die Prüfung wird entfernt.")).toBeInTheDocument();
  });

  it("does not call onConfirm until the user explicitly confirms", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Löschen?"
        message="Sicher?"
        confirmLabel="Löschen"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    // Merely rendering must not delete anything.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onConfirm when the confirm button is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Löschen?"
        message="Sicher?"
        confirmLabel="Löschen"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Löschen" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel from the cancel button and never onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Löschen?"
        message="Sicher?"
        confirmLabel="Löschen"
        cancelLabel="Abbrechen"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels on Escape", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Löschen?"
        message="Sicher?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("focuses the safe option, so a stray Enter cancels instead of deleting", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Löschen?"
        message="Sicher?"
        confirmLabel="Löschen"
        cancelLabel="Abbrechen"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("button", { name: "Abbrechen" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="X" message="Y" onConfirm={() => {}} onCancel={onCancel} />,
    );
    await user.click(screen.getByRole("presentation"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("disables both actions while busy", () => {
    render(
      <ConfirmDialog
        open
        busy
        title="Löschen?"
        message="Sicher?"
        confirmLabel="Löschen"
        cancelLabel="Abbrechen"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Lösche …" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Abbrechen" })).toBeDisabled();
  });
});

describe("identity cache storage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("keeps only non-sensitive identity fields", async () => {
    const { writeCachedIdentity, readCachedIdentity } = await import("@/lib/auth");
    writeCachedIdentity({ id: "u1", username: "anna", role: "examiner", active: true });
    const stored = JSON.parse(localStorage.getItem(IDENTITY_CACHE_KEY)!);
    expect(Object.keys(stored).sort()).toEqual(["active", "id", "role", "username"]);
    expect(readCachedIdentity()?.username).toBe("anna");
  });

  it("notifies subscribers so a login updates the already-mounted header", async () => {
    const { writeCachedIdentity, clearCachedIdentity, subscribeIdentity } = await import(
      "@/lib/auth"
    );
    const seen: Array<string | null> = [];
    const unsubscribe = subscribeIdentity((u) => seen.push(u?.username ?? null));

    writeCachedIdentity({ id: "a", username: "admin", role: "admin", active: true });
    expect(seen).toEqual(["admin"]);

    clearCachedIdentity();
    expect(seen).toEqual(["admin", null]);

    // Unsubscribing stops further notifications.
    unsubscribe();
    writeCachedIdentity({ id: "b", username: "bea", role: "examiner", active: true });
    expect(seen).toEqual(["admin", null]);
  });
});

describe("Header session area", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("shows the sign-in link for an anonymous visitor", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "unauthorized" }),
    } as unknown as Response);

    const { Header } = await import("@/components/Header");
    render(<Header />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Anmelden" })).toBeInTheDocument());
  });

  it("shows the examiner's role and a sign-out button", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          user: { id: "u1", username: "anna", role: "examiner", active: true },
        }),
    } as unknown as Response);

    const { Header } = await import("@/components/Header");
    render(<Header />);
    // The header shows the role badge only — the account name is not displayed.
    await waitFor(() => expect(screen.getByText("Prüfer")).toBeInTheDocument());
    expect(screen.queryByText("anna")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abmelden" })).toBeInTheDocument();
  });

  it("hides admin-only navigation from an examiner", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          user: { id: "u1", username: "anna", role: "examiner", active: true },
        }),
    } as unknown as Response);

    const { Header } = await import("@/components/Header");
    render(<Header />);
    await waitFor(() => expect(screen.getByText("Prüfer")).toBeInTheDocument());

    // The areas examiners may not use are not offered at all.
    expect(screen.queryByRole("link", { name: "Verwaltung" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Fragen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Fallbeispiele" })).not.toBeInTheDocument();
    // The compare page is gone entirely, so it is offered to nobody.
    expect(screen.queryByRole("link", { name: "Vergleich" })).not.toBeInTheDocument();
    // The permitted areas are present.
    expect(screen.getByRole("link", { name: "IHKs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mündliche Prüfung" })).toBeInTheDocument();
  });

  it("shows the full navigation to an admin", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ user: { id: "a", username: "admin", role: "admin", active: true } }),
    } as unknown as Response);

    const { Header } = await import("@/components/Header");
    render(<Header />);
    await waitFor(() => expect(screen.getByText("Administrator")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Verwaltung" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fragen" })).toBeInTheDocument();
  });

  it("drops to the signed-out state when the server rejects the session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "unauthorized" }),
    } as unknown as Response);

    // A stale cache entry must not keep the UI claiming an admin session.
    localStorage.setItem(
      IDENTITY_CACHE_KEY,
      JSON.stringify({ id: "a", username: "admin", role: "admin", active: true }),
    );

    const { Header } = await import("@/components/Header");
    render(<Header />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Anmelden" })).toBeInTheDocument());
    expect(localStorage.getItem(IDENTITY_CACHE_KEY)).toBeNull();
  });
});
