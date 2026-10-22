---
status: done
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/logger"]
branch: fix/logger/color-only-on-tty
---

# Color the console logger's pretty output only where colors are wanted

## Why

The console logger colors its `pretty` output (the default format) wherever it writes: through a pipe or into a file. A server that keeps the defaults, as Cambusa's api-server does, would send ANSI escape codes to its log collector; Cambusa has no deployment yet, so none receives them today. The root cause: `createPrettyFormat` always puts `winston.format.colorize({ all: true })` first, and `logform/colorize` sets the global `colors.enabled = true` when it loads, so `@colors/colors`' own TTY checks never apply.

From the backlog's *Queued* item, out of the architectural review of `@enardo/logger` (2026-10-22).

## Probes

All in the dev container, Node v24.21.0, winston 3.19.0, `@colors/colors` 1.6.0, after `pnpm exec turbo run build --filter=@enardo/logger... --force`.

- `createLogger("console").info("hi", { a: 1 })` from `dist/`, piped to `od -c` → `\033[32m` before the level.
- `logform/colorize.js` → line 9, `colors.enabled = true` at load, global to every user of `@colors/colors/safe`: a per-logger choice has to leave `colorize()` out of the format, not toggle the flag.
- `winston/transports/console.js` → with no `stderrLevels` and no `consoleWarnLevels` (`_stringArrayToSet(undefined)` is `{}`, line 107), every entry goes to `console._stdout`, which is `process.stdout`. `createConsoleLogger` passes neither (`src/winston/winston-console.factory.ts:102`): `process.stdout` is the only stream to check.
- A piped `process.stdout` → `isTTY` is `undefined`.
- `@colors/colors/safe` before and after `import("./dist/index.mjs")` → `enabled` turns from `false` to `true` (the critic's probe): winston's config loads `logform/levels.js`, which requires `colorize.js`.
- Inside a vitest worker of this package → `process.stdout.isTTY` unset: every existing test runs on the non-TTY path.
- `git grep` for `raw()`, `\u001b`, `\x1b` in `packages/logger` → no existing test asserts on ANSI codes; they read `captureConsoleLines().lines()`, which strips them (`__tests__/support/capture-console.ts`).

## Decisions

Proposed at intake and approved by the user; revised with the user at checkpoint 2, after a first implementation that followed `FORCE_COLOR` and `NO_COLOR`:

- **The default format stays `pretty`**, on a terminal or not. Only the colors follow the output. Switching to `json` off a terminal was the other option: it changes the shape of every line a collector receives, a new major, and a server that wants JSON already says so.
- **A `colors?: boolean` option on `ConsoleLoggerOptions`**, the app's decision in its code:
  - `true`: always colors; `false`: never, on a terminal too.
  - Absent: colors when `process.stdout.isTTY` is `true`.
  - `format: "json"` never colors, whatever `colors` says.
- **No environment variables.** The logger reads neither `FORCE_COLOR` nor `NO_COLOR`, nor calls `hasColors()`: one rule, in the app's code, is simpler than following Node's conventions. A `TERM=dumb` terminal gets colors unless the app passes `colors: false`.
- **The choice is made once, when the logger is created**, as the format is today; its children share it.
- **A minor: 1.1.0**, for the new option. Publishing is a session of its own. The version also ships the fixes of `fix/logger/reserved-entry-fields`, merged with the version left at the published 1.0.0.

## Open questions

None.

## Changes

`@enardo/logger`:

- `src/logger.ts`: `ConsoleLoggerOptions.colors?: boolean`, with JSDoc: `true` always, `false` never, absent only when stdout is a terminal; `json` never colors. The JSDoc of `format` loses the color rules it has on the branch.
- `src/winston/winston-console.factory.ts`: `options.colors ?? process.stdout.isTTY === true`, read at creation; `createPrettyFormat` includes `colorize({ all: true })` only when it is `true`. The branch's `FORCE_COLOR` and `hasColors()` resolution goes.
- `package.json`: `version` 1.1.0.
- `docs/backlog.md`: the item leaves, in a commit of its own (done).

## Test cases

Through `createLogger("console", …)`, reading `captureConsoleLines().raw()`. Each case sets `process.stdout.isTTY` on the real `process.stdout`, and restores it after. "Colored" means the raw line holds an ANSI escape around both the level and the message (`all: true`); "plain" means it holds none.

1. Default options, `isTTY` unset → plain. Fails on main: the bug.
2. Default options, `isTTY: true` → colored.
3. Default options, `isTTY: false` → plain.
4. `colors: true`, `isTTY` unset → colored.
5. `colors: false`, `isTTY: true` → plain.
6. `format: "json"`, `colors: true`, `isTTY: true` → plain.
7. Created with `isTTY: true`, then `isTTY` unset before logging → colored, and so is a `child()` of it: the choice is made at creation.
8. The text of a colored line with the codes stripped equals the plain line of the same entry, with `timestamp: false`: colors change nothing else.

## Risks

`low`: a consumer reading a terminal through a tool that is no TTY (a container run without a TTY, a CI log) loses its colors; `colors: true` brings them back. The reverse stays: a server in a container with a TTY (`docker run -t`, `tty: true`, as Cambusa's dev service has) still colors into its log driver unless it passes `colors: false`. Whether Cambusa's `pnpm dev` (`turbo run dev`, then `tsx watch`) gives the api-server a terminal is not probed: if not, its dev logs lose their colors until it passes `colors: true` in development, in Cambusa's repo.

## Out of scope

- The default format off a terminal (see *Decisions*).
- The README of `@enardo/logger`: the last *Queued* item, after this one.
- Writing some levels to stderr.
- The global `colors.enabled = true` that loading winston sets: other code that uses the same `@colors/colors` instance keeps coloring into pipes. No consumer does today.

## Plan

1. Test-first: cases 1–8 replace the suite in `__tests__/winston/console-colors.test.ts`, red where the branch differs (2, 4). Then the resolution. Green, committed.
2. The option's JSDoc and the version. Committed.
