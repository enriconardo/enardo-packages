import { BaseError, type BaseErrorOptions } from "@enardo/errors";

type InvalidRecordSetErrorOptions = Omit<BaseErrorOptions, "code">;

/** Thrown when a record set lacks a collection its key functions describe. */
export class InvalidRecordSetError extends BaseError {
  override readonly name = "InvalidRecordSetError";

  constructor(
    collection: string,
    recordSet: "previous" | "next",
    options?: InvalidRecordSetErrorOptions,
  ) {
    super(
      `Collection "${collection}" of the ${recordSet} record set is not an array of records.`,
      {
        ...options,
        code: "INVALID_RECORD_SET",
        details: { collection, recordSet },
      },
    );
  }
}
