import type { FastifyPluginAsync } from "fastify";

import type { EasyApiServices } from "../../app/appServices.js";
import { formatRequestMetricsPrometheus } from "../../modules/telemetry/requestMetrics.js";

interface MetricsRouteOptions {
  services: EasyApiServices;
}

interface MetricsQuerystring {
  format?: string;
}

export const registerMetricsRoutes: FastifyPluginAsync<MetricsRouteOptions> = async (
  app,
  options
) => {
  app.get("/v1/metrics", async (request, reply) => {
    const summary = options.services.requestMetricsCollector.getSummary();
    const format = (request.query as MetricsQuerystring | undefined)?.format;

    if (format === "prometheus") {
      return reply
        .header("content-type", "text/plain; version=0.0.4; charset=utf-8")
        .send(formatRequestMetricsPrometheus(summary));
    }

    return summary;
  });
};
