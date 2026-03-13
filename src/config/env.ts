import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const booleanSchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const portSchema = z.preprocess((value) => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return Number.parseInt(value, 10);
  }

  return value;
}, z.number().int().positive());

const EnvSchema = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: portSchema.default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ENABLE_DEBUG_ROUTE_METADATA: booleanSchema.default(false),
  ALLOW_PAID_FALLBACK: booleanSchema.default(false),
  ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK: booleanSchema.default(false),
  TELEMETRY_REQUEST_LOG_PATH: z
    .string()
    .trim()
    .min(1)
    .optional(),
  OPENROUTER_API_KEY: z
    .string()
    .trim()
    .min(1)
    .optional()
});

export type Env = z.infer<typeof EnvSchema>;
export type EnvInput = Partial<Record<keyof Env, string | number | boolean | undefined>>;
export interface LoadEnvFilesOptions {
  cwd?: string;
  files?: string[];
  targetEnv?: Record<string, string | undefined>;
}

const DEFAULT_ENV_FILES = [".env", ".env.local"];

export function parseEnv(input: EnvInput = process.env): Env {
  return EnvSchema.parse(input);
}

export function loadProcessEnvFiles(options: LoadEnvFilesOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  const files = options.files ?? DEFAULT_ENV_FILES;
  const targetEnv = options.targetEnv ?? process.env;
  const protectedKeys = new Set(
    Object.entries(targetEnv)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key)
  );
  const mergedValues: Record<string, string> = {};
  const loadedFiles: string[] = [];

  for (const file of files) {
    const filePath = path.resolve(cwd, file);

    if (!existsSync(filePath)) {
      continue;
    }

    Object.assign(mergedValues, parseDotEnvContent(readFileSync(filePath, "utf8")));
    loadedFiles.push(filePath);
  }

  for (const [key, value] of Object.entries(mergedValues)) {
    if (protectedKeys.has(key)) {
      continue;
    }

    targetEnv[key] = value;
  }

  return loadedFiles;
}

function parseDotEnvContent(content: string) {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();

    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
      continue;
    }

    const normalizedLine = trimmedLine.startsWith("export ")
      ? trimmedLine.slice("export ".length)
      : trimmedLine;
    const separatorIndex = normalizedLine.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    const rawValue = normalizedLine.slice(separatorIndex + 1).trim();

    if (key.length === 0) {
      continue;
    }

    values[key] = unwrapEnvValue(rawValue);
  }

  return values;
}

function unwrapEnvValue(value: string) {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
