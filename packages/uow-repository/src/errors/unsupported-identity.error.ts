import { BaseError, type BaseErrorOptions } from "@enardo/errors";

type UnsupportedIdentityErrorOptions = Omit<BaseErrorOptions, "code">;

/** Thrown when a primitive identity key can't be derived from an identity. */
export class UnsupportedIdentityError extends BaseError {
  override readonly name = "UnsupportedIdentityError";

  constructor(identityType: string, options?: UnsupportedIdentityErrorOptions) {
    super(
      `Cannot derive an identity key from ${identityType}. Supply identityKey for composite identities.`,
      {
        ...options,
        code: "UNSUPPORTED_IDENTITY",
        details: { identityType },
      },
    );
  }
}
