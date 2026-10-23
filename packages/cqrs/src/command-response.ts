export interface CommandSuccessResponse<TPayload> {
  success: true;
  payload: TPayload;
  error?: never;
}

export interface CommandFailureResponse<TCode extends string> {
  success: false;
  error: TCode;
  payload?: never;
}

export type CommandResponse<TPayload = unknown, TCode extends string = never> =
  CommandSuccessResponse<TPayload> | CommandFailureResponse<TCode>;

export type CommandSuccessPayload<
  TResponse extends CommandResponse<unknown, string>,
> = Extract<TResponse, { success: true }>["payload"];

export type CommandFailureCode<
  TResponse extends CommandResponse<unknown, string>,
> = Extract<TResponse, { success: false }>["error"];
