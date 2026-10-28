import { MongoMemoryReplSet } from "mongodb-memory-server";

/**
 * Global setup of `mongoReplicaSet()`: starts one single-node replica set for
 * the whole run and provides its URI as `mongoUri`. Transactions and snapshot
 * reads need a replica set, and starting one per file would be slow.
 *
 * @param {import("vitest/node").TestProject} project
 * @returns {Promise<() => Promise<void>>}
 */
export default async function setup(project) {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  project.provide("mongoUri", replSet.getUri());

  return async () => {
    await replSet.stop();
  };
}
