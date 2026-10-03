import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

import { pool } from "../db/pool";

export const registry = new Registry();

collectDefaultMetrics({
  register: registry,
});

export const reservationsConfirmed = new Counter({
  name: "reservations_confirmed_total",
  help: "Total confirmed reservations",
  registers: [registry],
});

export const reservationsDeclined = new Counter({
  name: "reservations_declined_total",
  help: "Total declined/replayed reservation requests",
  labelNames: ["reason"],
  registers: [registry],
});

export const reservationDuration = new Histogram({
  name: "reservation_duration_seconds",
  help: "Reservation request duration",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [registry],
});

export const seatsAvailable = new Gauge({
  name: "seats_available",
  help: "Currently available seats",
  labelNames: ["show_id"],
  registers: [registry],
});

export async function refreshAvailableSeatMetrics() {
  const result = await pool.query(`
    SELECT
      show_id,
      COUNT(*) FILTER (
        WHERE status = 'available'
      )::integer AS available
    FROM seats
    GROUP BY show_id
  `);

  for (const row of result.rows) {
    seatsAvailable.set(
      {
        show_id: row.show_id,
      },
      Number(row.available),
    );
  }
}
