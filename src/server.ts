import { buildApp } from "./app/buildApp.js";
import { loadProcessEnvFiles, parseEnv } from "./config/env.js";

async function startServer() {
  loadProcessEnvFiles();
  const env = parseEnv(process.env);
  const app = buildApp({
    logger: true,
    env
  });
  const port = env.PORT;
  const host = env.HOST;

  const closeGracefully = async () => {
    await app.close();
    process.exit(0);
  };

  process.once("SIGINT", closeGracefully);
  process.once("SIGTERM", closeGracefully);

  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error, "Failed to start easy-api.");
    process.exit(1);
  }
}

await startServer();
