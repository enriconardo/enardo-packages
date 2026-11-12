# Task journal

branch: docs/repo/rewrite-eproxy-backlog-item
tier: S
phase: s/implement
base: 24b6363
started: 2026-11-12T09:12:48Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

## Intent

### Intent

Rewrite the backlog item "EPROXY of @enardo/email-nodemailer comes out retryable: false, for an outage too" with the analysis of 2026-11-12 on nodemailer 10.1.0's source.

- Problem: the item proposes adding EPROXY to CONNECTION_FAILURES as a whole. EPROXY has six origins in nodemailer 10.1.0; a socks proxy (no module can be set) and an unknown proxy protocol fail every send, so a blanket retryable makes them retry each message. Reading the status from `message` is excluded by the README ("match no string on them").
- Goal: the item records the origins and the better first step (reject a non-HTTP proxy at construction with a TypeError), leaving EPROXY's classification a decision still to take (503 vs 407), as an L task and a major.
- Decision of the human: do not resolve it now; "ok riscrivilo e basta". The trigger stays: a project that configures a proxy.
- Docs only: .workflow/backlog.md.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-12T09:12:48Z opened on 24b6363 of main
