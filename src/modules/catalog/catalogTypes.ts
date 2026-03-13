export type CatalogModality = "text" | "image" | "audio" | "file" | "video";

export interface CatalogPricing {
  prompt: string;
  completion: string;
  request?: string;
  image?: string;
  [key: string]: string | undefined;
}

export interface CatalogHealthScores {
  uptime_score: number;
  latency_score: number;
  throughput_score: number;
  recent_success_score: number;
}

export interface CatalogProviderEndpoint {
  name: string;
  provider_name: string;
  context_length?: number;
  max_completion_tokens?: number;
  supported_parameters: string[];
  status?: string;
  uptime_last_30m?: number;
  pricing?: CatalogPricing;
}

export interface CatalogModel {
  model_id: string;
  display_name: string;
  description?: string;
  created_at?: number;
  input_modalities: CatalogModality[];
  output_modalities: CatalogModality[];
  context_length: number;
  max_completion_tokens?: number;
  supported_parameters: string[];
  pricing: CatalogPricing;
  is_active: boolean;
  is_free_text: boolean;
  is_free_image: boolean;
  provider_endpoints: CatalogProviderEndpoint[];
  health: CatalogHealthScores;
  last_seen_at: string;
}

export interface CatalogSnapshot {
  source: "openrouter";
  version: number;
  synced_at: string;
  models: CatalogModel[];
}
