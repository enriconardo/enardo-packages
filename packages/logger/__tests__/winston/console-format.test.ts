import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import type { Logform } from "winston";
import type { ConsoleLoggerOptions, LogMetadata } from "~/logger";
import { createConsoleFormat } from "~/winston/winston-console.factory";
import {
  expectObjectPrototypeUnpolluted,
  parseProtoKeyInput,
} from "../support/proto-key";

const LEVEL = Symbol.for("level");
const MESSAGE = Symbol.for("message");

/**
 * Runs an `error` entry through the format and returns the line the console
 * transport would print. The entry is built as winston builds one; going
 * through the transport instead would not work, since in vitest it does not
 * write through `process.stdout`.
 */
function formatLine(
  options: ConsoleLoggerOptions,
  metadata: LogMetadata,
): string {
  const info: Logform.TransformableInfo = {
    level: "error",
    message: "msg",
    ...metadata,
    [LEVEL]: "error",
  };

  const result = createConsoleFormat(options).transform(info);
  if (typeof result === "boolean") {
    throw new Error("The format filtered the entry out.");
  }

  const line = result[MESSAGE];
  if (typeof line !== "string") {
    throw new Error("The format produced no line.");
  }

  return line;
}

function jsonEntry(metadata: LogMetadata): unknown {
  return JSON.parse(formatLine({ format: "json", timestamp: false }, metadata));
}

function prettyLine(metadata: LogMetadata): string {
  return stripVTControlCharacters(
    formatLine({ format: "pretty", timestamp: false }, metadata),
  );
}

describe("createConsoleFormat", () => {
  describe("json", () => {
    it("writes the name, message and stack of an error nested in the metadata", () => {
      expect(jsonEntry({ error: new Error("boom") })).toMatchObject({
        error: {
          name: "Error",
          message: "boom",
          stack: expect.any(String),
        },
      });
    });

    it("writes the level, the message and the metadata, and nothing else", () => {
      expect(jsonEntry({ requestId: "r1" })).toStrictEqual({
        level: "error",
        message: "msg",
        requestId: "r1",
      });
    });
  });

  describe("pretty", () => {
    it("writes the message of an error nested in the metadata", () => {
      expect(prettyLine({ error: new Error("boom") })).toContain(
        '"message":"boom"',
      );
    });

    it("keeps the other metadata when one value is cyclic", () => {
      const cyclic: Record<string, unknown> = { id: "a" };
      cyclic.self = cyclic;

      const line = prettyLine({ a: cyclic, other: "kept" });

      expect(line).toContain('"other":"kept"');
      expect(line).toContain('"[Circular]"');
    });

    it("writes the __proto__ field of an object nested in the metadata", () => {
      expect(prettyLine({ body: parseProtoKeyInput() })).toContain(
        '"__proto__":{"isAdmin":true}',
      );
    });
  });

  // Runs after the cases above, which format objects with a __proto__ key.
  it("leaves Object.prototype without the fields of a formatted __proto__ key", () => {
    expectObjectPrototypeUnpolluted();
  });
});
