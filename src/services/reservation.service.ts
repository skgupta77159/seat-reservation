import { PoolClient } from "pg";

import { AppError } from "../errors";
import {
  reservationsConfirmed,
  reservationsDeclined,
} from "../metrics/metrics";

import { hashReservationRequest } from "../utils/hash";

interface ReserveInput {
  showId: string;
  userId: string;
  seats: string[];
  idempotencyKey: string;
}

interface ReservationResponse {
  reservation_id: string;
  show_id: string;
  user_id: string;
  seats: string[];
  amount_paise: number;
  status: "confirmed";
}

interface ReserveResult {
  status: number;
  body: unknown;
}

async function saveIdempotencyResult(
  client: PoolClient,
  input: ReserveInput,
  status: number,
  body: unknown,
  reservationId: string | null = null,
) {
  await client.query(
    `
    UPDATE idempotency_keys
    SET
      result_status = $1,
      result_body = $2,
      reservation_id = $3
    WHERE
      user_id = $4
      AND show_id = $5
      AND idempotency_key = $6
    `,
    [
      status,
      JSON.stringify(body),
      reservationId,
      input.userId,
      input.showId,
      input.idempotencyKey,
    ],
  );
}

export async function reserveSeats(
  client: PoolClient,
  input: ReserveInput,
): Promise<ReserveResult> {
  const sortedSeats = [...input.seats].sort();

  const requestHash = hashReservationRequest(sortedSeats);

  const showExistsResult = await client.query(
    `
    SELECT 1
    FROM shows
    WHERE id = $1
    `,
    [input.showId],
  );

  if (showExistsResult.rowCount !== 1) {
    const body = {
      error: "show_not_found",
    };

    await saveIdempotencyResult(client, input, 404, body);

    return {
      status: 404,
      body,
    };
  }

  /*
   * STEP 1
   *
   * Atomically claim/create the idempotency key.
   *
   * If another transaction is already processing the same key,
   * PostgreSQL's unique constraint makes this operation wait.
   */
  await client.query(
    `
    INSERT INTO idempotency_keys (
      user_id,
      show_id,
      idempotency_key,
      request_hash
    )
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (
      user_id,
      show_id,
      idempotency_key
    )
    DO NOTHING
    `,
    [input.userId, input.showId, input.idempotencyKey, requestHash],
  );

  /*
   * Lock the idempotency row.
   */
  const idempotencyResult = await client.query(
    `
    SELECT
      request_hash,
      result_status,
      result_body,
      reservation_id
    FROM idempotency_keys
    WHERE
      user_id = $1
      AND show_id = $2
      AND idempotency_key = $3
    FOR UPDATE
    `,
    [input.userId, input.showId, input.idempotencyKey],
  );

  if (idempotencyResult.rowCount !== 1) {
    throw new Error("Failed to create idempotency record");
  }

  const idempotency = idempotencyResult.rows[0];

  /*
   * Same key + different request body.
   */
  if (idempotency.request_hash !== requestHash) {
    throw new AppError("idempotency_conflict", 409);
  }

  /*
   * Already completed/rejected.
   *
   * This is the critical replay path.
   */
  if (idempotency.result_status !== null) {
    reservationsDeclined.inc({
      reason: "idempotent_replay",
    });

    return {
      status: 200,
      body: idempotency.result_body,
    };
  }

  /*
   * STEP 2
   *
   * Lock the user/show row.
   *
   * This serializes concurrent reservations from the same user.
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
    [input.showId, input.userId],
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
    [input.showId, input.userId],
  );

  /*
   * STEP 3
   *
   * Load show.
   */
  const showResult = await client.query(
    `
    SELECT
      id,
      name,
      price_paise,
      per_user_limit
    FROM shows
    WHERE id = $1
    `,
    [input.showId],
  );

  if (showResult.rowCount !== 1) {
    const body = {
      error: "show_not_found",
    };

    await saveIdempotencyResult(client, input, 404, body);

    return {
      status: 404,
      body,
    };
  }

  const show = showResult.rows[0];

  /*
   * STEP 4
   *
   * Enforce per-user limit while user/show row is locked.
   */
  const currentSeatsResult = await client.query(
    `
    SELECT COUNT(*)::integer AS count
    FROM reservation_seats rs
    INNER JOIN reservations r
      ON r.id = rs.reservation_id
    WHERE
      r.show_id = $1
      AND r.user_id = $2
      AND r.status = 'confirmed'
    `,
    [input.showId, input.userId],
  );

  const currentSeatCount = Number(currentSeatsResult.rows[0].count);

  const requestedSeatCount = sortedSeats.length;

  const perUserLimit = Number(show.per_user_limit);

  if (currentSeatCount + requestedSeatCount > perUserLimit) {
    const body = {
      error: "per_user_limit",
      limit: perUserLimit,
    };

    await saveIdempotencyResult(client, input, 409, body);

    reservationsDeclined.inc({
      reason: "per_user_limit",
    });

    return {
      status: 409,
      body,
    };
  }

  /*
   * STEP 5
   *
   * Lock ALL requested seats in deterministic order.
   *
   * This prevents deadlocks for requests such as:
   *
   * Request A -> A1,A2
   * Request B -> A2,A1
   *
   * because both become:
   *
   * A1,A2
   */
  const seatsResult = await client.query(
    `
    SELECT
      id,
      seat_number,
      status
    FROM seats
    WHERE
      show_id = $1
      AND seat_number = ANY($2::text[])
    ORDER BY seat_number
    FOR UPDATE
    `,
    [input.showId, sortedSeats],
  );

  /*
   * Missing seat.
   */
  if (seatsResult.rowCount !== sortedSeats.length) {
    const body = {
      error: "seat_not_found",
    };

    await saveIdempotencyResult(client, input, 400, body);

    return {
      status: 400,
      body,
    };
  }

  /*
   * STEP 6
   *
   * Because every seat is now locked,
   * nobody can change its state until we finish.
   */
  const unavailableSeat = seatsResult.rows.find(
    (seat) => seat.status !== "available",
  );

  if (unavailableSeat) {
    const body = {
      error: "seat_taken",
      seat: unavailableSeat.seat_number,
    };

    await saveIdempotencyResult(client, input, 409, body);

    reservationsDeclined.inc({
      reason: "seat_taken",
    });

    return {
      status: 409,
      body,
    };
  }

  /*
   * STEP 7
   *
   * Calculate amount using integer arithmetic.
   */
  const pricePaise = BigInt(show.price_paise);

  const amountBig = pricePaise * BigInt(sortedSeats.length);

  if (amountBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError("amount_too_large", 400);
  }

  const amountPaise = Number(amountBig);

  /*
   * STEP 8
   *
   * Create reservation.
   */
  const reservationResult = await client.query(
    `
    INSERT INTO reservations (
      show_id,
      user_id,
      amount_paise,
      status
    )
    VALUES ($1, $2, $3, 'confirmed')
    RETURNING id
    `,
    [input.showId, input.userId, amountPaise],
  );

  const reservationId = reservationResult.rows[0].id;

  /*
   * STEP 9
   *
   * Mark seats confirmed.
   */
  const seatIds = seatsResult.rows.map((seat) => seat.id);

  await client.query(
    `
    UPDATE seats
    SET status = 'confirmed'
    WHERE id = ANY($1::uuid[])
    `,
    [seatIds],
  );

  /*
   * STEP 10
   *
   * Link seats to reservation.
   */
  for (const seatId of seatIds) {
    await client.query(
      `
      INSERT INTO reservation_seats (
        reservation_id,
        seat_id
      )
      VALUES ($1, $2)
      `,
      [reservationId, seatId],
    );
  }

  const response: ReservationResponse = {
    reservation_id: reservationId,
    show_id: input.showId,
    user_id: input.userId,
    seats: sortedSeats,
    amount_paise: amountPaise,
    status: "confirmed",
  };

  /*
   * STEP 11
   *
   * Store the original response atomically
   * with the reservation.
   */
  await saveIdempotencyResult(client, input, 201, response, reservationId);

  reservationsConfirmed.inc();

  return {
    status: 201,
    body: response,
  };
}
