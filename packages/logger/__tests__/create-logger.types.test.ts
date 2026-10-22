import { describe, expectTypeOf, it } from "vitest";
import {
  createLogger,
  type Logger,
  type LoggerOptions,
  type LoggerTransportType,
} from "~/index";

// These tests are enforced by `tsc --noEmit` (`pnpm typecheck`): `vitest run`
// erases the types. The transport is read from a record declared
// `{ transport: LoggerTransportType }`, as one read from configuration would
// be: a `const` declared `LoggerTransportType` and assigned a literal is
// narrowed to that literal, and would match its overload. Each
// `@ts-expect-error` sits on the line of the offending property or argument,
// so that an error reported on the whole call does not satisfy it.

const config: { transport: LoggerTransportType } = { transport: "noop" };
const transport = config.transport;

describe("createLogger", () => {
  describe("with a transport typed LoggerTransportType", () => {
    it("returns a Logger", () => {
      expectTypeOf(createLogger(transport)).toEqualTypeOf<Logger>();
    });

    it("accepts the options every transport shares", () => {
      createLogger(transport, {
        level: "debug",
        defaultMetadata: { service: "api" },
      });
    });

    it("accepts options typed LoggerOptions<LoggerTransportType>", () => {
      const options: LoggerOptions<LoggerTransportType> = { level: "info" };

      createLogger(transport, options);
    });
  });

  describe("with a literal transport", () => {
    it("rejects a console option for the noop transport", () => {
      createLogger("noop", {
        // @ts-expect-error a literal transport keeps its own options
        format: "json",
      });
    });

    it("rejects an unknown option for the console transport", () => {
      createLogger("console", {
        // @ts-expect-error not a console option
        foo: 1,
      });
    });
  });

  it("rejects a transport typed string", () => {
    // A valid value, so that the call does not throw at run time.
    const settings: { transport: string } = { transport: "noop" };

    createLogger(
      // @ts-expect-error a string is not a transport
      settings.transport,
    );
  });
});
