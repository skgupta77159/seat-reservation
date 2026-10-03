import { Router } from "express";
import { pool } from "../db/pool";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const { name, seats, price_paise } = req.body;

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        error: "invalid_name",
      });
    }

    if (!Array.isArray(seats) || seats.length === 0) {
      return res.status(400).json({
        error: "invalid_seats",
      });
    }

    const normalizedSeats = seats.map((seat) => String(seat).trim());

    if (normalizedSeats.some((seat) => !seat)) {
      return res.status(400).json({
        error: "invalid_seats",
      });
    }

    if (new Set(normalizedSeats).size !== normalizedSeats.length) {
      return res.status(400).json({
        error: "duplicate_seats",
      });
    }

    if (!Number.isSafeInteger(price_paise) || price_paise < 0) {
      return res.status(400).json({
        error: "invalid_price",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const showResult = await client.query(
        `
            INSERT INTO shows (
              name,
              price_paise,
              per_user_limit
            )
            VALUES ($1, $2, $3)
            RETURNING
              id,
              name,
              price_paise,
              per_user_limit
            `,
        [name.trim(), price_paise, Number(process.env.PER_USER_LIMIT || 4)],
      );

      const show = showResult.rows[0];

      for (const seatNumber of normalizedSeats) {
        await client.query(
          `
            INSERT INTO seats (
              show_id,
              seat_number,
              status
            )
            VALUES ($1, $2, 'available')
            `,
          [show.id, seatNumber],
        );
      }

      await client.query("COMMIT");

      return res.status(201).json({
        id: show.id,
        name: show.name,
        seats: normalizedSeats,
        price_paise: Number(show.price_paise),
        per_user_limit: show.per_user_limit,
      });
    } catch (error) {
      await client.query("ROLLBACK");

      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});


router.get("/:showId", async (req, res, next) => {
  try {
    const { showId } = req.params;

    const showResult = await pool.query(
      `
          SELECT
            id,
            name,
            price_paise,
            per_user_limit
          FROM shows
          WHERE id = $1
          `,
      [showId],
    );

    if (showResult.rowCount !== 1) {
      return res.status(404).json({
        error: "show_not_found",
      });
    }

    const seatsResult = await pool.query(
      `
          SELECT
            seat_number,
            status
          FROM seats
          WHERE show_id = $1
          ORDER BY seat_number
          `,
      [showId],
    );

    const counts = {
      available: 0,
      held: 0,
      confirmed: 0,
    };

    for (const seat of seatsResult.rows) {
      counts[seat.status as keyof typeof counts]++;
    }

    const total = seatsResult.rows.length;

    const reconciled =
      counts.available + counts.held + counts.confirmed === total;

    return res.json({
      id: showResult.rows[0].id,
      name: showResult.rows[0].name,
      price_paise: Number(showResult.rows[0].price_paise),
      per_user_limit: showResult.rows[0].per_user_limit,

      counts: {
        total,
        ...counts,
      },

      reconciliation: {
        valid: reconciled,
        expected: total,
        actual: counts.available + counts.held + counts.confirmed,
      },

      seats: seatsResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
