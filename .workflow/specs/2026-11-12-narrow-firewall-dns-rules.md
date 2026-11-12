---
status: done
branch: chore/repo/narrow-firewall-dns-rules
---

# The dev container's firewall drops its port-53 rules: DNS goes only through loopback

## Why

The final review of `chore/repo/dev-container-environment` (2026-11-11) found, and the backlog kept, that `docker/dev/init-firewall.sh:126-127` keeps Anthropic's two DNS rules unchanged:

```
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT
```

Read against the rest of the script (2026-11-12, `main` at `78eed19`):

- **INPUT `--sport 53`** accepts any UDP packet whose source port is 53, from any host, to any port of `dev`. The INPUT policy is DROP and the only other inbound rules are loopback, established traffic and the gateway's `/24` (`:128`, `:133`, `:136`): this rule is the one way an unsolicited packet from `playwright` (172.21.0.2, on the `browsers` network, outside the gateway's `/24`) reaches a UDP port of `dev`, which contradicts `:138-139` ("a compromised browser reaches no port of dev"). *(H0, 2026-11-12, current image)* the datagram from `playwright` with source port 53 arrived: `got x 172.21.0.2 53`, sender exit 0.
- **OUTPUT `--dport 53`** accepts any UDP traffic to any host on port 53, not only DNS through the resolver: a tunnel on `udp/53` to a host of anyone's choice gets out. `docker/README.md:59` and ADR 0022 accept that "DNS" can carry data out, meaning queries through the resolver, a narrower channel. *(H0, 2026-11-12)* `dig @1.1.1.1 example.com` from `dev` answered (`104.20.23.154`, `172.66.147.243`); over TCP it was refused.

**What `dev`'s DNS actually uses** *(probe, 2026-11-12, in `dev`, from `/proc/net/{udp,tcp}`, no root)*:

- `/etc/resolv.conf` holds only `nameserver 127.0.0.11`, with `ExtServers: [host(192.168.65.7)]`; it is `root:root 0644`. Both of `dev`'s networks are user-defined (`docker/docker-compose.yml`), where Docker always writes 127.0.0.11; a compose `dns:` changes only `ExtServers`.
- Docker's embedded resolver listens on `127.0.0.11:51346/udp` and `127.0.0.11:37999/tcp`, not on 53: queries to `127.0.0.11:53` are redirected (DNAT, in the `nat` table the script does not touch) before the `filter` table sees them, so they match `-o lo` / `-i lo` and never a port-53 rule.
- During 30 lookups of random, uncached names, every socket of `dig` seen in the namespace went to `127.0.0.11:53`, and none to a non-loopback address on port 53: the resolver forwards upstream from the host's namespace (`host(...)`, Docker Desktop's marking), not through `dev`'s OUTPUT chain.

So in this setup both rules match no DNS packet: they only open the two holes above.

## What

After a bootstrap:

- No rule of the `filter` table mentions port 53. DNS goes to Docker's resolver on loopback, through the existing `-i lo` / `-o lo` rules; a query to any other host on port 53 falls through to the REJECT at the end of OUTPUT, unless the host is in the allow list or on a compose network (where every port was already open).
- An unsolicited packet from `playwright` reaches no port of `dev`, whatever its source port.
- Everything else is unchanged: the allow list, refresh (which touches no rule), the fail-closed paths.
- The script's comments say this: the header (`:2-3`) says "DNS to Docker's resolver on loopback" instead of "DNS"; the comment at `:125` ("DNS and loopback first: the resolution below needs them"), already untrue since the policies are ACCEPT during `populate` (`:101-103`), is replaced by one saying why there is no DNS rule (the resolver is on loopback, upstream queries leave from the host's namespace).
- `docker/README.md`: `:53` says "DNS to Docker's resolver" instead of "DNS"; the *Failure* bullet (`:56`) adds that the firewall assumes Docker's resolver forwards from the host, as `host(...)` marks in `/etc/resolv.conf`'s `ExtServers`: when an entry there lacks `host(...)` (another engine, or a `dns:` added to the compose file), names stop resolving after the bootstrap and it fails at the GitHub check ("cannot reach https://api.github.com"). A new bullet **DNS.** says that, unlike Anthropic's script, there is no port-53 rule, on purpose (the resolver is on loopback; the rules only opened `udp/53` both ways), so that a re-sync does not bring them back, and states the `host(...)` condition above. The new `:125` comment says the same about `dns:`. `:59` stays true (queries through the resolver still carry data out). ADR 0022 is not edited: its sentence ("DNS and the allowed hosts ... remain ways out") stays true, and an ADR records a decision, not the rules of the script.

Out of scope: IPv6 (not filtered, the network has none, `docker/README.md:59`); the `playwright` container; the allow list; another engine than Docker Desktop.

## Decisions

1. **Remove both rules** (owner's choice, 2026-11-12: "the simplest"). Alternatives:
   - *Do nothing*: leaves both holes.
   - *OUTPUT 53 limited to the `nameserver`s of `/etc/resolv.conf`* (the owner's first choice, withdrawn after the second spec review): the file can only name 127.0.0.11, whose traffic the DNAT moves off port 53, so the rule would match no packet; it is code that looks like protection and does nothing, and depends on `host()` forwarding exactly as removal does.
   - *OUTPUT 53 to the non-`host(...)` entries of `ExtServers`*: would follow an engine that forwards from the container's namespace, but parses a comment Docker writes with no stated format; today it would produce no rule.
   The dependency on Docker Desktop's forwarding is stated in the README (What); on another engine the bootstrap fails closed, at the verification.
2. **The `ESTABLISHED,RELATED` rules stay where they are.** With the DNS rules gone, nothing before `populate` needs them, and during the bootstrap the policies are ACCEPT until the end anyway.
3. **The fact Decision 1 rests on is probed** (Why) and confirmed again by H1 after the rebuild: if resolution needed a port-53 rule, H1 would fail, and so would the bootstrap's own verification (`:155`), closed.

## Test cases

No automated test: the script runs as root in the image, and `dev` can only `sudo` the installed copy. `pnpm verify` runs shellcheck on it. The owner runs these:

- **H0, before the change** (current image; reproduces both holes and proves the probes of H2 and H3 can tell): H3's probe, where the datagram **arrives**; `dig @1.1.1.1 example.com +time=2 +tries=1` in `dev`, which **answers**. (H2's TCP half is refused already today, since the old rule is UDP only: it guards against a regression, not the change.)
- **H1.** After *Rebuild Container*, in `dev`: the bootstrap succeeded (the terminal opened); `dig +short registry.npmjs.org` and `dig +tcp +short registry.npmjs.org` return addresses; `sudo /usr/local/bin/init-firewall.sh` (a refresh) exits 0.
- **H2.** In `dev`: `dig @1.1.1.1 example.com +time=2 +tries=1` fails (no answer), and `dig @1.1.1.1 example.com +tcp +time=2 +tries=1` too.
- **H3.** The probe: in `dev`, a listener `node -e 'const s=require("dgram").createSocket("udp4");s.on("message",(m,r)=>{console.log("got",String(m),r.address,r.port);process.exit(0)});s.bind(9999);setTimeout(()=>{console.log("nothing");process.exit(1)},5000)'`; meanwhile from WSL, as root in `playwright` (so that the bind to 53 cannot fail on permissions), `docker exec -u root enardo-packages-playwright-1 node -e 'const s=require("dgram").createSocket("udp4");s.bind(53,()=>s.send("x",9999,"dev",()=>s.close()))'`. The sender exits 0 (otherwise the result proves nothing); after the change the listener prints `nothing`.
- **H4.** H3 of `.workflow/specs/2026-11-11-dev-container-environment.md`, run again in a throwaway container of the new image: every point of it holds.
- **H5.** After *Rebuild Container*, `pnpm verify:all --force` passes (`CLAUDE.md`, *After a change to `docker/`*).

## Chunks

- [x] 1. The DNS rules and the docs (no test-first): `docker/dev/init-firewall.sh`, `docker/README.md`. H0 before, H1–H5 after, by the owner. The backlog item (`.workflow/backlog.md:31-33`) is removed in its own commit at the close.
