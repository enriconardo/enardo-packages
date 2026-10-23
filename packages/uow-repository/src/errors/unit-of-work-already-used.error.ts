import { BaseError, type BaseErrorOptions } from "@enardo/errors";

type UnitOfWorkAlreadyUsedErrorOptions = Omit<BaseErrorOptions, "code">;

/** Thrown when `execute()` is called on a unit of work that was already executed. */
export class UnitOfWorkAlreadyUsedError extends BaseError {
  override readonly name = "UnitOfWorkAlreadyUsedError";
  declare readonly code: "UOW_ALREADY_USED";

  constructor(options?: UnitOfWorkAlreadyUsedErrorOptions) {
    super(
      "This unit of work has already been used; create a new one, with new repositories, for each execute call.",
      {
        ...options,
        code: "UOW_ALREADY_USED",
      },
    );
  }
}
