export interface QuerySuccessResponse<TPayload> {
  success: true;
  payload: TPayload;
  error?: never;
  exception?: never;
}

export interface QueryFailureResponse {
  success: false;
  error: string;
  exception: unknown;
  payload?: never;
}

export type QueryResponse<TPayload = unknown> =
  QuerySuccessResponse<TPayload> | QueryFailureResponse;

export type QuerySuccessPayload<TResponse extends QueryResponse> = Extract<
  TResponse,
  { success: true }
>["payload"];
