#!/usr/bin/env python3
"""Measures development tasks from Claude Code transcripts and git history.

Two sources, one record per task branch:

  transcripts  tokens per role (main agent by phase, each subagent type),
               human prompts, compactions, tool calls, verify runs and reds,
               read from the Claude Code transcripts of one repository.
  git          tier, commits, files, review and critic rounds, duration,
               read from the merges of the main branch.

Python 3.8+, standard library only. Reads, never writes, outside --out.

  overload-metrics.py transcripts --repo ~/code/enardo-packages > t.jsonl
  overload-metrics.py git --repo ~/code/enardo-packages > g.jsonl
  overload-metrics.py summary t.jsonl g.jsonl

Transcript layout read (Claude Code 2.x): <config>/projects/<encoded repo
path>/<session>.jsonl, and each subagent in
<session>/subagents/agent-<id>.jsonl with agent-<id>.meta.json beside it
(agentType). When the meta file is missing, the type comes from the parent's
Agent/Task call; failing that, it is "unknown". Lines on the main branch are
attributed to the next task branch of the same session (the intake), else to
the previous one (the integration), else to "<main>".
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime

USAGE_KEYS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
SHORT = {"input_tokens": "input", "cache_creation_input_tokens": "cache_write",
         "cache_read_input_tokens": "cache_read", "output_tokens": "output"}
# Price ratios to an input token, the same for every current Claude model:
# a 5-minute cache write costs 1.25x, a cache read 0.1x, an output token 5x.
WEIGHT = {"input": 1.0, "cache_write": 1.25, "cache_read": 0.1, "output": 5.0}
ACTIVE_GAP_SECONDS = 10 * 60


def parse_ts(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def encode_project_path(path):
    # Claude Code names a project's transcript folder after its absolute
    # path, with every character but letters and digits turned into '-'.
    return re.sub(r"[^A-Za-z0-9]", "-", os.path.realpath(os.path.expanduser(path)))


def config_dir():
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")


def read_jsonl(path):
    out = []
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        pass
    return out


def new_bucket():
    return {"requests": 0, "input": 0, "cache_write": 0, "cache_read": 0, "output": 0, "by_model": {}}


def add_usage(bucket, model, usage):
    bucket["requests"] += 1
    per_model = bucket["by_model"].setdefault(model or "unknown", {"requests": 0, "input": 0, "cache_write": 0, "cache_read": 0, "output": 0})
    per_model["requests"] += 1
    for key in USAGE_KEYS:
        value = usage.get(key) or 0
        bucket[SHORT[key]] += value
        per_model[SHORT[key]] += value


def weighted(bucket):
    return round(sum(bucket[k] * w for k, w in WEIGHT.items()))


def assistant_messages(lines):
    """One entry per API response: Claude Code writes a line per content
    block, each repeating the message's usage, so lines are merged by id and
    each usage field keeps its largest value."""
    merged = {}
    order = []
    for line in lines:
        if line.get("type") != "assistant":
            continue
        message = line.get("message") or {}
        key = message.get("id") or line.get("requestId") or line.get("uuid")
        usage = message.get("usage") or {}
        if key not in merged:
            merged[key] = {"line": line, "model": message.get("model"), "usage": {k: 0 for k in USAGE_KEYS}, "content": []}
            order.append(key)
        entry = merged[key]
        for k in USAGE_KEYS:
            entry["usage"][k] = max(entry["usage"][k], usage.get(k) or 0)
        entry["content"].extend(c for c in (message.get("content") or []) if isinstance(c, dict))
    return [merged[k] for k in order]


def human_text(line):
    """The text of a prompt the human typed, or None for tool results,
    meta lines and the harness's own injections."""
    if line.get("type") != "user" or line.get("isMeta") or line.get("isCompactSummary"):
        return None
    if "toolUseResult" in line:
        return None
    content = (line.get("message") or {}).get("content")
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        if any(isinstance(c, dict) and c.get("type") == "tool_result" for c in content):
            return None
        text = "\n".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    else:
        return None
    stripped = text.strip()
    if not stripped or stripped.startswith(("<local-command-stdout>", "<local-command-stderr>", "<system-reminder>", "Caveat:", "<bash-stdout>", "<task-notification>")):
        return None
    return stripped


COMMAND_RE = re.compile(r"<command-name>\s*/?([^<\s]+)\s*</command-name>")


class Task:
    def __init__(self, branch):
        self.branch = branch
        self.sessions = set()
        self.times = []
        self.roles = defaultdict(new_bucket)
        self.runs = defaultdict(int)
        self.prompts = 0
        self.interrupts = 0
        self.commands = defaultdict(int)
        self.compactions = 0
        self.tools = defaultdict(int)
        self.verify_runs = 0
        self.verify_red = 0

    def record(self):
        times = sorted(t for t in self.times if t)
        active = 0.0
        for a, b in zip(times, times[1:]):
            gap = (b - a).total_seconds()
            if gap <= ACTIVE_GAP_SECONDS:
                active += gap
        roles = {}
        total = new_bucket()
        for name, bucket in sorted(self.roles.items()):
            roles[name] = dict(bucket, weighted=weighted(bucket))
            if name in self.runs:
                roles[name]["runs"] = self.runs[name]
            for k in ("requests", "input", "cache_write", "cache_read", "output"):
                total[k] += bucket[k]
        total.pop("by_model")
        total["weighted"] = weighted(total)
        return {
            "source": "transcripts",
            "branch": self.branch,
            "sessions": len(self.sessions),
            "first": times[0].isoformat() if times else None,
            "last": times[-1].isoformat() if times else None,
            "active_minutes": round(active / 60, 1),
            "human": {"prompts": self.prompts, "interrupts": self.interrupts, "commands": dict(self.commands)},
            "compactions": self.compactions,
            "verify": {"runs": self.verify_runs, "red": self.verify_red},
            "tools": dict(sorted(self.tools.items())),
            "roles": roles,
            "total": total,
        }


def session_segments(lines, main_branch):
    """Maps each line index to the task branch it belongs to."""
    branches = [l.get("gitBranch") or None for l in lines]
    resolved = [None] * len(lines)
    # forward pass: a main line takes the next task branch
    upcoming = None
    for i in range(len(lines) - 1, -1, -1):
        b = branches[i]
        if b and b != main_branch and b != "HEAD":
            upcoming = b
            resolved[i] = b
        else:
            resolved[i] = upcoming
    previous = None
    for i, b in enumerate(branches):
        if b and b != main_branch and b != "HEAD":
            previous = b
        elif resolved[i] is None:
            resolved[i] = previous
    return [r or "<%s>" % main_branch for r in resolved]


def collect_transcripts(project_dir, main_branch, verify_re, phase_skills):
    tasks = {}

    def task(branch):
        if branch not in tasks:
            tasks[branch] = Task(branch)
        return tasks[branch]

    sessions = sorted(f for f in os.listdir(project_dir) if f.endswith(".jsonl") and not f.startswith("agent-"))
    for name in sessions:
        session_id = name[:-6]
        lines = read_jsonl(os.path.join(project_dir, name))
        main_lines = [l for l in lines if not l.get("isSidechain")]
        owner = session_segments(main_lines, main_branch)
        owner_by_uuid = {l.get("uuid"): owner[i] for i, l in enumerate(main_lines) if l.get("uuid")}
        session_branches = set(owner)

        # who each Agent/Task call ran, by tool_use id and by agent id
        call_type = {}
        agent_type = {}
        agent_branch = {}
        tool_names = {}
        phase = "intake"
        phase_of_uuid = {}
        for i, line in enumerate(main_lines):
            branch = owner[i]
            t = task(branch)
            t.sessions.add(session_id)
            t.times.append(parse_ts(line.get("timestamp")))
            if line.get("type") == "system" and line.get("subtype") == "compact_boundary":
                t.compactions += 1
            text = human_text(line)
            if text is not None:
                if text.startswith("[Request interrupted"):
                    t.interrupts += 1
                else:
                    t.prompts += 1
                    match = COMMAND_RE.search(text)
                    if match:
                        command = match.group(1)
                        t.commands["/" + command] += 1
                        if command.split(":")[-1] in phase_skills:
                            phase = command.split(":")[-1]
                    elif text.startswith("/clear"):
                        t.commands["/clear"] += 1
            if line.get("type") == "assistant":
                for block in (line.get("message") or {}).get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        tool_input = block.get("input") or {}
                        if block.get("name") == "Skill":
                            skill = str(tool_input.get("skill", "")).split(":")[-1]
                            if skill in phase_skills:
                                phase = skill
            phase_of_uuid[line.get("uuid")] = phase
            if line.get("type") == "user" and isinstance(line.get("toolUseResult"), dict):
                result = line["toolUseResult"]
                for block in (line.get("message") or {}).get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        use_id = block.get("tool_use_id")
                        if result.get("agentId"):
                            agent_type[result["agentId"]] = result.get("agentType") or call_type.get(use_id, "unknown")
                            agent_branch[result["agentId"]] = branch
                        if tool_names.get(use_id) == "verify":
                            if block.get("is_error"):
                                t.verify_red += 1
            # record calls (from merged lines below, but ids here)
            if line.get("type") == "assistant":
                for block in (line.get("message") or {}).get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        tool_input = block.get("input") or {}
                        if block.get("name") in ("Agent", "Task"):
                            call_type[block.get("id")] = tool_input.get("subagent_type") or "general-purpose"
                        if block.get("name") == "Bash" and verify_re.search(str(tool_input.get("command", ""))):
                            tool_names[block.get("id")] = "verify"

        for entry in assistant_messages(main_lines):
            line = entry["line"]
            branch = owner_by_uuid.get(line.get("uuid"), "<%s>" % main_branch)
            t = task(branch)
            role = "main/" + phase_of_uuid.get(line.get("uuid"), "intake")
            add_usage(t.roles[role], entry["model"], entry["usage"])
            for block in entry["content"]:
                if block.get("type") == "tool_use":
                    t.tools[block.get("name") or "?"] += 1
                    if tool_names.get(block.get("id")) == "verify":
                        t.verify_runs += 1

        # sidechains written inside the session file (old layout)
        side = [l for l in lines if l.get("isSidechain")]
        for entry in assistant_messages(side):
            branch = entry["line"].get("gitBranch")
            branch = branch if branch and branch != main_branch else (sorted(session_branches)[0] if session_branches else "<%s>" % main_branch)
            add_usage(task(branch).roles["agent/unknown"], entry["model"], entry["usage"])

        agent_files = []
        sub_dir = os.path.join(project_dir, session_id, "subagents")
        if os.path.isdir(sub_dir):
            for root, _dirs, files in os.walk(sub_dir):
                agent_files += [os.path.join(root, f) for f in files if f.startswith("agent-") and f.endswith(".jsonl")]
        # old layout: agent-<id>.jsonl beside the sessions, tied by sessionId
        for f in os.listdir(project_dir):
            if f.startswith("agent-") and f.endswith(".jsonl"):
                path = os.path.join(project_dir, f)
                head = read_jsonl(path)[:1]
                if head and head[0].get("sessionId") == session_id:
                    agent_files.append(path)

        for path in agent_files:
            agent_id = os.path.basename(path)[len("agent-"):-len(".jsonl")]
            kind = agent_type.get(agent_id)
            meta_path = path[:-len(".jsonl")] + ".meta.json"
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, encoding="utf-8") as handle:
                        kind = json.load(handle).get("agentType") or kind
                except (OSError, json.JSONDecodeError):
                    pass
            kind = kind or "unknown"
            alines = read_jsonl(path)
            branch = agent_branch.get(agent_id)
            if branch is None:
                own = [l.get("gitBranch") for l in alines if l.get("gitBranch") and l.get("gitBranch") != main_branch]
                branch = own[0] if own else (sorted(session_branches)[0] if session_branches else "<%s>" % main_branch)
            t = task(branch)
            role = "agent/" + kind
            t.runs[role] += 1
            for entry in assistant_messages(alines):
                add_usage(t.roles[role], entry["model"], entry["usage"])
                for block in entry["content"]:
                    if block.get("type") == "tool_use":
                        t.tools[block.get("name") or "?"] += 1
            for line in alines:
                t.times.append(parse_ts(line.get("timestamp")))
    return [t.record() for t in tasks.values()]


def git(repo, *args):
    return subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True, check=True).stdout


def read_spec_frontmatter(repo, commit, path):
    try:
        text = git(repo, "show", "%s:%s" % (commit, path))
    except subprocess.CalledProcessError:
        return {}
    match = re.match(r"---\n(.*?)\n---", text, re.S)
    meta = {}
    if match:
        for raw in match.group(1).splitlines():
            if ":" in raw:
                key, value = raw.split(":", 1)
                meta[key.strip()] = value.strip()
    return meta


def collect_git(repo, main_branch, spec_glob, review_re, critic_re, test_re):
    merges = git(repo, "log", "--first-parent", "--merges", "--format=%H%x09%cI%x09%s", main_branch).splitlines()
    out = []
    for row in merges:
        sha, when, subject = row.split("\t", 2)
        match = re.match(r"Merge branch '([^']+)'", subject)
        if not match:
            continue
        branch = match.group(1)
        commits = git(repo, "log", "--format=%H%x09%aI%x09%s", "%s^1..%s^2" % (sha, sha)).splitlines()
        subjects = [c.split("\t", 2)[2] for c in commits]
        first = min(c.split("\t", 2)[1] for c in commits) if commits else when
        numstat = git(repo, "diff", "--numstat", "%s^1" % sha, sha).splitlines()
        files, added, removed, tests = 0, 0, 0, 0
        added_specs = []
        for line in numstat:
            parts = line.split("\t")
            if len(parts) != 3:
                continue
            files += 1
            added += int(parts[0]) if parts[0].isdigit() else 0
            removed += int(parts[1]) if parts[1].isdigit() else 0
            if test_re.search(parts[2]):
                tests += 1
        for line in git(repo, "diff", "--name-status", "--diff-filter=A", "%s^1" % sha, sha).splitlines():
            parts = line.split("\t")
            if len(parts) == 2 and re.fullmatch(spec_glob, parts[1]):
                added_specs.append(parts[1])
        spec = read_spec_frontmatter(repo, sha, added_specs[0]) if added_specs else {}
        out.append({
            "source": "git",
            "branch": branch,
            "merge": sha[:7],
            "merged": when,
            "first_commit": first,
            "hours_to_merge": round((parse_ts(when) - parse_ts(first)).total_seconds() / 3600, 2) if commits else 0,
            "tier": spec.get("tier") or ("S" if not added_specs else "?"),
            "type": branch.split("/")[0],
            "spec": added_specs[0] if added_specs else None,
            "implementer": spec.get("implementer"),
            "commits": len(commits),
            "review_commits": sum(1 for s in subjects if review_re.search(s)),
            "critic_commits": sum(1 for s in subjects if critic_re.search(s)),
            "files": files,
            "test_files": tests,
            "lines_added": added,
            "lines_removed": removed,
        })
    out.reverse()
    return out


def summary(paths):
    rows = []
    for path in paths:
        rows += read_jsonl(path)
    by_branch = defaultdict(dict)
    for r in rows:
        by_branch[r["branch"]][r["source"]] = r
    header = ["branch", "tier", "files", "rev", "crit", "sess", "prompts", "verify(red)", "active_min", "main_wt", "agents_wt", "agent_runs"]
    print("\t".join(header))
    for branch, sources in by_branch.items():
        g = sources.get("git", {})
        t = sources.get("transcripts", {})
        roles = t.get("roles", {})
        main_wt = sum(v["weighted"] for k, v in roles.items() if k.startswith("main/"))
        agent_wt = sum(v["weighted"] for k, v in roles.items() if k.startswith("agent/"))
        runs = ",".join("%s=%d" % (k[6:], v.get("runs", 0)) for k, v in sorted(roles.items()) if k.startswith("agent/"))
        verify = t.get("verify", {})
        print("\t".join(str(x) for x in [
            branch, g.get("tier", ""), g.get("files", ""), g.get("review_commits", ""), g.get("critic_commits", ""),
            t.get("sessions", ""), t.get("human", {}).get("prompts", ""),
            "%s(%s)" % (verify.get("runs", ""), verify.get("red", "")) if t else "",
            t.get("active_minutes", ""), main_wt or "", agent_wt or "", runs]))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    tp = sub.add_parser("transcripts", help="tokens and events per task branch")
    tp.add_argument("--repo", help="the repository's checkout; finds its transcript folder")
    tp.add_argument("--project-dir", help="the transcript folder itself, instead of --repo")
    tp.add_argument("--main", default="main")
    tp.add_argument("--verify", default=r"(^|[;&|(]\s*)(\./dev\.sh exec\s+)?pnpm (run )?verify(:all)?\b|(^|[;&|(]\s*)(bash\s+)?(\./)?scripts/integrate\.sh\b", help="regex of a Bash command that runs verify")
    tp.add_argument("--phases", default="spec,implement,publish,arch-review,overload", help="skills that open a phase of the main agent")
    tp.add_argument("--branch", help="regex: keep only matching branches")
    gp = sub.add_parser("git", help="tier, commits and review rounds per merged branch")
    gp.add_argument("--repo", required=True)
    gp.add_argument("--main", default="main")
    gp.add_argument("--spec", default=r"docs/specs/.*\.md")
    gp.add_argument("--review", default=r"review")
    gp.add_argument("--critic", default=r"critic")
    gp.add_argument("--tests", default=r"(__tests__/|\.test\.)")
    sp = sub.add_parser("summary", help="a table joining the two outputs by branch")
    sp.add_argument("files", nargs="+")
    args = parser.parse_args()

    if args.cmd == "transcripts":
        project_dir = args.project_dir or os.path.join(config_dir(), "projects", encode_project_path(args.repo or "."))
        if not os.path.isdir(project_dir):
            sys.exit("No transcript folder at %s: pass --project-dir (ls %s/projects)." % (project_dir, config_dir()))
        records = collect_transcripts(project_dir, args.main, re.compile(args.verify), set(args.phases.split(",")))
        if args.branch:
            records = [r for r in records if re.search(args.branch, r["branch"])]
        records.sort(key=lambda r: r["first"] or "")
        for r in records:
            print(json.dumps(r))
    elif args.cmd == "git":
        for r in collect_git(args.repo, args.main, args.spec, re.compile(args.review, re.I), re.compile(args.critic, re.I), re.compile(args.tests)):
            print(json.dumps(r))
    else:
        summary(args.files)


if __name__ == "__main__":
    main()
