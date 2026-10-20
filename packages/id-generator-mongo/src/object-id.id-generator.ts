import { ObjectId } from "mongodb";
import type { IdGenerator } from "@enardo/id-generator";

export class ObjectIdGenerator implements IdGenerator {
  generate(): string {
    return new ObjectId().toHexString();
  }
}
