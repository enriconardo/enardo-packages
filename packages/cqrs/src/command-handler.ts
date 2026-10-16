import { BaseError } from "@enardo/errors";
import type { Command } from "~/command";
import type {
  CommandResponse,
  CommandSuccessPayload,
} from "./command-response";
import { createNoopLogger, type Logger, withLoggerContext } from "./logger";

export interface CommandHandlerOptions {
  logger?: Logger;
}

type CommandPayload<TResponse extends CommandResponse> =
  CommandSuccessPayload<TResponse>;

export abstract class CommandHandler<
  TCommand extends Command,
  TResult extends CommandResponse,
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
      this.logger.error("Command execution failed.", {
        command: commandName,
        error,
      });
      return this.failureResponse(error);
    }
  }

  protected successResponse(data: CommandPayload<TResult>): TResult {
    return {
      success: true,
      payload: data,
    } as TResult;
  }

  protected failureResponse(error: unknown): TResult {
    return {
      success: false,
      error: this.mapErrorToString(error),
      exception: error,
    } as TResult;
  }

  protected mapErrorToString(error: unknown): string {
    if (error instanceof BaseError) {
      return error.code;
    } else if (error instanceof Error) {
      return error.message;
    }

    return "INTERNAL_ERROR";
  }

  protected abstract handle(
    command: TCommand,
  ): Promise<CommandPayload<TResult>>;
}
