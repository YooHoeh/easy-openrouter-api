import { InMemoryCatalogRepository, type CatalogRepository } from "../modules/catalog/catalogRepository.js";
import {
  CatalogSyncService,
  type OpenRouterCatalogClient
} from "../modules/catalog/catalogSync.js";
import type { CatalogSnapshot } from "../modules/catalog/catalogTypes.js";
import { OpenRouterClient } from "../modules/catalog/openrouterClient.js";
import {
  OpenRouterExecutionClient,
  type ChatCompletionsExecutor
} from "../modules/adapters/openrouter/openrouterExecutionClient.js";
import {
  createRequestTelemetrySink,
  combineRequestTelemetrySinks,
  type RequestTelemetrySink
} from "../modules/telemetry/requestTelemetrySink.js";
import {
  InMemoryRequestMetricsCollector,
  type RequestMetricsCollector
} from "../modules/telemetry/requestMetrics.js";

export interface CatalogSyncRunner {
  sync(): Promise<CatalogSnapshot>;
}

export interface EasyApiServices {
  catalogRepository: CatalogRepository;
  catalogSyncService: CatalogSyncRunner | null;
  executionClient: ChatCompletionsExecutor | null;
  requestMetricsCollector: RequestMetricsCollector;
  requestTelemetrySink: RequestTelemetrySink | null;
}

export interface BuildDefaultServicesOptions {
  openRouterApiKey?: string;
  telemetryRequestLogPath?: string;
}

export function buildDefaultServices(
  options: BuildDefaultServicesOptions = {}
): EasyApiServices {
  const catalogRepository = new InMemoryCatalogRepository();
  const catalogClient: OpenRouterCatalogClient = new OpenRouterClient({
    ...(options.openRouterApiKey ? { apiKey: options.openRouterApiKey } : {})
  });
  const requestMetricsCollector = new InMemoryRequestMetricsCollector();
  const fileTelemetrySink = createRequestTelemetrySink(options.telemetryRequestLogPath);

  return {
    catalogRepository,
    catalogSyncService: new CatalogSyncService(catalogClient, catalogRepository),
    executionClient: options.openRouterApiKey
      ? new OpenRouterExecutionClient({
          apiKey: options.openRouterApiKey
        })
      : null,
    requestMetricsCollector,
    requestTelemetrySink: combineRequestTelemetrySinks([
      requestMetricsCollector,
      fileTelemetrySink
    ])
  };
}
