import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "~/index";
import { captureConsoleLines } from "../support/capture-console";

const ESC = "\\u001b\\[[0-9;]*m";
const ANSI = new RegExp(ESC);

interface TerminalState {
  /** `undefined` leaves the property off `process.stdout`. */
  isTTY?: boolean;
  /** `undefined` leaves the method off `process.stdout`. */
  hasColors?: boolean;
}

const stdout = process.stdout as unknown as Record<string, unknown>;
const STDOUT_KEYS = ["isTTY", "hasColors"] as const;

/** Sets `isTTY` and `hasColors` on the real `process.stdout`. */
function setTerminal({ isTTY, hasColors }: TerminalState): void {
  for (const key of STDOUT_KEYS) {
    Reflect.deleteProperty(stdout, key);
  }
  if (isTTY !== undefined) {
    Object.defineProperty(stdout, "isTTY", {
      value: isTTY,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  }
  if (hasColors !== undefined) {
    Object.defineProperty(stdout, "hasColors", {
      value: () => hasColors,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  }
}

function expectColored(line: string | undefined, message: string): void {
  expect(line).toEqual(
    expect.stringMatching(new RegExp(`${ESC}[^\\u001b]*info${ESC}`)),
  );
  expect(line).toEqual(
    expect.stringMatching(new RegExp(`${ESC}[^\\u001b]*${message}${ESC}`)),
  );
}

function expectPlain(line: string | undefined, message: string): void {
  expect(line).toEqual(expect.stringContaining(message));
  expect(line).not.toMatch(ANSI);
}

describe("console logger colors", () => {
  const output = captureConsoleLines();
  const saved = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    for (const key of STDOUT_KEYS) {
      saved.set(key, Object.getOwnPropertyDescriptor(stdout, key));
    }
    vi.stubEnv("FORCE_COLOR", undefined);
    vi.stubEnv("NO_COLOR", undefined);
    setTerminal({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const key of STDOUT_KEYS) {
      Reflect.deleteProperty(stdout, key);
      const descriptor = saved.get(key);
      if (descriptor) {
        Object.defineProperty(stdout, key, descriptor);
      }
    }
    saved.clear();
  });

  describe("without FORCE_COLOR", () => {
    it("writes plain lines when stdout is no TTY", () => {
      createLogger("console").info("hello");

      expectPlain(output.raw()[0], "hello");
    });

    it("writes plain lines when stdout is no TTY and NO_COLOR is set", () => {
      vi.stubEnv("NO_COLOR", "1");

      createLogger("console").info("hello");

      expectPlain(output.raw()[0], "hello");
    });

    it("colors the level and the message on a TTY that has colors", () => {
      setTerminal({ isTTY: true, hasColors: true });

      createLogger("console").info("hello");

      expectColored(output.raw()[0], "hello");
    });

    it("asks hasColors(), and writes plain lines on a TTY without colors", () => {
      setTerminal({ isTTY: true, hasColors: false });

      createLogger("console").info("hello");

      expectPlain(output.raw()[0], "hello");
    });

    it("checks isTTY, and writes plain lines when it is false", () => {
      setTerminal({ isTTY: false, hasColors: true });

      createLogger("console").info("hello");

      expectPlain(output.raw()[0], "hello");
    });
  });

  describe("with FORCE_COLOR", () => {
    it.each(["", "1", "2", "3", "true"])(
      "colors when FORCE_COLOR is %j, off a TTY",
      (value) => {
        vi.stubEnv("FORCE_COLOR", value);

        createLogger("console").info("hello");

        expectColored(output.raw()[0], "hello");
      },
    );

    it.each(["0", "false", "yes"])(
      "writes plain lines when FORCE_COLOR is %j, even on a TTY with colors",
      (value) => {
        vi.stubEnv("FORCE_COLOR", value);
        setTerminal({ isTTY: true, hasColors: true });

        createLogger("console").info("hello");

        expectPlain(output.raw()[0], "hello");
      },
    );

    it("ignores NO_COLOR when FORCE_COLOR is set", () => {
      vi.stubEnv("FORCE_COLOR", "1");
      vi.stubEnv("NO_COLOR", "1");

      createLogger("console").info("hello");

      expectColored(output.raw()[0], "hello");
    });
  });

  it("never colors the json format", () => {
    vi.stubEnv("FORCE_COLOR", "1");
    setTerminal({ isTTY: true, hasColors: true });

    createLogger("console", { format: "json" }).info("hello");

    expectPlain(output.raw()[0], "hello");
  });

  it("makes the choice when the logger is created, for its children too", () => {
    setTerminal({ isTTY: true, hasColors: true });
    const logger = createLogger("console");
    setTerminal({});

    logger.info("hello");
    logger.child({ context: "Child" }).info("again");

    expect(output.raw()).toHaveLength(2);
    expectColored(output.raw()[0], "hello");
    expectColored(output.raw()[1], "again");
  });

  it("changes nothing but the colors of a line", () => {
    const options = {
      timestamp: false,
      defaultMetadata: { service: "api" },
    } as const;
    const entry = ["hello", { id: 7, tags: ["a", "b"] }] as const;

    setTerminal({ isTTY: true, hasColors: true });
    createLogger("console", options)
      .child({ context: "Child" })
      .info(entry[0], { ...entry[1] });
    setTerminal({});
    createLogger("console", options)
      .child({ context: "Child" })
      .info(entry[0], { ...entry[1] });

    const [colored, plain] = output.raw();
    expectColored(colored, "hello");
    expectPlain(plain, "hello");
    expect(stripVTControlCharacters(colored ?? "")).toBe(plain);
  });
});
