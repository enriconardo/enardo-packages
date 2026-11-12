# Task journal

branch: chore/repo/narrow-firewall-dns-rules
tier: L
phase: l/chunk-1/commit
base: 78eed19
started: 2026-11-12T10:26:55Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

spec: .workflow/specs/2026-11-12-narrow-firewall-dns-rules.md

spec_review_rounds: 3

## Intent

### Intent: narrow the dev container firewall's DNS rules

Problem: docker/dev/init-firewall.sh:126-127 accept `OUTPUT -p udp --dport 53` to any host and `INPUT -p udp --sport 53` from any host. The INPUT rule lets any packet with source port 53 reach any port of dev, `playwright` included, contradicting the comment at :138-139 ("a compromised browser reaches no port of dev"). The OUTPUT rule opens any UDP protocol to any host on port 53, broader than the "DNS can carry data out" risk accepted in docker/README.md:59 and ADR 0022.

Goal (backlog item "The dev container's firewall accepts any UDP packet from port 53"):
- Remove the INPUT --sport 53 rule; DNS replies are accepted by conntrack: move the INPUT/OUTPUT ESTABLISHED,RELATED rules before `populate`.
- Limit OUTPUT port 53 (udp and tcp) to the nameservers read from /etc/resolv.conf (decided by the owner over removing it outright: stays correct if a non-loopback resolver appears). Today resolv.conf holds only 127.0.0.11 (Docker's embedded DNS, DNAT'd on loopback); ExtServers is `host(192.168.65.7)`, i.e. forwarded from the host namespace.
- Align docker/README.md (*It limits, it does not seal*, :53, :59) and ADR 0022 wording if needed.

Constraints: a bootstrap that fails still ends closed (DROP, no set). No test-first (shell script in docker/; shellcheck via verify). Verification is H3 of .workflow/specs/2026-11-11-dev-container-environment.md, run by the owner from WSL after Rebuild Container, plus: `dig registry.npmjs.org` resolves, `dig @1.1.1.1 example.com` is refused, a UDP packet with source port 53 from `playwright` does not reach dev. The owner runs it (the container can only sudo the installed script).

Owner decisions: tier L; resolv.conf-based limit; owner runs H3 from WSL after the rebuild.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-12T10:26:55Z opened on 78eed19 of main
- 2026-11-12T10:26:58Z map: /tmp/claude-1000/-workspaces-enardo-packages/c988bf2f-58a7-4276-aa57-0d713b4b9843/scratchpad/map.md
- 2026-11-12T10:27:35Z probe skipped: Docker's DNS forwarding cannot be probed from dev (no docker); the owner checks it as H1
- 2026-11-12T10:42:54Z spec review 2: blocking accepted (resolv.conf rule matches no packet: DNAT on lo; same host() dependency as removal). Owner: option 1, remove both rules, simplest
- 2026-11-12T10:42:54Z probe (dev, /proc/net): resolver listens on 127.0.0.11:51346/udp, :37999/tcp (DNAT); 30 uncached lookups, every dig socket seen to 127.0.0.11:53, none to a non-loopback :53 (upstream from host ns)
- 2026-11-12T10:45:20Z spec review 3: holds; minors fixed (README condition on ExtServers host(), H3 sender exit 0, Why tense, DNS bullet on departure from Anthropic). Rejected: H4 setup (as prior spec's H3, owner ran it); branch name 'narrow' kept
- 2026-11-12T10:47:58Z owner approved the spec: 'la approvo'
- 2026-11-12T10:48:08Z H0 (dig part, run by Claude in dev on current image): dig @1.1.1.1 udp answers (104.20.23.154, 172.66.147.243): OUTPUT hole confirmed; tcp refused (host unreachable), as expected
- 2026-11-12T10:52:58Z H0 (playwright part, run by owner): sender exit 0, listener 'got x 172.21.0.2 53': INPUT hole confirmed
