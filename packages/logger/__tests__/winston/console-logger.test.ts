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
});
