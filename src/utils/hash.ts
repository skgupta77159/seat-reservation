import crypto from "node:crypto";

export function hashReservationRequest(seats: string[]) {
  const normalized = [...seats].sort();

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        seats: normalized
      })
    )
    .digest("hex");
}