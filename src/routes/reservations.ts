import { Router } from "express";
import { pool } from "../db/pool";
import { authenticate } from "../middleware/auth";
import { reserveSeats } from "../services/reservation.service";
import { AppError } from "../errors";
import { reservationDuration } from "../metrics/metrics";

const reserveRouter = Router();

function getShowId(req: any) {
  const routeShowId = req.params?.showId;
  const bodyShowId = req.body?.show_id ?? req.body?.showId;

  if (typeof bodyShowId === "string" && bodyShowId.trim()) {
    return bodyShowId.trim();
  }

  if (Array.isArray(routeShowId)) {
    return routeShowId[0]?.trim() ?? "";
  }

  return typeof routeShowId === "string" ? routeShowId.trim() : "";
}

function getIdempotencyKey(req: any) {
  const bodyKey = req.body?.idempotency_key ?? req.body?.idempotencyKey;
  const headerKey = req.header("idempotency-key") ?? req.header("Idempotency-Key");

  if (typeof bodyKey === "string" && bodyKey.trim()) {
    return bodyKey.trim();
  }

  return typeof headerKey === "string" ? headerKey.trim() : "";
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function handleReservationRequest(req: any, res: any, next: any) {
  const timer = reservationDuration.startTimer();
  const client = await pool.connect();

  try {
    const showId = getShowId(req);
    const { seats } = req.body ?? {};
    const idempotencyKey = getIdempotencyKey(req);

    if (!showId) {
      return res.status(400).json({
        error: "show_id_required",
      });
    }

    if (!isValidUuid(showId)) {
      return res.status(400).json({
        error: "invalid_show_id",
      });
    }

    if (!Array.isArray(seats) || seats.length === 0) {
      return res.status(400).json({
        error: "seats_required",
      });
    }

    if (seats.length > Number(process.env.PER_USER_LIMIT || 4)) {
      return res.status(409).json({
        error: "per_user_limit",
      });
    }

    const normalizedSeats = seats.map((seat: unknown) => String(seat).trim());

    if (normalizedSeats.some((seat: string) => !seat)) {
      return res.status(400).json({
        error: "invalid_seats",
      });
    }

    if (new Set(normalizedSeats).size !== normalizedSeats.length) {
      return res.status(400).json({
        error: "duplicate_seats",
      });
    }

    if (!idempotencyKey) {
      return res.status(400).json({
        error: "idempotency_key_required",
      });
    }

    await client.query("BEGIN");

    const result = await reserveSeats(client, {
      showId,
      userId: req.user!.id,
      seats: normalizedSeats,
      idempotencyKey,
    });

    await client.query("COMMIT");

    return res.status(result.status).json(result.body);
  } catch (error) {
    await client.query("ROLLBACK");

    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        error: error.code,
      });
    }

    const pgError = error as { code?: string };
    if (pgError.code === "23503") {
      return res.status(404).json({
        error: "show_not_found",
      });
    }

    next(error);
  } finally {
    timer();
    client.release();
  }
}

reserveRouter.post("/", authenticate, handleReservationRequest);
reserveRouter.post("/:showId/reserve", authenticate, handleReservationRequest);

export default reserveRouter;
