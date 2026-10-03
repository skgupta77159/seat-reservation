import { Router } from "express";

import { pool } from "../db/pool";
import { authenticate } from "../middleware/auth";

const router = Router();

router.post("/:reservationId/cancel", authenticate, async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { reservationId } = req.params;

    await client.query("BEGIN");

    const lookup = await client.query(
      `
          SELECT
            id,
            show_id,
            user_id,
            status
          FROM reservations
          WHERE id = $1
          `,
      [reservationId],
    );

    if (lookup.rowCount !== 1) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "reservation_not_found",
      });
    }

    const reservation = lookup.rows[0];

    if (reservation.user_id !== req.user!.id) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        error: "forbidden",
      });
    }

    /*
     * Lock user/show first.
     */
    await client.query(
      `
        INSERT INTO user_show_locks (
          show_id,
          user_id
        )
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        `,
      [reservation.show_id, req.user!.id],
    );

    await client.query(
      `
        SELECT 1
        FROM user_show_locks
        WHERE
          show_id = $1
          AND user_id = $2
        FOR UPDATE
        `,
      [reservation.show_id, req.user!.id],
    );

    /*
     * Lock reservation.
     */
    const lockedReservation = await client.query(
      `
          SELECT
            id,
            show_id,
            user_id,
            status
          FROM reservations
          WHERE id = $1
          FOR UPDATE
          `,
      [reservationId],
    );

    const current = lockedReservation.rows[0];

    if (current.status === "cancelled") {
      await client.query("COMMIT");

      return res.json({
        reservation_id: reservationId,
        status: "cancelled",
      });
    }

    /*
     * Lock seats in deterministic order.
     */
    const seatResult = await client.query(
      `
          SELECT
            s.id,
            s.seat_number,
            s.status
          FROM reservation_seats rs
          INNER JOIN seats s
            ON s.id = rs.seat_id
          WHERE
            rs.reservation_id = $1
          ORDER BY s.seat_number
          FOR UPDATE
          `,
      [reservationId],
    );

    const seatIds = seatResult.rows.map((seat) => seat.id);

    if (seatIds.length > 0) {
      await client.query(
        `
          UPDATE seats
          SET status = 'available'
          WHERE
            id = ANY($1::uuid[])
            AND status = 'confirmed'
          `,
        [seatIds],
      );
    }

    await client.query(
      `
        UPDATE reservations
        SET status = 'cancelled'
        WHERE id = $1
        `,
      [reservationId],
    );

    await client.query("COMMIT");

    return res.json({
      reservation_id: reservationId,
      status: "cancelled",
    });
  } catch (error) {
    await client.query("ROLLBACK");

    next(error);
  } finally {
    client.release();
  }
});

export default router;
