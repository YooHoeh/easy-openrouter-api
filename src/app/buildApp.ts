import Fastify, { type FastifyInstance } from "fastify";

import { parseEnv, type EnvInput } from "../config/env.js";
import { buildDefaultServices, type EasyApiServices } from "./appServices.js";
import { buildFastifyLoggerOptions } from "../modules/telemetry/logger.js";
import { combineRequestTelemetrySinks } from "../modules/telemetry/requestTelemetrySink.js";
import { registerHealthRoutes } from "../routes/health.js";
import { registerCapabilitiesRoutes } from "../routes/v1/capabilities.js";
import { registerChatCompletionsRoutes } from "../routes/v1/chatCompletions.js";
import { registerMetricsRoutes } from "../routes/v1/metrics.js";
import { registerModelsRoutes } from "../routes/v1/models.js";
import { registerResponsesRoutes } from "../routes/v1/responses.js";
import { registerRouteDebugRoutes } from "../routes/v1/routeDebug.js";

export interface BuildAppOptions {
  logger?: boolean;
  services?: Partial<EasyApiServices>;
  env?: EnvInput;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const env = parseEnv({
    ...process.env,
    ...options.env
  });
  const app = Fastify({
    logger: buildFastifyLoggerOptions(options.logger ?? false, env.LOG_LEVEL)
  });
  const defaultServices = buildDefaultServices(
    {
      ...(env.OPENROUTER_API_KEY
        ? {
            openRouterApiKey: env.OPENROUTER_API_KEY
          }
        : {}),
      ...(env.TELEMETRY_REQUEST_LOG_PATH
        ? {
            telemetryRequestLogPath: env.TELEMETRY_REQUEST_LOG_PATH
          }
        : {})
    }
  );
  const overriddenRepository = options.services?.catalogRepository;
  const mergedServices: EasyApiServices = {
    ...defaultServices,
    ...options.services,
    ...(overriddenRepository && !options.services?.catalogSyncService
      ? {
          catalogSyncService: null
        }
      : {})
  };
  const services: EasyApiServices = {
    ...mergedServices,
    requestTelemetrySink:
      options.services?.requestTelemetrySink === undefined
        ? (mergedServices.requestTelemetrySink ?? null)
        : combineRequestTelemetrySinks([
            mergedServices.requestMetricsCollector,
            options.services.requestTelemetrySink
          ])
  };

  app.register(registerHealthRoutes);
  app.register(registerModelsRoutes, {
    services
  });
  app.register(registerCapabilitiesRoutes, {
    services
  });
  app.register(registerMetricsRoutes, {
    services
  });
  app.register(registerRouteDebugRoutes, {
    services,
    env
  });
  app.register(registerChatCompletionsRoutes, {
    services,
    env
  });
  app.register(registerResponsesRoutes, {
    services,
    env
  });

  return app;
}
