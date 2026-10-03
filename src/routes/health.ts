import { Router } from "express";
import { pool } from "../db/pool";

const router = Router();

router.get("/live", (_req, res) => {
  res.json({
    status: "ok",
  });
});

router.get("/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ready",
    });
  } catch {
    res.status(503).json({
      status: "not_ready",
    });
  }
});

export default router;
