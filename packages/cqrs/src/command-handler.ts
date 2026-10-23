import { isBaseErrorLike } from "@enardo/errors";
import type { Command } from "~/command";
import type {
  CommandResponse,
  CommandFailureCode,
  CommandSuccessPayload,
} from "./command-response";
import { createNoopLogger, type Logger, withLoggerContext } from "./logger";

export interface CommandHandlerOptions {
  logger?: Logger;
}

type CommandPayload<TResponse extends CommandResponse<unknown, string>> =
  CommandSuccessPayload<TResponse>;

export abstract class CommandHandler<
  TCommand extends Command,
  TResult extends CommandResponse<unknown, string>,
  TOptions extends CommandHandlerOptions = CommandHandlerOptions,
> {
  protected readonly logger: Logger;
  protected readonly options: TOptions;

  constructor(options: TOptions) {
    this.options = options;
    this.logger = withLoggerContext(
      options.logger ?? createNoopLogger(),
      this.constructor.name || "CommandHandler",
    );
  }

  /**
   * Resolves to the payload, or to a failure when `handle()` throws an error
   * with a code in `expectedCodes`. Rejects with every other error.
   */
  async execute(command: TCommand): Promise<TResult> {
    const commandName = command.constructor.name || "UnknownCommand";

    this.logger.debug("Executing command.", {
      command: commandName,
    });

    try {
      const result = await this.handle(command);
      this.logger.debug("Command executed successfully.", {
        command: commandName,
      });
      return this.successResponse(result);
    } catch (error) {
      const code = this.expectedCode(error);
      if (code === undefined) {
        throw error;
      }
      this.logger.debug("Command failed with an expected code.", {
        command: commandName,
        error: code,
      });
      return this.failureResponse(code);
    }
  }

  private expectedCode(
    error: unknown,
  ): CommandFailureCode<TResult> | undefined {
    if (!isBaseErrorLike(error)) {
      return undefined;
    }
    const code = error.code;
    return this.expectedCodes.find((expected) => expected === code);
  }

  protected successResponse(data: CommandPayload<TResult>): TResult {
    return {
      success: true,
      payload: data,
    } as TResult;
  }

  protected failureResponse(code: CommandFailureCode<TResult>): TResult {
    return {
      success: false,
      error: code,
    } as TResult;
  }

  /**
   * The codes of the response type that `execute()` returns as a failure: a
   * thrown error that `isBaseErrorLike` recognizes, with one of these codes.
   * Any other error is rethrown. Declare it `as const`; `[]` for none.
   */
  protected abstract readonly expectedCodes: readonly CommandFailureCode<TResult>[];

  protected abstract handle(
    command: TCommand,
  ): Promise<CommandPayload<TResult>>;
}
