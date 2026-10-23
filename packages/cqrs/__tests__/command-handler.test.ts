import { type Mock, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  Command,
  CommandHandler,
  type CommandFailureCode,
  type CommandHandlerOptions,
  type CommandResponse,
} from "~/index";
import {
  TestError,
  brandedObject,
  brandedObjectWithThrowingCode,
  unbrandedError,
} from "./support/errors";

// The type cases at the end are enforced by `tsc --noEmit` (`pnpm
// typecheck`): `vitest run` erases the types. Each `@ts-expect-error` sits on
// the line the error is reported on, so that another error elsewhere does
// not satisfy it.

class TestCommand extends Command {
  constructor() {
    super();
  }
}

interface Payload {
  id: string;
}

type Codes = "EMAIL_TAKEN" | "EMAIL_INVALID";
type TestResponse = CommandResponse<Payload, Codes>;

interface TestOptions extends CommandHandlerOptions {
  run: () => Promise<Payload>;
}

/** Lists both codes of its response type. */
class TestHandler extends CommandHandler<
  TestCommand,
  TestResponse,
  TestOptions
> {
  protected override readonly expectedCodes = [
    "EMAIL_TAKEN",
    "EMAIL_INVALID",
  ] as const;

  protected override handle(): Promise<Payload> {
    return this.options.run();
  }
}

/** Lists only one of the two codes of its response type. */
class OnlyInvalidHandler extends CommandHandler<
  TestCommand,
  TestResponse,
  TestOptions
> {
  protected override readonly expectedCodes = ["EMAIL_INVALID"] as const;

  protected override handle(): Promise<Payload> {
    return this.options.run();
  }
}

/** A response type with no code, and an empty list. */
class NoCodesHandler extends CommandHandler<
  TestCommand,
  CommandResponse<Payload>,
  TestOptions
> {
  protected override readonly expectedCodes = [];

  protected override handle(): Promise<Payload> {
    return this.options.run();
  }
}

interface SyncThrowOptions extends CommandHandlerOptions {
  thrown: unknown;
}

/** A `handle()` that is not `async`, and throws before returning a promise. */
class SyncThrowingHandler extends CommandHandler<
  TestCommand,
  TestResponse,
  SyncThrowOptions
> {
  protected override readonly expectedCodes = [
    "EMAIL_TAKEN",
    "EMAIL_INVALID",
  ] as const;

  protected override handle(): Promise<Payload> {
    throw this.options.thrown;
  }
}

function throwing(value: unknown): () => Promise<Payload> {
  return async () => {
    throw value;
  };
}

function returning(payload: Payload): () => Promise<Payload> {
  return async () => payload;
}

const emailTaken = (): TestError =>
  new TestError("EMAIL_TAKEN", { details: { email: "anna@example.test" } });

describe("CommandHandler", () => {
  describe("execute", () => {
    it("resolves to a success with the payload handle() returns", async () => {
      const handler = new TestHandler({ run: returning({ id: "1" }) });

      await expect(handler.execute(new TestCommand())).resolves.toStrictEqual({
        success: true,
        payload: { id: "1" },
      });
    });

    it("resolves to a failure with only the code of a BaseError with a listed code", async () => {
      const handler = new TestHandler({ run: throwing(emailTaken()) });

      await expect(handler.execute(new TestCommand())).resolves.toStrictEqual({
        success: false,
        error: "EMAIL_TAKEN",
      });
    });

    it("rejects with the same BaseError when its code is not listed", async () => {
      const error = new TestError("OTHER_CODE");
      const handler = new TestHandler({ run: throwing(error) });

      await expect(handler.execute(new TestCommand())).rejects.toBe(error);
    });

    it("rejects with an Error that has a listed code but no brand", async () => {
      const error = unbrandedError("EMAIL_TAKEN");
      const handler = new TestHandler({ run: throwing(error) });

      await expect(handler.execute(new TestCommand())).rejects.toBe(error);
    });

    it("rejects with a native Error, whose message never becomes a failure", async () => {
      const error = new Error("getaddrinfo EAI_AGAIN smtp.internal.corp.test");
      const handler = new TestHandler({ run: throwing(error) });

      await expect(handler.execute(new TestCommand())).rejects.toBe(error);
    });

    it("rejects with a thrown string", async () => {
      const handler = new TestHandler({ run: throwing("boom") });

      await expect(handler.execute(new TestCommand())).rejects.toBe("boom");
    });

    it("resolves to a failure for a branded error that is not an instance of this copy's BaseError", async () => {
      const handler = new TestHandler({
        run: throwing(brandedObject("EMAIL_TAKEN")),
      });

      await expect(handler.execute(new TestCommand())).resolves.toStrictEqual({
        success: false,
        error: "EMAIL_TAKEN",
      });
    });

    it("rejects with the same branded object when reading its code throws", async () => {
      const thrown = brandedObjectWithThrowingCode();
      const handler = new TestHandler({ run: throwing(thrown) });

      await expect(handler.execute(new TestCommand())).rejects.toBe(thrown);
    });

    it("rejects with a BaseError whose code is in the response type but not in the list", async () => {
      const error = emailTaken();
      const handler = new OnlyInvalidHandler({ run: throwing(error) });

      await expect(handler.execute(new TestCommand())).rejects.toBe(error);
    });

    it("rejects with any BaseError when the list is empty", async () => {
      const error = emailTaken();
      const handler = new NoCodesHandler({ run: throwing(error) });

      await expect(handler.execute(new TestCommand())).rejects.toBe(error);
    });

    describe("when handle() throws synchronously", () => {
      it("returns a promise that resolves to the failure of a listed BaseError", async () => {
        const handler = new SyncThrowingHandler({ thrown: emailTaken() });
        let result: unknown;

        expect(() => {
          result = handler.execute(new TestCommand());
        }).not.toThrow();
        expect(result).toBeInstanceOf(Promise);
        await expect(result).resolves.toStrictEqual({
          success: false,
          error: "EMAIL_TAKEN",
        });
      });

      it("returns a promise that rejects with a native Error", async () => {
        const error = new Error("sync failure");
        const handler = new SyncThrowingHandler({ thrown: error });
        let result: unknown;

        expect(() => {
          result = handler.execute(new TestCommand());
        }).not.toThrow();
        expect(result).toBeInstanceOf(Promise);
        await expect(result).rejects.toBe(error);
      });
    });
  });

  describe("logging", () => {
    // Wider than `Logger`: `error` is a spy, so that a call to it shows.
    type LogMethod = (
      message: string,
      metadata?: Record<string, unknown>,
    ) => void;

    function createSpyLogger(): {
      debug: Mock<LogMethod>;
      error: Mock<LogMethod>;
    } {
      return { debug: vi.fn<LogMethod>(), error: vi.fn<LogMethod>() };
    }

    it("logs only the start at debug, and nothing at error, when it rethrows", async () => {
      const logger = createSpyLogger();
      const handler = new TestHandler({
        logger,
        run: throwing(
          new Error("getaddrinfo EAI_AGAIN smtp.internal.corp.test"),
        ),
      });

      await expect(handler.execute(new TestCommand())).rejects.toThrow(
        "getaddrinfo EAI_AGAIN smtp.internal.corp.test",
      );

      expect(logger.debug).toHaveBeenCalledTimes(1);
      expect(logger.debug.mock.calls[0]?.[0]).toBe("Executing command.");
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("logs an expected failure at debug with the command and the code", async () => {
      const logger = createSpyLogger();
      const handler = new TestHandler({ logger, run: throwing(emailTaken()) });

      await handler.execute(new TestCommand());

      expect(logger.debug).toHaveBeenCalledWith(
        "Command failed with an expected code.",
        { command: "TestCommand", error: "EMAIL_TAKEN" },
      );
    });

    it("logs a success at debug with the command", async () => {
      const logger = createSpyLogger();
      const handler = new TestHandler({
        logger,
        run: returning({ id: "1" }),
      });

      await handler.execute(new TestCommand());

      expect(logger.debug).toHaveBeenCalledWith(
        "Command executed successfully.",
        { command: "TestCommand" },
      );
    });
  });

  describe("types", () => {
    it("requires a handler to declare expectedCodes", () => {
      // @ts-expect-error TS2515: the abstract expectedCodes is not implemented
      class MissingCodesHandler extends CommandHandler<
        TestCommand,
        TestResponse
      > {
        protected override async handle(): Promise<Payload> {
          return { id: "1" };
        }
      }

      void MissingCodesHandler;
    });

    it("accepts a response type derived from a const list", async () => {
      const codes = ["EMAIL_TAKEN", "EMAIL_INVALID"] as const;
      type DerivedResponse = CommandResponse<Payload, (typeof codes)[number]>;

      class DerivedHandler extends CommandHandler<
        TestCommand,
        DerivedResponse
      > {
        protected override readonly expectedCodes = codes;

        protected override async handle(): Promise<Payload> {
          return { id: "1" };
        }
      }

      expectTypeOf<CommandFailureCode<DerivedResponse>>().toEqualTypeOf<
        "EMAIL_TAKEN" | "EMAIL_INVALID"
      >();

      const response = await new DerivedHandler({}).execute(new TestCommand());

      if (!response.success) {
        switch (response.error) {
          case "EMAIL_TAKEN":
          case "EMAIL_INVALID":
            break;
          default: {
            const unreachable: never = response;
            void unreachable;
          }
        }
      }
    });

    it("rejects a list with a code that is not in the response type", () => {
      class OtherCodeHandler extends CommandHandler<TestCommand, TestResponse> {
        // @ts-expect-error TS2416: "OTHER" is not a code of TestResponse
        protected override readonly expectedCodes = [
          "EMAIL_TAKEN",
          "OTHER",
        ] as const;

        protected override async handle(): Promise<Payload> {
          return { id: "1" };
        }
      }

      void OtherCodeHandler;
    });

    it("rejects a list with no as const", () => {
      class WideListHandler extends CommandHandler<TestCommand, TestResponse> {
        // @ts-expect-error TS2416: the list is string[]
        protected override readonly expectedCodes = ["EMAIL_TAKEN"];

        protected override async handle(): Promise<Payload> {
          return { id: "1" };
        }
      }

      void WideListHandler;
    });

    it("rejects any code for a response type with no code", () => {
      class NoCodeTypeHandler extends CommandHandler<
        TestCommand,
        CommandResponse<Payload>
      > {
        // @ts-expect-error TS2416: the response type has no code
        protected override readonly expectedCodes = ["EMAIL_TAKEN"] as const;

        protected override async handle(): Promise<Payload> {
          return { id: "1" };
        }
      }

      void NoCodeTypeHandler;
    });

    it("rejects a handle() that returns another payload type", () => {
      class WrongPayloadHandler extends CommandHandler<
        TestCommand,
        TestResponse
      > {
        protected override readonly expectedCodes = ["EMAIL_TAKEN"] as const;

        // @ts-expect-error TS2416: id is a number
        protected override async handle(): Promise<{ id: number }> {
          return { id: 1 };
        }
      }

      void WrongPayloadHandler;
    });

    it("narrows the failure branch to the codes of the response type, with no exception", async () => {
      const response = await new TestHandler({
        run: returning({ id: "1" }),
      }).execute(new TestCommand());

      if (!response.success) {
        expectTypeOf(response.error).toEqualTypeOf<
          "EMAIL_TAKEN" | "EMAIL_INVALID"
        >();
      }

      // @ts-expect-error a response has no exception
      void response.exception;
    });

    it("gives the union of the codes as CommandFailureCode", () => {
      expectTypeOf<CommandFailureCode<TestResponse>>().toEqualTypeOf<
        "EMAIL_TAKEN" | "EMAIL_INVALID"
      >();
    });

    it("types the error of a response with no code as never", async () => {
      const response = await new NoCodesHandler({
        run: returning({ id: "1" }),
      }).execute(new TestCommand());

      if (!response.success) {
        expectTypeOf(response.error).toBeNever();
      }
    });
  });
});
