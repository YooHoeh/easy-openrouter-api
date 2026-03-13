import type { CatalogModel } from "../catalog/catalogTypes.js";
import type { TaskType } from "./requestAnalyzer.js";

export interface TaskPriorRule {
  model_id?: string;
  pattern?: RegExp;
  score: number;
}

export type TaskPriorConfig = Record<TaskType, TaskPriorRule[]>;

const TASK_BASELINES: Record<TaskType, number> = {
  general_chat: 0.58,
  coding: 0.52,
  reasoning: 0.56,
  vision_qa: 0.55,
  document_extraction: 0.58,
  audio_transcription: 0.48
};

export const DEFAULT_TASK_PRIORS: TaskPriorConfig = {
  general_chat: [
    { model_id: "openai/gpt-oss-120b:free", score: 0.96 },
    { model_id: "openai/gpt-oss-20b:free", score: 0.93 },
    { model_id: "google/gemma-3-27b-it:free", score: 0.91 },
    { model_id: "google/gemma-3-12b-it:free", score: 0.88 },
    { model_id: "qwen/qwen3-next-80b-a3b-instruct:free", score: 0.87 },
    { model_id: "qwen/qwen3-14b:free", score: 0.86 },
    { model_id: "meta-llama/llama-3.3-70b-instruct:free", score: 0.84 },
    { model_id: "z-ai/glm-4.5-air:free", score: 0.83 },
    { model_id: "qwen/qwen3-8b:free", score: 0.82 },
    { model_id: "qwen/qwen3-coder:free", score: 0.44 },
    { pattern: /trinity|openrouter\/free|healer-alpha|hunter-alpha/i, score: 0.36 },
    { pattern: /coder|liquid\/lfm.*thinking|nemotron.*vl/i, score: 0.38 },
    { pattern: /dolphin|uncensored|venice|abliterated/i, score: 0.42 },
    { pattern: /gpt-oss/i, score: 0.9 },
    { pattern: /gemma.*it|gemini-flash/i, score: 0.84 },
    { pattern: /llama-3\.3.*instruct|glm-4\.5|step-3\.5/i, score: 0.8 },
    { pattern: /qwen3|qwen.*instruct/i, score: 0.8 },
    { pattern: /mistral.*instruct|mistral-small|ministral/i, score: 0.74 }
  ],
  coding: [
    { model_id: "qwen/qwen3-coder:free", score: 0.95 },
    { model_id: "openai/gpt-oss-120b:free", score: 0.82 },
    { pattern: /coder/i, score: 0.9 },
    { pattern: /qwen/i, score: 0.78 }
  ],
  reasoning: [
    { model_id: "openai/gpt-oss-120b:free", score: 0.9 },
    { pattern: /reason|r1|think/i, score: 0.84 }
  ],
  vision_qa: [
    { model_id: "google/gemma-3-27b-it:free", score: 0.88 },
    { model_id: "mistralai/mistral-small-3.1-24b-instruct:free", score: 0.72 },
    { pattern: /vision|vl|gemma/i, score: 0.82 }
  ],
  document_extraction: [
    { pattern: /vision|ocr|gemma/i, score: 0.84 }
  ],
  audio_transcription: [
    { pattern: /whisper|audio|speech/i, score: 0.88 }
  ]
};

export function getTaskPriorScore(
  model: Pick<CatalogModel, "model_id" | "display_name">,
  taskType: TaskType,
  priors: TaskPriorConfig = DEFAULT_TASK_PRIORS
) {
  const rules = priors[taskType];
  const exactMatch = rules.find((rule) => rule.model_id === model.model_id);

  if (exactMatch) {
    return exactMatch.score;
  }

  const patternMatch = rules.find((rule) => {
    if (!rule.pattern) {
      return false;
    }

    return rule.pattern.test(model.model_id) || rule.pattern.test(model.display_name);
  });

  return patternMatch?.score ?? TASK_BASELINES[taskType];
}
