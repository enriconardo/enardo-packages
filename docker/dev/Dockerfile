FROM node:24-bookworm

# git comes with node:24-bookworm and must stay available: turbo's
# --filter=...[main] resolves the affected packages by diffing against git,
# and that runs inside this container. A slimmer base would have to install it.
# shellcheck is the only check `pnpm verify` has for the shell scripts, which
# no amount of eslint or vitest covers.
# The rest is for the firewall (iptables, ipset, iproute2, dnsutils, aggregate,
# jq, sudo: docker/dev/init-firewall.sh) and for a human in the terminal (less).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      less sudo iptables ipset iproute2 dnsutils aggregate jq shellcheck \
    && rm -rf /var/lib/apt/lists/*

# GitHub's published SSH host keys, so that a non-interactive git push never
# fails on host key verification after a rebuild (~ is not on a volume).
COPY github_known_hosts /etc/ssh/ssh_known_hosts

# The firewall script is root-owned, and the one thing `node` may run as root.
COPY init-firewall.sh /usr/local/bin/init-firewall.sh
RUN chmod 755 /usr/local/bin/init-firewall.sh \
    && chown root:root /usr/local/bin/init-firewall.sh \
    && echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall \
    && chmod 440 /etc/sudoers.d/node-firewall

# Debian's /etc/profile resets PATH in a login shell, and VS Code's
# environment probe uses one.
RUN printf '%s\n' \
      'export PNPM_HOME=/home/node/.local/share/pnpm' \
      'export PATH="$PNPM_HOME:$HOME/.local/bin:$PATH"' \
      > /etc/profile.d/dev-path.sh

# The mount point of the named volume: created here, owned by node, so the
# volume inherits that owner.
RUN mkdir -p /home/node/.claude && chown node:node /home/node/.claude

RUN corepack enable pnpm

USER node

ENV PNPM_HOME=/home/node/.local/share/pnpm
ENV PATH=${PNPM_HOME}:/home/node/.local/bin:${PATH}

# Claude Code, native installer; it updates itself through downloads.claude.ai.
RUN curl -fsSL https://claude.ai/install.sh | bash

WORKDIR /workspaces/enardo-packages

CMD ["sleep", "infinity"]
