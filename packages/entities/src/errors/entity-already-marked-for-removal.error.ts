import type { EntityLifecycleErrorContext } from "./entity-lifecycle.error";
import { EntityLifecycleError } from "./entity-lifecycle.error";

/**
 * Thrown when {@link AggregateRoot.markForRemoval} is called on an aggregate
 * that has already been marked for removal.
 */
export class EntityAlreadyMarkedForRemovalError extends EntityLifecycleError {
  override readonly name = "EntityAlreadyMarkedForRemovalError";
  declare readonly code: "ENTITY_ALREADY_MARKED_FOR_REMOVAL";

  constructor(context: EntityLifecycleErrorContext) {
    super(
      "Entity is already marked for removal",
      "ENTITY_ALREADY_MARKED_FOR_REMOVAL",
      context,
    );
  }
}
