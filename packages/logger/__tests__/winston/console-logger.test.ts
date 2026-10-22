import { describe, expect, it } from "vitest";
import { createConsoleLogger } from "~/winston/winston-console.factory";
import { captureConsoleLines } from "../support/capture-console";

function parse(line: string | undefined): Record<string, unknown> {
  return JSON.parse(line ?? "") as Record<string, unknown>;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("createConsoleLogger", () => {
  const output = captureConsoleLines();

  describe("options", () => {
    it("writes only the entries at or above the level", () => {
      const logger = createConsoleLogger({ level: "warn", format: "json" });

      logger.info("a");
      logger.warn("b");

      expect(output.lines()).toHaveLength(1);
      expect(parse(output.lines()[0])).toMatchObject({
        message: "b",
      });
    });

    it("defaults the level to info", () => {
      const logger = createConsoleLogger({ format: "json" });

      logger.debug("a");
      logger.info("b");

      expect(output.lines()).toHaveLength(1);
      expect(parse(output.lines()[0])).toMatchObject({
        message: "b",
      });
    });

    it("stamps the entry with an ISO time unless timestamp is false", () => {
      createConsoleLogger({ format: "json" }).info("msg");
      createConsoleLogger({ format: "json", timestamp: false }).info("msg");

      const [stamped, plain] = output.lines().map((line) => parse(line));
      expect(stamped?.timestamp).toEqual(expect.stringMatching(ISO));
      expect(plain).not.toHaveProperty("timestamp");
    });

    it("defaults the format to pretty", () => {
      createConsoleLogger({ timestamp: false }).info("msg");

      expect(output.lines()).toEqual(["info: msg"]);
      expect(() => parse(output.lines()[0])).toThrow();
    });

    it("writes the level and the message of a JSON entry, and nothing else", () => {
      createConsoleLogger({ format: "json", timestamp: false }).info("msg");

      expect(parse(output.lines()[0])).toEqual({
        level: "info",
        message: "msg",
      });
    });
  });

  describe("a timestamp in the metadata", () => {
    const metadata = { timestamp: "2000-01-01T00:00:00.000Z" };

    function expectBetween(time: unknown, before: number, after: number): void {
      expect(time).toEqual(expect.stringMatching(ISO));
      const at = Date.parse(String(time));
      expect(at).toBeGreaterThanOrEqual(before);
      expect(at).toBeLessThanOrEqual(after);
    }

    it("does not replace the time of a JSON entry", () => {
      const logger = createConsoleLogger({ format: "json" });

      const before = Date.now();
      logger.info("msg", metadata);
      const after = Date.now();

      expect(output.lines()).toHaveLength(1);
      expectBetween(parse(output.lines()[0]).timestamp, before, after);
    });

    it("does not replace the time of a pretty line, and is not printed", () => {
      const logger = createConsoleLogger({ format: "pretty" });

      const before = Date.now();
      logger.info("msg", metadata);
      const after = Date.now();

      expect(output.lines()).toHaveLength(1);
      const line = output.lines()[0] ?? "";
      expectBetween(line.split(" ")[0], before, after);
      expect(line).not.toContain("2000-01-01");
    });

    it("is not printed as the time of a pretty line without timestamps", () => {
      createConsoleLogger({ format: "pretty", timestamp: false }).info(
        "msg",
        metadata,
      );

      expect(output.lines()).toEqual(["info: msg"]);
    });
  });

  describe("context and stack in a pretty line", () => {
    function pretty(): ReturnType<typeof createConsoleLogger> {
      return createConsoleLogger({ format: "pretty", timestamp: false });
    }

    it("prints a context that is not a string in the metadata suffix", () => {
      pretty().info("msg", { context: { a: 1 } });

      expect(output.lines()).toEqual(['info: msg {"context":{"a":1}}']);
    });

    it("prints a stack that is not a string in the metadata suffix", () => {
      pretty().info("msg", { stack: ["x"] });

      expect(output.lines()).toEqual(['info: msg {"stack":["x"]}']);
    });

    it("prints nothing for an empty context, from a child or the call", () => {
      pretty().child({ context: "" }).info("msg");
      pretty().info("msg", { context: "" });

      expect(output.lines()).toEqual(["info: msg", "info: msg"]);
    });

    it("prints a string context as the prefix and a string stack after the entry", () => {
      pretty().info("msg", { context: "api", stack: "trace" });

      expect(output.lines()).toEqual(["info: [api] msg\ntrace"]);
    });
  });
});
