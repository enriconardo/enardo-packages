import { ObjectId } from "mongodb";
import type { IdGenerator } from "~/id-generator";

export class ObjectIdGenerator implements IdGenerator {
  generate(): string {
    return new ObjectId().toHexString();
  }
}
