import type { FastifyPluginAsync } from "fastify";

import type { EasyApiServices } from "../../app/appServices.js";
import { buildCapabilitiesSummary } from "../../modules/catalog/buildCapabilitiesSummary.js";

interface CapabilitiesRouteOptions {
  services: EasyApiServices;
}

export const registerCapabilitiesRoutes: FastifyPluginAsync<CapabilitiesRouteOptions> = async (
  app,
  options
) => {
  app.get("/v1/capabilities", async () => {
    const snapshot =
      (await options.services.catalogRepository.getSnapshot()) ??
      (await options.services.catalogSyncService?.sync()) ??
      null;

    return buildCapabilitiesSummary(snapshot);
  });
};
