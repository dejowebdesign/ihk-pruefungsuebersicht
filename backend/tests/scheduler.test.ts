import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the live importer BEFORE importing the scheduler, so the scheduler's
// importInProgress mutex can be tested without real network calls.
vi.mock("../src/importer/live-import", () => ({
  runLiveImport: vi.fn(),
}));

import { runLiveImport } from "../src/importer/live-import";
import {
  triggerImport,
  isImportRunning,
  importIntervalHours,
  startScheduler,
  stopScheduler,
} from "../src/scheduler/scheduler";

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
