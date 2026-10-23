import { BaseError, type BaseErrorOptions } from "@enardo/errors";

type DuplicateRecordKeyErrorOptions = Omit<BaseErrorOptions, "code">;

/** Thrown when two records of one collection share a key, so a diff cannot tell them apart. */
export class DuplicateRecordKeyError extends BaseError {
  override readonly name = "DuplicateRecordKeyError";
  declare readonly code: "DUPLICATE_RECORD_KEY";

  constructor(
    collection: string,
    key: string,
    recordSet: "previous" | "next",
    options?: DuplicateRecordKeyErrorOptions,
  ) {
    super(
      `Collection "${collection}" of the ${recordSet} record set holds more than one record with key "${key}".`,
      {
        ...options,
        code: "DUPLICATE_RECORD_KEY",
        details: { collection, key, recordSet },
      },
    );
  }
}
