import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the live importer BEFORE importing the scheduler, so the scheduler's
// importInProgress mutex can be tested without real network calls.
vi.mock("../src/importer/live-import", () => ({
  runLiveImport: vi.fn(),
}));

// Mock prisma so maybeInitialImport's "has prior SUCCESS run" check can be
// exercised without a real database. The findFirst mock is reachable through
// prisma().importRun.findFirst (the same path the scheduler uses).
vi.mock("../src/db/prisma", () => {
  const findFirst = vi.fn();
  return {
    prisma: () => ({ importRun: { findFirst } }),
    disconnectPrisma: vi.fn(),
  };
});

import { runLiveImport } from "../src/importer/live-import";
import { prisma } from "../src/db/prisma";
import {
  triggerImport,
  isImportRunning,
  importIntervalHours,
  startScheduler,
  stopScheduler,
  maybeInitialImport,
} from "../src/scheduler/scheduler";

// Resolve the findFirst mock through the same prisma() path the scheduler uses.
const findFirstMock = (prisma() as unknown as {
  importRun: { findFirst: ReturnType<typeof vi.fn> };
}).importRun.findFirst;

describe("scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopScheduler();
    // Reset the internal mutex by ensuring no import is running.
    expect(isImportRunning()).toBe(false);
  });

  it("reads IMPORT_INTERVAL_HOURS (default 6)", () => {
    const saved = process.env.IMPORT_INTERVAL_HOURS;
    delete process.env.IMPORT_INTERVAL_HOURS;
    expect(importIntervalHours()).toBe(6);
    process.env.IMPORT_INTERVAL_HOURS = "3";
    expect(importIntervalHours()).toBe(3);
    process.env.IMPORT_INTERVAL_HOURS = "garbage";
    expect(importIntervalHours()).toBe(6);
    if (saved !== undefined) process.env.IMPORT_INTERVAL_HOURS = saved;
  });

  it("triggers a single import via the live importer", async () => {
    (runLiveImport as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "SUCCESS",
      sheetsImported: 85,
    });
    const result = await triggerImport();
    expect(runLiveImport).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "SUCCESS", sheetsImported: 85 });
    expect(isImportRunning()).toBe(false);
  });

  it("prevents a second parallel import (mutex)", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    const firstPromise = new Promise((r) => (resolveFirst = r));
    (runLiveImport as ReturnType<typeof vi.fn>).mockReturnValue(firstPromise);

    const first = triggerImport();
    // First is now running.
    expect(isImportRunning()).toBe(true);

    // Second trigger must be skipped, NOT start a parallel import.
    const second = await triggerImport();
    expect(second).toEqual({ skipped: true, reason: "import already running" });
    expect(runLiveImport).toHaveBeenCalledTimes(1); // only one call

    // Release the first.
    resolveFirst({ status: "SUCCESS" });
    const firstResult = await first;
    expect(firstResult).toMatchObject({ status: "SUCCESS" });
    expect(isImportRunning()).toBe(false);
  });

  it("releases the mutex even if the import throws", async () => {
    (runLiveImport as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    await expect(triggerImport()).rejects.toThrow("boom");
    expect(isImportRunning()).toBe(false);

    // A subsequent import can start again.
    (runLiveImport as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "SUCCESS" });
    const r = await triggerImport();
    expect(r).toMatchObject({ status: "SUCCESS" });
  });

  it("startScheduler/stopScheduler manage the interval handle", () => {
    const h = startScheduler();
    expect(typeof h).toBe("object");
    // Calling start again returns the same handle (no duplicate).
    const h2 = startScheduler();
    expect(h2).toBe(h);
    stopScheduler();
    // After stop, start creates a fresh handle.
    const h3 = startScheduler();
    expect(h3).not.toBe(h);
    stopScheduler();
  });
});

describe("maybeInitialImport (bootstrap)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopScheduler();
    expect(isImportRunning()).toBe(false);
  });

  it("triggers an import when no prior SUCCESS run exists", async () => {
    (runLiveImport as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "SUCCESS",
      sheetsImported: 85,
    });
    findFirstMock.mockResolvedValue(null); // empty DB
    const result = await maybeInitialImport();
    expect(findFirstMock).toHaveBeenCalledTimes(1);
    expect(runLiveImport).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "SUCCESS", sheetsImported: 85 });
  });

  it("skips the import when a SUCCESS run already exists", async () => {
    findFirstMock.mockResolvedValue({ id: "existing", status: "SUCCESS" });
    const result = await maybeInitialImport();
    expect(runLiveImport).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: true, reason: "data already present" });
  });

  it("does not crash when the availability check fails (defers to scheduler)", async () => {
    findFirstMock.mockRejectedValue(new Error("db not ready"));
    const result = await maybeInitialImport();
    expect(runLiveImport).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
