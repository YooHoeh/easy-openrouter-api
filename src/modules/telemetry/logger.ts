import type { FastifyBaseLogger } from "fastify";

import type { Env } from "../../config/env.js";

export interface EasyApiLogger {
  debug(payload: object, message?: string): void;
  info(payload: object, message?: string): void;
  warn(payload: object, message?: string): void;
  error(payload: object, message?: string): void;
  child(bindings: Record<string, unknown>): EasyApiLogger;
}

export function buildFastifyLoggerOptions(enabled: boolean, level: Env["LOG_LEVEL"]) {
  if (!enabled) {
    return false;
  }

  return {
    level
  };
}

export function createChildLogger(
  logger: Pick<FastifyBaseLogger, "child" | "debug" | "info" | "warn" | "error">,
  bindings: Record<string, unknown>
): EasyApiLogger {
  return logger.child(bindings) as EasyApiLogger;
}
