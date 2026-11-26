# Task journal

branch: chore/vitest-config/widen-mongodb-memory-server-peer
tier: L
command: task
phase: close/check
base: aa46498
started: 2026-11-26T12:58:29Z
verify_red_streak: 0

spec: .workflow/specs/2026-11-26-widen-mongodb-memory-server-peer.md

## Intent

### Intent: widen the mongodb-memory-server peer of @enardo/vitest-config to ^11

Problem: @enardo/vitest-config declares mongodb-memory-server as an optional peer through `catalog:`, which packs as ^10.4.3. A consumer on mongodb-memory-server 11 gets an unmet peer.

Goal: the peer accepts 10 and 11, and the repo tests against 11.

Decisions of the human (2026-11-26, "1 sì, 2 sì, 3 sì; vai con L"):
1. Peer range `^10.4.3 || ^11.0.0` (widen, keep 10), written in package.json instead of `catalog:`.
2. The catalog entry mongodb-memory-server moves to ^11 (^11.4.0): the devDependencies of vitest-config, database-mongo, transaction-manager-mongo and uow-repository-mongo run on 11; 10 stays declared, no longer tested.
3. The change is a minor: @enardo/vitest-config 1.1.0, published after the merge through the `publish` skill.

Tier: L (a consumer-visible dependency range; the catalog upgrade changes the mongod of three packages' tests).

Constraints: code uses only MongoMemoryReplSet.create({ replSet: { count: 1 } }), getUri(), stop(). v11 needs Node >=20.19.0; the dev container runs Node 24. pnpm runs only in the dev container; the firewall allows the Mongo download.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-26T12:58:29Z opened on aa46498 of main
- 2026-11-26T12:58:32Z human: peer ^10.4.3 || ^11.0.0; catalog to ^11; minor 1.1.0 published after merge; tier L ("1 sì, 2 sì, 3 sì; vai con L")
- 2026-11-26T12:59:13Z map: .git/overload/kept/chore/vitest-config/widen-mongodb-memory-server-peer/map.md
- 2026-11-26T13:02:01Z spec review round 1: 0 blocking (3 minor accepted: CLAUDE.md exception for written peer ranges, misplaced JSON sentence, pnpm peers check)
- 2026-11-26T13:07:37Z human: spec approved, CLAUDE.md exception included ("approvata, vai")
