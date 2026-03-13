import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { RequestLogRecord } from "./requestLog.js";

export interface RequestTelemetrySink {
  write(record: RequestLogRecord): Promise<void>;
}

export class CompositeRequestTelemetrySink implements RequestTelemetrySink {
  constructor(private readonly sinks: RequestTelemetrySink[]) {}

  async write(record: RequestLogRecord) {
    for (const sink of this.sinks) {
      await sink.write(record);
    }
  }
}

export class FileRequestTelemetrySink implements RequestTelemetrySink {
  private pendingWrite: Promise<void> = Promise.resolve();
  private readonly resolvedPath: string;

  constructor(filePath: string) {
    this.resolvedPath = path.resolve(filePath);
  }

  write(record: RequestLogRecord): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;

    const nextWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
      await mkdir(path.dirname(this.resolvedPath), {
        recursive: true
      });
      await appendFile(this.resolvedPath, line, "utf8");
    });

    this.pendingWrite = nextWrite;
    return nextWrite;
  }
}

export function createRequestTelemetrySink(requestLogPath: string | undefined | null) {
  if (!requestLogPath) {
    return null;
  }

  return new FileRequestTelemetrySink(requestLogPath);
}

export function combineRequestTelemetrySinks(
  sinks: Array<RequestTelemetrySink | null | undefined>
): RequestTelemetrySink | null {
  const activeSinks = sinks.filter((sink): sink is RequestTelemetrySink => sink !== null && sink !== undefined);

  if (activeSinks.length === 0) {
    return null;
  }

  if (activeSinks.length === 1) {
    return activeSinks[0] ?? null;
  }

  return new CompositeRequestTelemetrySink(activeSinks);
}
