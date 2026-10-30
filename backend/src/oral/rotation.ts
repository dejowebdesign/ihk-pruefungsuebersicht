// Persistent, evenly rotating selection of the 13th question's theme.
//
// The rotation counter lives in the database (OralRotationState, a single row)
// and is advanced with an atomic `increment`, so:
//   - it survives restarts (the rotation never restarts at Datenschutz), and
//   - parallel exam starts cannot hand out the same slot twice: the UPDATE is
//     serialised by the database, and each caller gets a distinct counter value.
//
// `advanceRotation` must be called INSIDE the exam-creation transaction so a
// failed creation rolls the counter back instead of burning a slot.

import type { PrismaClient } from "@prisma/client";
import { rotationThemeFor } from "./themes";

/** Fixed id of the single rotation-state row. */
export const ROTATION_STATE_ID = "oral-rotation";

type Db = PrismaClient;
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Advance the rotation and return the theme for this exam's 13th question.
 * Atomic: the counter is incremented by the database, and the value returned is
 * the one this call produced.
 */
export async function advanceRotation(db: Db | Tx): Promise<{ theme: string; counter: number }> {
  const client = db as Tx;
  const state = await client.oralRotationState.upsert({
    where: { id: ROTATION_STATE_ID },
    create: { id: ROTATION_STATE_ID, counter: 1 },
    update: { counter: { increment: 1 } },
  });
  // First call creates counter=1 -> index 0; so use counter-1 as the index.
  return { theme: rotationThemeFor(state.counter - 1), counter: state.counter };
}

/** Read the current counter without advancing it (diagnostics/tests). */
export async function readRotation(db: Db | Tx): Promise<number> {
  const client = db as Tx;
  const state = await client.oralRotationState.findUnique({ where: { id: ROTATION_STATE_ID } });
  return state?.counter ?? 0;
}
