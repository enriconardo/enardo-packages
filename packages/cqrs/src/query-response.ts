export interface QuerySuccessResponse<TPayload> {
  success: true;
  payload: TPayload;
  error?: never;
}

export interface QueryFailureResponse<TCode extends string> {
  success: false;
  error: TCode;
  payload?: never;
}

export type QueryResponse<TPayload = unknown, TCode extends string = never> =
  QuerySuccessResponse<TPayload> | QueryFailureResponse<TCode>;

export type QuerySuccessPayload<
  TResponse extends QueryResponse<unknown, string>,
> = Extract<TResponse, { success: true }>["payload"];

export type QueryFailureCode<TResponse extends QueryResponse<unknown, string>> =
  Extract<TResponse, { success: false }>["error"];
