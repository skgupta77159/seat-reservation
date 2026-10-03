import express from "express";
import crypto from "node:crypto";
import pino from "pino";

import showsRouter from "./routes/shows";
import reserveRouter from "./routes/reservations";
import cancellationsRouter from "./routes/cancellations";
import healthRouter from "./routes/health";

import { registry, refreshAvailableSeatMetrics } from "./metrics/metrics";

const logger = pino();

export const app = express();

app.use(
  express.json({
    limit: "1mb",
  }),
);

app.use((req, res, next) => {
  const requestId = req.header("x-request-id") ?? crypto.randomUUID();

  req.requestId = requestId;

  res.setHeader("x-request-id", requestId);

  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;

    logger.info(
      {
        request_id: requestId,
        method: req.method,
        path: req.path,
        status_code: res.statusCode,
        duration_ms: Number(durationMs.toFixed(2)),
      },
      "http_request",
    );
  });

  next();
});

/*
 * Health
 */
app.use("/health", healthRouter);

/*
 * Show creation + show details
 */
app.use("/shows", showsRouter);

/*
 * Reservation creation:
 *
 * POST /shows/:showId/reserve
 * POST /reservations
 */
app.use("/shows", reserveRouter);
app.use("/reservations", reserveRouter);

/*
 * Cancellation:
 *
 * POST /reservations/:reservationId/cancel
 */
app.use("/reservations", cancellationsRouter);

/*
 * Metrics
 */
app.get("/metrics", async (_req, res, next) => {
  try {
    await refreshAvailableSeatMetrics();

    res.setHeader("Content-Type", registry.contentType);

    res.end(await registry.metrics());
  } catch (error) {
    next(error);
  }
});

/*
 * 404
 */
app.use((_req, res) => {
  res.status(404).json({
    error: "not_found",
  });
});

/*
 * Error handler
 */
app.use(
  (
    error: unknown,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (res.headersSent) {
      return next(error);
    }

    logger.error(
      {
        request_id: req.requestId,
        error: error instanceof Error ? error.message : String(error),
      },
      "unhandled_error",
    );

    res.status(500).json({
      error: "internal_server_error",
      request_id: req.requestId,
    });
  },
);
