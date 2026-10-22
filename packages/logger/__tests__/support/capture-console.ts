import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach } from "vitest";
import winston from "winston";

const MESSAGE = Symbol.for("message");

interface ConsoleProto {
  log(info: Record<symbol, unknown>, callback?: () => void): void;
}

/**
 * Records each line the console transport formats instead of writing it.
 * Call it in a `describe`: the capture starts before each test and ends after.
 */
export function captureConsoleLines(): {
  /** The formatted lines so far, ANSI codes included. */
  raw(): string[];
  /** The formatted lines so far, ANSI codes stripped. */
  lines(): string[];
} {
  const proto = winston.transports.Console.prototype as ConsoleProto;
  const original = proto.log;
  let recorded: string[] = [];

  beforeEach(() => {
    recorded = [];
    proto.log = function log(info, callback): void {
      recorded.push(String(info[MESSAGE]));
      callback?.();
    };
  });

  afterEach(() => {
    proto.log = original;
  });

  return {
    raw: () => recorded,
    lines: () => recorded.map((line) => stripVTControlCharacters(line)),
  };
}
