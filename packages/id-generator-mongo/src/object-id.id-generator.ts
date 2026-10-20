import { ObjectId } from "mongodb";
import type { IdGenerator } from "@enardo/id-generator";

/**
 * Implements `IdGenerator` with MongoDB's `ObjectId`: each id is the hex
 * string of a new `ObjectId`, 24 lowercase hex characters.
 */
export class ObjectIdGenerator implements IdGenerator {
  generate(): string {
    return new ObjectId().toHexString();
  }
}
