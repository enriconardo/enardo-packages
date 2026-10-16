export interface CommandSuccessResponse<TPayload> {
  success: true;
  payload: TPayload;
  error?: never;
  exception?: never;
}

export interface CommandFailureResponse {
  success: false;
  error: string;
  exception: unknown;
  payload?: never;
}

export type CommandResponse<TPayload = unknown> =
  CommandSuccessResponse<TPayload> | CommandFailureResponse;

export type CommandSuccessPayload<TResponse extends CommandResponse> = Extract<
  TResponse,
  { success: true }
>["payload"];
