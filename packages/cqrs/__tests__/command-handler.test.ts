import { describe, expect, expectTypeOf, it } from "vitest";
import {
  Command,
  CommandHandler,
  type CommandFailureCode,
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

/** Lists both codes of its response type. */
class TestHandler extends CommandHandler<TestCommand, TestResponse> {
  protected override readonly expectedCodes = [
    "EMAIL_TAKEN",
    "EMAIL_INVALID",
  ] as const;

  constructor(private readonly run: () => Promise<Payload>) {
    super();
  }

  protected override handle(): Promise<Payload> {
    return this.run();
  }
}

/** Lists only one of the two codes of its response type. */
class OnlyInvalidHandler extends CommandHandler<TestCommand, TestResponse> {
  protected override readonly expectedCodes = ["EMAIL_INVALID"] as const;

  constructor(private readonly run: () => Promise<Payload>) {
    super();
  }

  protected override handle(): Promise<Payload> {
    return this.run();
  }
}

/** A response type with no code, and an empty list. */
class NoCodesHandler extends CommandHandler<
  TestCommand,
  CommandResponse<Payload>
> {
  protected override readonly expectedCodes = [];

  constructor(private readonly run: () => Promise<Payload>) {
    super();
  }

  protected override handle(): Promise<Payload> {
    return this.run();
  }
}

/** A `handle()` that is not `async`, and throws before returning a promise. */
class SyncThrowingHandler extends CommandHandler<TestCommand, TestResponse> {
  protected override readonly expectedCodes = [
    "EMAIL_TAKEN",
    "EMAIL_INVALID",
  ] as const;

  constructor(private readonly thrown: unknown) {
    super();
  }

  protected override handle(): Promise<Payload> {
    throw this.thrown;
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
      const handler = new TestHandler(returning({ id: "1" }));

      await expect(handler.execute(new TestCommand())).resolves.toStrictEqual({
        success: true,
        payload: { id: "1" },
      });
    });

    it("resolves to a failure with only the code of a BaseError with a listed code", async () => {
      const handler = new TestHandler(throwing(emailTaken()));

      await expect(handler.execute(new TestCommand())).resolves.toStrictEqual({
        success: false,
        error: "EMAIL_TAKEN",
      });
    });

    it("rejects with the same BaseError when its code is not listed", async () => {
      const error = new TestError("OTHER_CODE");
      const handler = new TestHandler(throwing(error));

      await expect(handler.execute(new TestCommand())).rejects.toBe(error);
    });

    it("rejects with an Error that has a listed code but no brand", async () => {
      const error = unbrandedError("EMAIL_TAKEN");
      const handler = new TestHandler(throwing(error));

      await expect(handler.execute(new TestCommand())).rejects.toBe(error);
    });

    it("rejects with a native Error, whose message never becomes a failure", async () => {
      const error = new Error("getaddrinfo EAI_AGAIN smtp.internal.corp.test");
      const handler = new TestHandler(throwing(error));

      await expect(handler.execute(new TestCommand())).rejects.toBe(error);
    });

    it("rejects with a thrown string", async () => {
      const handler = new TestHandler(throwing("boom"));

      await expect(handler.execute(new TestCommand())).rejects.toBe("boom");
    });

    it("resolves to a failure for a branded error that is not an instance of this copy's BaseError", async () => {
      const handler = new TestHandler(throwing(brandedObject("EMAIL_TAKEN")));

      await expect(handler.execute(new TestCommand())).resolves.toStrictEqual({
        success: false,
        error: "EMAIL_TAKEN",
      });
    });

    it("rejects with the same branded object when reading its code throws", async () => {
      const thrown = brandedObjectWithThrowingCode();
      const handler = new TestHandler(throwing(thrown));

      await expect(handler.execute(new TestCommand())).rejects.toBe(thrown);
    });

    it("rejects with a BaseError whose code is in the response type but not in the list", async () => {
      const error = emailTaken();
      const handler = new OnlyInvalidHandler(throwing(error));

      await expect(handler.execute(new TestCommand())).rejects.toBe(error);
    });

    it("rejects with any BaseError when the list is empty", async () => {
      const error = emailTaken();
      const handler = new NoCodesHandler(throwing(error));

      await expect(handler.execute(new TestCommand())).rejects.toBe(error);
    });

    describe("when handle() throws synchronously", () => {
      it("returns a promise that resolves to the failure of a listed BaseError", async () => {
        const handler = new SyncThrowingHandler(emailTaken());
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
        const handler = new SyncThrowingHandler(error);
        let result: unknown;

        expect(() => {
          result = handler.execute(new TestCommand());
        }).not.toThrow();
        expect(result).toBeInstanceOf(Promise);
        await expect(result).rejects.toBe(error);
      });
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

      const response = await new DerivedHandler().execute(new TestCommand());

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
      const response = await new TestHandler(returning({ id: "1" })).execute(
        new TestCommand(),
      );

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
      const response = await new NoCodesHandler(returning({ id: "1" })).execute(
        new TestCommand(),
      );

      if (!response.success) {
        expectTypeOf(response.error).toBeNever();
      }
    });
  });
});
