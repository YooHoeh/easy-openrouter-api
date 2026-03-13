export interface VisionEntity {
  type: string;
  value: string;
  confidence?: number;
}

export interface VisionUncertainty {
  field: string;
  reason: string;
}

export interface VisionIntermediateResult {
  source_type: "image";
  summary: string;
  raw_text: string;
  entities: VisionEntity[];
  uncertainties: VisionUncertainty[];
  confidence: number;
}

export interface VisionPreprocessorPlan {
  type: "vision";
  model: string;
  fallback_chain: string[];
  prompt: {
    system: string;
    user: string;
  };
  output_contract: "vision_intermediate_v1";
}

export interface VisionOrchestrationPlan {
  mode: "orchestrated";
  reasoning_model: string;
  preprocessors: [VisionPreprocessorPlan];
  final_response_contract: {
    response_model: string;
    intermediate_contract: "vision_intermediate_v1";
  };
}
