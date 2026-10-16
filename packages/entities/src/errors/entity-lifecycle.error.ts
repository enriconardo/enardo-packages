import { BaseError } from "@enardo/errors";

export type EntityLifecycleErrorCode =
  "ENTITY_ALREADY_MARKED_FOR_REMOVAL" | "ENTITY_NOT_MUTABLE";

export interface EntityLifecycleErrorContext extends Record<string, unknown> {
  entityType: string;
  entityId?: unknown;
}

/**
 * Base error for all aggregate-root lifecycle violations.
 *
 * Subclasses pin a specific {@link EntityLifecycleErrorCode} and an optional
 * context object for structured logging or error reporting.
 */
export abstract class EntityLifecycleError extends BaseError {
  /** Machine-readable error code. */
  declare readonly code: EntityLifecycleErrorCode;
  declare readonly details: EntityLifecycleErrorContext;

  constructor(
    message: string,
    code: EntityLifecycleErrorCode,
    context: EntityLifecycleErrorContext,
  ) {
    super(message, {
      code,
      details: context,
    });
  }

  /** Contextual information about the entity that raised the error. */
  get context(): EntityLifecycleErrorContext {
    return this.details;
  }
}
