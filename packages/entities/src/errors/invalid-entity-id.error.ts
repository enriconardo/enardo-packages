import { BaseError } from "@enardo/errors";

export type InvalidEntityIdReason = "empty";

export interface InvalidEntityIdDetails extends Record<string, unknown> {
  entityId: string;
  reason: InvalidEntityIdReason;
}

export class InvalidEntityIdError extends BaseError {
  override readonly name = "InvalidEntityIdError";
  declare readonly details: InvalidEntityIdDetails;

  constructor(entityId: string, reason: InvalidEntityIdReason) {
    let message: string;

    switch (reason) {
      case "empty":
        message = "EntityId cannot be empty";
        break;
    }

    const details: InvalidEntityIdDetails = {
      entityId,
      reason,
    };

    super(message, {
      code: "INVALID_ENTITY_ID",
      details,
    });
  }
}
