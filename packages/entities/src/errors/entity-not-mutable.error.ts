import type { EntityLifecycleErrorContext } from "./entity-lifecycle.error";
import { EntityLifecycleError } from "./entity-lifecycle.error";

/**
 * Thrown when {@link AggregateRoot.setAttribute} (or any method that calls it)
 * is invoked on an aggregate that has already been marked for removal.
 */
export class EntityNotMutableError extends EntityLifecycleError {
  override readonly name = "EntityNotMutableError";
  declare readonly code: "ENTITY_NOT_MUTABLE";

  constructor(context: EntityLifecycleErrorContext) {
    super(
      "Cannot mutate an entity marked for removal",
      "ENTITY_NOT_MUTABLE",
      context,
    );
  }
}
