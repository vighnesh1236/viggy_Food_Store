import { createApplication } from "./app.js";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: process.env.ENV_FILE ?? path.resolve(process.cwd(), "../../.env") });
const { server, accountStore, orderStore, db } = createApplication();
const port = Number(process.env.PORT ?? 4000);

try {
  await Promise.all([accountStore.ready, orderStore.ready]);
  server.listen(port, "0.0.0.0", () => {
    console.log(
      `viggy_mart API listening on port ${port}; accounts use ${accountStore.kind} storage, ` +
      `and carts/orders use ${orderStore.kind} storage.`,
    );
  });
} catch (error) {
  console.error("Could not initialize application storage.", error);
  await Promise.allSettled([accountStore.close(), orderStore.close()]);
  db.close();
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void Promise.all([accountStore.close(), orderStore.close()]).then(() => {
        db.close();
        process.exit(0);
      });
    });
  });
}
