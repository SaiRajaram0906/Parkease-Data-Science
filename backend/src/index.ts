import app from "./app";
import { logger } from "./lib/logger";
import { startBackgroundTasks } from "./lib/tasks";
import { ensureDataScienceColumns } from "./lib/dsSchema";
import { ensureBigPlaces } from "./lib/places";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Add the optional Data Science link columns before anything queries them.
  ensureDataScienceColumns()
    .then(() => ensureBigPlaces())
    .catch(() => logger.error("New database columns are missing; some routes may fail"))
    .finally(() => startBackgroundTasks());
});
