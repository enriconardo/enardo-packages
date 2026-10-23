import type { Query } from "~/query";
import type {
  QueryFailureCode,
  QueryResponse,
  QuerySuccessPayload,
} from "./query-response";
import { isBaseErrorLike } from "@enardo/errors";
import { createNoopLogger, type Logger, withLoggerContext } from "./logger";

export interface QueryHandlerOptions {
  logger?: Logger;
}

type QueryPayload<TResponse extends QueryResponse<unknown, string>> =
  QuerySuccessPayload<TResponse>;

export abstract class QueryHandler<
  TQuery extends Query,
  TResult extends QueryResponse<unknown, string>,
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
      const code = this.expectedCode(error);
      if (code === undefined) {
        throw error;
      }
      this.logger.debug("Query failed with an expected code.", {
        query: queryName,
        error: code,
      });
      return this.failureResponse(code);
    }
  }

  private expectedCode(error: unknown): QueryFailureCode<TResult> | undefined {
    if (!isBaseErrorLike(error)) {
      return undefined;
    }
    const code = error.code;
    return this.expectedCodes.find((expected) => expected === code);
  }

  protected successResponse(data: QueryPayload<TResult>): TResult {
    return {
      success: true,
      payload: data,
    } as TResult;
  }

  protected failureResponse(code: QueryFailureCode<TResult>): TResult {
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
  protected abstract readonly expectedCodes: readonly QueryFailureCode<TResult>[];

  protected abstract handle(command: TQuery): Promise<QueryPayload<TResult>>;
}
