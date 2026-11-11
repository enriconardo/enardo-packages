#!/usr/bin/env bash
# Outbound firewall of the dev container: everything is denied except the
# allow list below, the compose networks and DNS. Adapted from Anthropic's
# .devcontainer/init-firewall.sh; docker/README.md and ADR 0022 say how it
# differs and why.
#
# Installed root-owned in /usr/local/bin, the one thing `node` may run through
# sudo. Two modes, chosen from the state in force:
#   refresh    the OUTPUT policy is DROP and the set exists: no rule and no
#              policy is touched, only the addresses of the allow list are
#              replaced, atomically.
#   bootstrap  every other case: the only run that needs open egress.
set -euo pipefail
IFS=$'\n\t'

SET=allowed-domains
TMP_SET=allowed-domains-new
# Resolved once per run. See docker/README.md for what each is for.
DOMAINS=(
  registry.npmjs.org
  api.anthropic.com
  claude.ai
  claude.com
  platform.claude.com
  downloads.claude.ai
  marketplace.visualstudio.com
  vscode.blob.core.windows.net
  update.code.visualstudio.com
  fastdl.mongodb.org
)

# Concurrent runs through sudo wait for each other. The file is root-only:
# `node` cannot open it to hold the lock.
umask 077
exec 9>/run/init-firewall.lock
flock 9

# Fills a set with GitHub's ranges and the resolved domains. -exist: two
# domains often share an address, and ipset add refuses a duplicate.
populate() {
  local set="$1" meta ranges cidr domain ip ips

  meta="$(curl -fsS --connect-timeout 10 --max-time 30 https://api.github.com/meta)"
  ranges="$(jq -er '(.web + .api + .git)[] | select(contains(":") | not)' <<<"$meta" | aggregate -q)"
  [[ -n "$ranges" ]] || {
    echo "GitHub returned no IPv4 ranges" >&2
    return 1
  }
  for cidr in $ranges; do
    [[ "$cidr" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]] || {
      echo "Invalid GitHub range: $cidr" >&2
      return 1
    }
    ipset add -exist "$set" "$cidr"
  done

  for domain in "${DOMAINS[@]}"; do
    ips="$(dig +short A "$domain" | grep -E '^[0-9]+(\.[0-9]+){3}$' || true)"
    [[ -n "$ips" ]] || {
      echo "Failed to resolve $domain" >&2
      return 1
    }
    for ip in $ips; do
      ipset add -exist "$set" "$ip"
    done
  done
}

refresh() {
  # On any way out the temporary set goes, holding either the failed
  # attempt or, after the swap, the previous list.
  trap 'ipset destroy "$TMP_SET" 2>/dev/null || true' EXIT
  ipset destroy "$TMP_SET" 2>/dev/null || true
  ipset create "$TMP_SET" hash:net
  populate "$TMP_SET"
  ipset swap "$TMP_SET" "$SET"
  echo "Allow list refreshed."
}

BOOTSTRAP_OK=0
undo_bootstrap() {
  [[ "$BOOTSTRAP_OK" == 1 ]] && return 0
  # In this order: the policies first, so nothing is open; the flush before
  # the destroy, since ipset refuses to destroy a set a rule references.
  iptables -P INPUT DROP 2>/dev/null || true
  iptables -P FORWARD DROP 2>/dev/null || true
  iptables -P OUTPUT DROP 2>/dev/null || true
  iptables -F 2>/dev/null || true
  iptables -X 2>/dev/null || true
  ipset destroy "$SET" 2>/dev/null || true
  ipset destroy "$TMP_SET" 2>/dev/null || true
}

bootstrap() {
  local gateway host_network playwright_ip playwright_network

  trap undo_bootstrap EXIT

  # Open, so that the ranges of GitHub can be fetched. The nat table is not
  # touched: it holds Docker's DNS rules.
  iptables -P INPUT ACCEPT
  iptables -P FORWARD ACCEPT
  iptables -P OUTPUT ACCEPT
  iptables -F
  iptables -X
  ipset destroy "$SET" 2>/dev/null || true
  ipset destroy "$TMP_SET" 2>/dev/null || true
  ipset create "$SET" hash:net

  # Under the open policies: a previous failed bootstrap leaves DROP, which
  # would block the resolution. A failure still ends closed (the EXIT trap).
  gateway="$(ip route | awk '/^default/ {print $3; exit}')"
  [[ -n "$gateway" ]] || {
    echo "Failed to detect the default gateway" >&2
    exit 1
  }
  host_network="${gateway%.*}.0/24"
  playwright_ip="$(getent ahostsv4 playwright | awk '{print $1; exit}' || true)"
  [[ -n "$playwright_ip" ]] || {
    echo "Failed to resolve playwright" >&2
    exit 1
  }
  playwright_network="${playwright_ip%.*}.0/24"

  # DNS and loopback first: the resolution below needs them.
  iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
  iptables -A INPUT -p udp --sport 53 -j ACCEPT
  iptables -A INPUT -i lo -j ACCEPT
  iptables -A OUTPUT -o lo -j ACCEPT

  populate "$SET"

  iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
  iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
  # The compose network, both ways.
  iptables -A INPUT -s "$host_network" -j ACCEPT
  iptables -A OUTPUT -d "$host_network" -j ACCEPT
  # The browsers: out only. dev opens the WebSocket, so established traffic
  # carries the rest, and a compromised browser reaches no port of dev.
  iptables -A OUTPUT -d "$playwright_network" -j ACCEPT
  # The allow list. Port 22 has no rule of its own: only the list's hosts.
  iptables -A OUTPUT -m set --match-set "$SET" dst -j ACCEPT
  # Refuse at once rather than time out.
  iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

  iptables -P INPUT DROP
  iptables -P FORWARD DROP
  iptables -P OUTPUT DROP

  echo "Firewall configured. Verifying..."
  if curl --connect-timeout 5 -s https://example.com >/dev/null 2>&1; then
    echo "Verification failed: reached https://example.com" >&2
    exit 1
  fi
  if ! curl --connect-timeout 5 -fs https://api.github.com/zen >/dev/null 2>&1; then
    echo "Verification failed: cannot reach https://api.github.com" >&2
    exit 1
  fi
  BOOTSTRAP_OK=1
  echo "Firewall up."
}

if [[ "$(iptables -S OUTPUT | head -n1)" == "-P OUTPUT DROP" ]] && ipset list -n 2>/dev/null | grep -qx "$SET"; then
  refresh
else
  bootstrap
fi
