---
status: done
type: fix
packages: [repo]
branch: fix/repo/dev-exec-signals
---

# A command run through dev.sh outlives dev.sh

## Report

A command started with `./dev.sh exec` keeps running in the dev container when `dev.sh` is stopped, except by a Ctrl-C typed into a terminal. During the manual check of `fix/cambusa/api-server/json-not-found`, Claude Code stopped the background task that ran `./dev.sh exec pnpm --filter @cambusa/api-server dev`. The api-server stayed up on port 3010 until it was killed by hand inside the container.

Probed on `master` (`ffed92f`), docker 29.8.1, compose v5.5.1, with `./dev.sh exec sleep N` unless stated:

| How `dev.sh` is stopped | The command in the container |
| --- | --- |
| No TTY: SIGTERM, SIGINT, SIGHUP or SIGKILL to the `docker compose` client | keeps running |
| No TTY: the same four signals to the whole process group | keeps running |
| No TTY: SIGTERM, SIGHUP or SIGKILL to `dev.sh` alone | keeps running, and the client is left orphaned on the host |
| Claude Code's `TaskStop` on a background task (probed: SIGTERM to every process of the tree) | keeps running |
| TTY: Ctrl-C | stops |
| TTY: the terminal is closed | keeps running |
| TTY: SIGTERM to the process group | keeps running |
| `./dev.sh shell`, with `sleep N & sleep N` typed in it, then the terminal closed | the shell and both sleeps keep running |

What leaks holds what it held: ports 3010 and 5183 for a dev server, and CPU for a watch task. `pnpm cambusa:dev` alone leaves about 40 processes behind.

## Root cause

- **docker forwards no signal to an exec'd command** (the first two rows). `docker run` has `--sig-proxy`; `docker exec` and `compose exec` have nothing like it.
- **An exec'd command does not depend on its client.** Killing the client, or closing its terminal, only detaches the streams. Even with a TTY, the command gets no hangup: the pty belongs to the daemon, not to the client.
- **Ctrl-C works with a TTY only because it is not a signal on the host.** The client puts the terminal in raw mode, so `^C` travels to the container's pty as a character, and that pty raises SIGINT inside the container.
- **`dev.sh` adds nothing on top.** It runs `compose exec` in the foreground and sets no trap. bash would not run a trap while a foreground command runs anyway (probed: a TERM trap set in a script ran only when its `sleep 4` ended).

Two facts about the container, probed, shape the fix:

1. **docker starts every exec'd command as the leader of its own session** (PID = PGID = SID, PPID 0).
2. **Everything the command starts stays in that session, but not always in its process group or its environment.** Under `pnpm cambusa:dev`, turbo puts each task in a process group of its own, and the tasks do not inherit a variable passed with `compose exec -e`, consistent with turbo's strict env mode. All of them still share the session.

## Fix

**`dev.sh` passes on the signals it gets to the session of the command it started, in the container.**

1. **`run_in_dev <command…>`** is a new function in `dev.sh`:
   - it draws a marker, `<dev.sh's PID>-<$RANDOM>`;
   - it sets traps on HUP, INT and TERM;
   - it starts `compose exec -e DEV_SH_SESSION=<marker> dev <command…>` in the background, with `<&0`;
   - it `wait`s for it, clears the traps, and returns its exit status.
   - Why in the background: bash interrupts a `wait` to run a trap, but runs no trap while a foreground command runs. Why `<&0`: without it, a background command reads from `/dev/null`, so it loses the terminal and its piped input (probed: a background `cat` got nothing from a pipe, and with `<&0` got it).
2. **The trap** clears the traps and runs `compose exec -T dev bash docker/dev/stop-session.sh <marker> <signal>`, with its three streams on `/dev/null`, since after a HUP the terminal is gone. Then `dev.sh` exits with `128 +` the signal's number: 129, 130 or 143.
3. **`docker/dev/stop-session.sh`** is a new bash script, run in the dev container through the bind mount. Given a marker and a signal, it:
   - finds the sessions of the processes whose `/proc/<pid>/environ` holds `DEV_SH_SESSION=<marker>`. It retries for up to 1 s, in case the command has not started yet.
   - sends the signal to every process of those sessions (`pkill -<signal> -s <sid>`);
   - waits up to 10 s for the sessions to have no live process left (zombies do not count), then sends SIGKILL to what is left.
4. **`./dev.sh exec`** and **`./dev.sh shell`** go through `run_in_dev`. For `shell`, this applies when the service is `dev`, so `./dev.sh up` is covered too.

### Changed after review

The review found that the command still outlived `dev.sh` when the client ended while `dev.sh` got no signal it could trap. Probed on the first version of the fix, and the same on `master`:
- **a pipe after `dev.sh` closes early** (`./dev.sh exec … | head -2`): the client exits 255 on EPIPE;
- **SIGTERM to the client alone**, the first row of *Report*: the client exits 130;
- **`dev.sh` started with SIGINT ignored**, as every `&` job of a non-interactive shell is: bash silently skips a trap on a signal ignored on entry, and the client catches SIGINT itself and exits 130.

So the fix grows:
1. **After `wait`, a status of 128 or more makes `dev.sh` signal the session with HUP, with a single lookup.** HUP, because what the command was attached to is gone. A single lookup, because the command has started. The success path (0–127) is unchanged.
   - The status is also 128 or more when the command itself was killed. With a TTY, a Ctrl-C now takes 0.18 s to give the prompt back, against 0.02 s on `master`. That is the time of a lookup that finds nothing.
2. **QUIT is trapped too**, like HUP, INT and TERM: Ctrl-\ without a TTY used to kill `dev.sh` and leave the command running.
3. **`stop-session.sh` takes a third argument, the number of lookups**: 10 from a trap, 1 after `wait`.
4. **One `grep -lsxzF` over every `/proc/*/environ`, instead of one `grep` per process.** One pass took 2 ms in the container. With a `grep` per process, a pass took about 0.11 s, and a lookup that found nothing took 2.1 s in all (measured in review, with 121 `/proc` entries). So the 10 lookups take about 1 s, as *Fix* item 3 says. grep exits 2 for the entries it cannot read, even when it found a match, hence `|| true`.

The trap path stays as described above, under the name `on_signal`. Its call to the script became `signal_session`, which the check after `wait` shares.

### Changed after the second review

The second review found that the check after `wait` said one thing and did another:
- **It also fired when the command itself exited 128 or more**, and then stopped processes the command had left running on purpose. Probed in review: `./dev.sh exec sh -c 'sleep N & exit 130'` stopped `sleep N`, while the same with `exit 0` left it running. In `./dev.sh shell`, whether your background jobs outlived the shell depended on the status of the last command you ran.
- **128 is not a signal status**: git exits 128 on `fatal:`.
- **It cannot catch a QUIT that `dev.sh` could not trap.** The compose client is a Go program, and Go exits 2 on a SIGQUIT it does not handle.
- **A second signal within about 50 ms of the first left the command running.** It killed the client of `stop-session.sh` before that client reached the container (probed in review: INT and TERM, 20 and 50 ms apart).

So:
1. **`stop-session.sh`'s third argument becomes a mode.**
   - `trapped`: 10 lookups, as before.
   - `client-ended`: one lookup, and nothing happens unless the command docker started still runs.
   - That command is the one marked process whose parent is outside the container: its PPID is 0. Its children have a real PPID, even after a `setsid` (probed).
2. **The check after `wait` fires above 128, not from 128,** and uses `client-ended`. A command that ended on its own keeps its leftovers, whatever its status, as on the success path.
3. **The client of `stop-session.sh` gets a process group of its own** (`set -m` around its launch, probed: no job notice is printed). `dev.sh` ignores HUP, INT, QUIT and TERM until it is launched, then restores them. A second signal still ends `dev.sh` at once, but it no longer reaches that client.
4. **The comment in `run_in_dev`** no longer claims that the check after `wait` covers every signal ignored on entry. QUIT goes to *Out of scope*.

The tools it uses are in the image: `pkill` and `ps` (procps-ng 4.0.2), `grep -z` (GNU grep 3.8) and `seq` (coreutils).

### Decisions (to confirm at checkpoint 1)

1. **The session is the unit that gets stopped, not the process group or the marker.**
   - Only the exec'd command and its direct line carry the marker. Killing those would miss turbo's tasks.
   - Every process stays in the session unless it calls `setsid` itself, which nothing in the repo does today. *Corrected after review:* even then it keeps the marker, so its new session is found and stopped as well (probed).
   - Two `dev.sh exec` running side by side are two sessions: stopping one leaves the other running (probed).
2. **The signal is passed on as it came, then SIGKILL after 10 s.**
   - HUP is what lets an interactive bash in the container end the way it does on a local terminal: it ignores TERM and INT.
   - INT is what a Ctrl-C would have sent.
   - SIGKILL catches what ignores the signal:
     - the background jobs of a non-interactive `sh -c`, which ignore SIGINT (probed: killed at the 10 s mark);
     - turbo, which takes about 10 s to exit after SIGTERM although its tasks are gone within a second (probed twice: once it exited on its own just inside the 10 s, once it got the SIGKILL).
   - The ports are free as soon as the tasks have stopped, long before the SIGKILL.
3. **The stopping runs in the container, not on the host.** It also outlives its own client: during the `TaskStop` probe, `dev.sh` was gone from the host before the 10 s ended, and the script still sent the SIGKILL.
4. **A script file instead of inline shell in `dev.sh`.** `pnpm verify` runs shellcheck on the tracked `*.sh` files: it would see only a string inside `dev.sh`.
5. **A marker in the environment, not a PID file.** It needs no file to write or clean up, and it costs nothing while the command runs normally. Without a TTY, `./dev.sh exec true` took 0.56 s against 0.60 s on `master`, one run each: no measurable difference.
6. **The success path does not change.** Probed with the prototype:
   - the exit status passes through (0, 3);
   - stdout and stderr stay separate;
   - piped stdin still reaches the command;
   - a closed stdin works;
   - a TTY is still allocated (`tty` prints `/dev/pts/1`);
   - Ctrl-C with a TTY stops the command without involving the trap, and `dev.sh` exits with 130.

## Out of scope

- **SIGKILL to `dev.sh` itself.** It cannot be trapped, so the command keeps running, as it does today.
- **A SIGQUIT that `dev.sh` cannot trap:** sent to the client alone, or to a `dev.sh` that started with QUIT ignored. The client exits 2, which cannot be told apart from a command's own status, so the command keeps running. *Corrected after the third review:* catching it would not cost a lookup after every command, as this bullet first said. With `client-ended`, a lookup after every status 2 is enough, and it is safe there. That costs about 0.15 s after each command that exits 2 (`tsc` with type errors, for one), and never after a 0.
- **A HUP that `dev.sh` cannot trap** (`dev.sh` started under `nohup`): the client keeps it ignored too, so nothing ends, as `nohup` asks (probed in the third review). A later INT or TERM still stops everything.
- **`./dev.sh shell <service>` for services other than `dev`.** `stop-session.sh` is only mounted in `dev`, and a shell in `cambusa-mongodb` starts nothing that holds a port.
- **A process that leaves the session with `setsid` and also drops `DEV_SH_SESSION` from its environment.** It survives. *Corrected after review:* the first version of this spec said that any process started with `setsid` survives. It does not, because it keeps the marker.
- **Zombies.** PID 1 in the dev container is `sleep infinity`, which never reaps orphans: 81 zombies had piled up during these probes. Stopping a whole session orphans more processes, so it adds to the pile. They hold no port and no memory, only PIDs. `init: true` in the compose file would fix this, but it recreates the container. It goes to the backlog's *To evaluate*.

## Test plan

**Override of the test-first default**, for this reason: the repo has no test harness for shell scripts. eslint and vitest do not see them, only shellcheck does, and bringing in one (bats, for example) means a new library. The bug was reproduced on `master` by the probes in *Report*, and the manual check below re-runs the same probes on the branch, so the fix is seen to change their outcome.

**Automated:** `pnpm verify`, whose `lint:sh` runs shellcheck on `dev.sh` and the new script.

**Manual check**, with the real `dev.sh` of the branch. Each case lists the expected `dev.sh` exit status, and the expected state of the container afterwards.

1. No TTY, `exec sh -c 'sleep N & sleep N'`, SIGTERM to `dev.sh` alone → 143; no live `sleep N`.
2. The same, with SIGTERM to `dev.sh`, the client and its plugin process → no live `sleep N`.
3. The same, with SIGINT to the process group → 130. The foreground `sleep` stops at once. The background one ignores SIGINT and is gone by the 10 s mark.
4. Claude Code's `TaskStop` on a background `./dev.sh exec pnpm cambusa:dev` → its session has no live process within about 11 s, and 3010 and 5183 are closed.
5. TTY, `exec sh -c 'tty; sleep N'` → prints a `/dev/pts/…`. A Ctrl-C then → 130, nothing left.
6. TTY, the same command, with the terminal closed → 129, nothing left.
7. TTY, `./dev.sh shell`, with `sleep N & sleep N` typed in it, then the terminal closed → 129. No shell and no `sleep N` left.
8. Two `exec sleep` side by side, SIGTERM to the first `dev.sh` → the second `sleep` is still running.
9. `exec true` → 0; `exec sh -c 'exit 3'` → 3; `printf 'a\nb\n' | ./dev.sh exec wc -l` → 2; stdout and stderr are kept apart.
10. The `Stop` hook still passes: it runs `./dev.sh exec pnpm verify`.

Added after review:

11. `./dev.sh exec sh -c '<a loop that prints for 10 s>' | head -2` → PIPESTATUS `255 0`, and the loop is gone 1.5 s later. On `master`, it is still running.
12. No TTY, `exec sleep N`, SIGTERM to the `docker compose` client alone → `dev.sh` exits 130, with no live `sleep N`.
13. `dev.sh` started as an `&` job of a non-interactive bash (SigIgn shows INT and QUIT ignored), with `sh -c 'sleep N & sleep N'`, then SIGINT to the group → no live `sleep N`.
14. No TTY, SIGQUIT to the process group → 131, nothing left.
15. `exec sh -c 'setsid sleep N & sleep M'`, which puts `sleep N` in a session of its own, then SIGTERM to `dev.sh` → 143, neither sleep left.

Added after the second review:

16. No TTY, `exec sh -c 'sleep N & exit 130'` → 130, and `sleep N` is still running (the test then kills it). With `exit 0`, the same. With a TTY, the hangup of the container's pty kills `sleep N` when `sh` exits, whatever `dev.sh` does (probed in the third review, without `dev.sh`).
17. No TTY, `exec sh -c 'sleep N & sleep N'`, then two SIGINTs to the group 20 ms apart → `dev.sh` ends, and no `sleep N` is left once the 10 s grace is over.

## Plan

1. **Spec** (this file).
2. **Fix:** `dev.sh` and `docker/dev/stop-session.sh`, with `pnpm verify` green, in one commit. `CLAUDE.md` does not change: `./dev.sh` is used as before, and the comments in the two scripts say why they work this way.
3. **Manual check:** cases 1–10.
4. **Backlog:** the zombie item into *To evaluate*, in a commit of its own.
5. **Review.**
6. **After review:** the changes above to the two scripts, and the spec. Cases 1–15 run again on the result.
7. **Second review.**
8. **After the second review:** the changes above. Cases 1–17 run again on the result.
9. **Third review.** It found no defect in the code, and four inexact sentences: two comments in `run_in_dev`, the QUIT bullet of *Out of scope*, and case 16. They are corrected, and a bullet on HUP is added to *Out of scope*.
10. Checkpoint 2, integration.
