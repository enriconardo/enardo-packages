import type { Query } from "~/query";
import type { QueryResponse, QuerySuccessPayload } from "./query-response";
import { BaseError } from "@enardo/errors";
import { createNoopLogger, type Logger, withLoggerContext } from "./logger";

export interface QueryHandlerOptions {
  logger?: Logger;
}

type QueryPayload<TResponse extends QueryResponse> =
  QuerySuccessPayload<TResponse>;

export abstract class QueryHandler<
  TQuery extends Query,
  TResult extends QueryResponse,
  TOptions extends QueryHandlerOptions = QueryHandlerOptions,
> {
  protected readonly logger: Logger;
  protected readonly options: TOptions;

  constructor(options: TOptions) {
    this.options = options;
    this.logger = withLoggerContext(
      options.logger ?? createNoopLogger(),
      this.constructor.name || "QueryHandler",
    );
  }

  async execute(query: TQuery): Promise<TResult> {
    const queryName = query.constructor.name || "UnknownQuery";

    this.logger.debug("Executing query.", {
      query: queryName,
    });

    try {
      const result = await this.handle(query);
      this.logger.debug("Query executed successfully.", {
        query: queryName,
      });
      return this.successResponse(result);
    } catch (error) {
      this.logger.error("Query execution failed.", {
        query: queryName,
        error,
      });
      return this.failureResponse(error);
    }
  }

  protected successResponse(data: QueryPayload<TResult>): TResult {
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

  protected abstract handle(command: TQuery): Promise<QueryPayload<TResult>>;
}
