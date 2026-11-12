# Task journal

branch: docs/repo/drop-flaky-verify-backlog-item
tier: S
phase: s/implement
base: 7402224
started: 2026-11-12T10:04:51Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

## Intent

Problem: the backlog item "`verify:all --force` fails about one run in three with packages in parallel." (from chunk 2 of chore/repo/dev-container-environment, 2026-11-11) suspects port collisions across packages, unproven, from one failing log no longer available.
Goal: judge whether it still holds and follows best practice; fix it if so.
Finding: 6 uncached `turbo run test --force` and 4 `pnpm verify:all --force` on main (2026-11-12) were all green (86/86 tasks each), with no "Port already in use" nor mongod invariant failure; at one in three, ten greens in a row has ~1.7% chance. Two latent races exist (startClosedSmtpServer reuses a freed ephemeral port; mongodb-memory-server probes a port then releases it before mongod binds), each of very low probability.
Decision (human): "droppa pure" — move the item to Dropped, no code change.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-12T10:04:51Z opened on 7402224 of main
- 2026-11-12T10:04:58Z human: drop the item (option B), no fix of the latent races
