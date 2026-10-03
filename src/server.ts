import dotenv from "dotenv";

dotenv.config();

import { app } from "./app";
import { pool } from "./db/pool";
import { migrate } from "./db/migrate";

async function start() {
  await migrate();

  const port = Number(process.env.PORT || 3000);

  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on port ${port}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received`);

    server.close(async () => {
      await pool.end();

      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch(async (error) => {
  console.error("Failed to start server", error);

  await pool.end();

  process.exit(1);
});
