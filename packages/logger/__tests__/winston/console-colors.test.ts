import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "~/index";
import { captureConsoleLines } from "../support/capture-console";

const ESC = "\\u001b\\[[0-9;]*m";
const ANSI = new RegExp(ESC);

const stdout = process.stdout as unknown as Record<string, unknown>;
const STDOUT_KEYS = ["isTTY", "hasColors"] as const;

/** Sets `isTTY` on the real `process.stdout`; `undefined` leaves it off. */
function setTTY(isTTY: boolean | undefined): void {
  Reflect.deleteProperty(stdout, "isTTY");
  if (isTTY !== undefined) {
    Object.defineProperty(stdout, "isTTY", {
      value: isTTY,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  }
}

/**
 * Makes `process.stdout.hasColors()` answer `hasColors`. The logger must not
 * ask it: the colored cases set it to `false` so that a logger that does
 * shows it.
 */
function setHasColors(hasColors: boolean): void {
  Object.defineProperty(stdout, "hasColors", {
    value: () => hasColors,
    configurable: true,
    writable: true,
    enumerable: true,
  });
}

/**
 * Sets the environment against the expected outcome: the logger reads no
 * environment variables, so one that does writes the wrong line.
 */
function stubEnvAgainst(expected: "colored" | "plain"): void {
  if (expected === "colored") {
    vi.stubEnv("NO_COLOR", "1");
    vi.stubEnv("FORCE_COLOR", "0");
    setHasColors(false);
  } else {
    vi.stubEnv("FORCE_COLOR", "1");
    setHasColors(true);
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
      Reflect.deleteProperty(stdout, key);
    }
    vi.stubEnv("FORCE_COLOR", undefined);
    vi.stubEnv("NO_COLOR", undefined);
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

  describe("with default options", () => {
    it("writes plain lines when stdout's isTTY is unset", () => {
      setTTY(undefined);
      stubEnvAgainst("plain");

      createLogger("console").info("hello");

      expectPlain(output.raw()[0], "hello");
    });

    it("colors the level and the message when stdout is a TTY", () => {
      setTTY(true);
      stubEnvAgainst("colored");

      createLogger("console").info("hello");

      expectColored(output.raw()[0], "hello");
    });

    it("writes plain lines when stdout's isTTY is false", () => {
      setTTY(false);
      stubEnvAgainst("plain");

      createLogger("console").info("hello");

      expectPlain(output.raw()[0], "hello");
    });
  });

  it("colors with colors: true, off a TTY", () => {
    setTTY(undefined);
    stubEnvAgainst("colored");

    createLogger("console", { colors: true }).info("hello");

    expectColored(output.raw()[0], "hello");
  });

  it("writes plain lines with colors: false, on a TTY", () => {
    setTTY(true);
    stubEnvAgainst("plain");

    createLogger("console", { colors: false }).info("hello");

    expectPlain(output.raw()[0], "hello");
  });

  it("never colors the json format, even with colors: true on a TTY", () => {
    setTTY(true);
    stubEnvAgainst("plain");

    createLogger("console", { format: "json", colors: true }).info("hello");

    expectPlain(output.raw()[0], "hello");
  });

  it("makes the choice when the logger is created, for its children too", () => {
    setTTY(true);
    stubEnvAgainst("colored");
    const logger = createLogger("console");
    setTTY(undefined);

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

    setTTY(true);
    createLogger("console", options)
      .child({ context: "Child" })
      .info(entry[0], { ...entry[1] });
    setTTY(undefined);
    createLogger("console", options)
      .child({ context: "Child" })
      .info(entry[0], { ...entry[1] });

    const [colored, plain] = output.raw();
    expectColored(colored, "hello");
    expectPlain(plain, "hello");
    expect(stripVTControlCharacters(colored ?? "")).toBe(plain);
  });
});
