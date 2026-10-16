import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import winston from "winston";
import type { LogMetadata, Logger } from "~/logger";
import { createConsoleFormat } from "~/winston/winston-console.factory";
import { WinstonLoggerAdapter } from "~/winston/winston.adapter";
import {
  expectKeepsProtoKey,
  expectObjectPrototypeUnpolluted,
  parseProtoKeyInput,
} from "../support/proto-key";

interface CapturedLogger {
  /** A winston logger at level `debug`, with the JSON console format. */
  winstonLogger: winston.Logger;
  /** The lines written so far, each parsed as JSON. */
  lines(): unknown[];
}

/**
 * Builds a winston logger whose only transport writes to a stream that
 * collects its chunks. The stream transport writes each line synchronously,
 * so the lines are there as soon as the log call returns.
 */
function captureLines(): CapturedLogger {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  });

  const winstonLogger = winston.createLogger({
    level: "debug",
    format: createConsoleFormat({ format: "json", timestamp: false }),
    transports: [new winston.transports.Stream({ stream })],
  });

  return {
    winstonLogger,
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((line) => line !== "")
        .map((line): unknown => JSON.parse(line)),
  };
}

/** Returns a copy of `fields` plus an enumerable getter `key` that throws. */
function withThrowingGetter(
  key: string,
  fields: LogMetadata = {},
): LogMetadata {
  const metadata = { ...fields };
  Object.defineProperty(metadata, key, {
    enumerable: true,
    get(): never {
      throw new Error("getter failed");
    },
  });

  return metadata;
}

describe("WinstonLoggerAdapter", () => {
  describe("metadata", () => {
    it.each(["discount 50%off", "value %s", "100%%"])(
      "keeps the metadata and the exact message when the message is %j",
      (message) => {
        const { winstonLogger, lines } = captureLines();
        const logger = new WinstonLoggerAdapter(winstonLogger);

        logger.error(message, { requestId: "r1" });

        expect(lines()).toMatchObject([{ message, requestId: "r1" }]);
      },
    );

    it("does not throw on call metadata with a getter that throws, and writes it as [Unserializable] next to the other fields", () => {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(winstonLogger);

      expect(() =>
        logger.error("msg", withThrowingGetter("bad", { other: 1 })),
      ).not.toThrow();

      expect(lines()).toMatchObject([{ other: 1, bad: "[Unserializable]" }]);
    });

    it("does not throw on child metadata with a getter that throws, and writes it as [Unserializable] next to the context and the call's metadata", () => {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(winstonLogger);

      let child: Logger | undefined;
      expect(() => {
        child = logger.child({
          context: "C",
          metadata: withThrowingGetter("bad"),
        });
      }).not.toThrow();
      expect(() => child?.error("msg", { other: 1 })).not.toThrow();

      expect(lines()).toMatchObject([
        { context: "C", other: 1, bad: "[Unserializable]" },
      ]);
    });

    it("does not throw on bound metadata with a getter that throws, and writes it as [Unserializable]", () => {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(
        winstonLogger,
        withThrowingGetter("bad"),
      );

      expect(() => logger.error("msg")).not.toThrow();

      expect(lines()).toMatchObject([{ bad: "[Unserializable]" }]);
    });

    it("writes the call's message, not a message field of the metadata", () => {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(winstonLogger);

      logger.error("msg", { message: "from metadata", other: 1 });

      expect(lines()).toMatchObject([{ message: "msg", other: 1 }]);
    });

    it("writes the call's level, not a level field of the metadata", () => {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(winstonLogger);

      logger.error("msg", { level: "debug", other: 1 });

      expect(lines()).toMatchObject([{ level: "error", other: 1 }]);
    });

    it("writes the message of an error nested in the metadata", () => {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(winstonLogger);

      logger.error("msg", { error: new Error("boom") });

      expect(lines()).toMatchObject([{ error: { message: "boom" } }]);
    });

    it("writes only the level and the message when there is no metadata", () => {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(winstonLogger);

      logger.info("hello");

      expect(lines()).toStrictEqual([{ level: "info", message: "hello" }]);
    });

    it("does not throw on metadata whose toJSON throws, and writes it under the metadata key as [Unserializable]", () => {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(winstonLogger);

      expect(() =>
        logger.error("msg", {
          toJSON(): never {
            throw new Error("x");
          },
        }),
      ).not.toThrow();

      expect(lines()).toMatchObject([{ metadata: "[Unserializable]" }]);
    });

    it("writes metadata whose toJSON returns a string under the metadata key", () => {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(winstonLogger);

      logger.error("msg", { toJSON: () => "s" });

      expect(lines()).toMatchObject([{ metadata: "s" }]);
    });
  });

  describe("precedence", () => {
    function createChild(): { child: Logger; lines(): unknown[] } {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(winstonLogger, {
        service: "default",
        a: 1,
      });
      const child = logger.child({
        context: "C",
        metadata: { service: "child", b: 2 },
      });

      return { child, lines };
    }

    it("writes the child's metadata over the bound metadata, keeping the fields of both", () => {
      const { child, lines } = createChild();

      child.error("msg");

      expect(lines()).toMatchObject([
        { service: "child", a: 1, b: 2, context: "C" },
      ]);
    });

    it("writes the call's metadata over the child's", () => {
      const { child, lines } = createChild();

      child.error("msg", { service: "call" });

      expect(lines()).toMatchObject([{ service: "call" }]);
    });

    it("writes the context of the inner child over the outer one", () => {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(winstonLogger);

      logger.child({ context: "A" }).child({ context: "B" }).info("x");

      expect(lines()).toMatchObject([{ context: "B" }]);
    });
  });

  describe("a __proto__ key", () => {
    it("writes the __proto__ field of the call's metadata", () => {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(winstonLogger);

      logger.error("msg", parseProtoKeyInput());

      expect(lines()).toHaveLength(1);
      expectKeepsProtoKey(lines()[0]);
    });

    it("writes the __proto__ field of the bound metadata", () => {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(
        winstonLogger,
        parseProtoKeyInput(),
      );

      logger.error("msg");

      expect(lines()).toHaveLength(1);
      expectKeepsProtoKey(lines()[0]);
    });

    it("writes the __proto__ field of a child's metadata", () => {
      const { winstonLogger, lines } = captureLines();
      const logger = new WinstonLoggerAdapter(winstonLogger);

      logger
        .child({ context: "C", metadata: parseProtoKeyInput() })
        .error("msg");

      expect(lines()).toHaveLength(1);
      expectKeepsProtoKey(lines()[0]);
    });
  });

  // Runs after the cases above, which log objects with a __proto__ key.
  it("leaves Object.prototype without the fields of a logged __proto__ key", () => {
    expectObjectPrototypeUnpolluted();
  });
});
