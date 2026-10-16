FROM node:24-bookworm

# Align the image's `node` user with the host user so bind-mounted files keep
# their ownership. Defaults match the common Linux/WSL first user.
ARG UID=1000
ARG GID=1000
RUN if [ "${GID}" != "1000" ]; then groupmod -g "${GID}" node; fi \
    && if [ "${UID}" != "1000" ]; then usermod -u "${UID}" node; fi \
    && chown -R "${UID}:${GID}" /home/node

# git comes with node:24-bookworm and must stay available: turbo's
# --filter=...[main] resolves the affected packages by diffing against git,
# and that runs inside this container. A slimmer base would have to install it.
# shellcheck is the only check `pnpm verify` has for the shell scripts, which
# no amount of eslint or vitest covers.
RUN apt-get update \
    && apt-get install -y --no-install-recommends shellcheck \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable pnpm

USER node

ENV PNPM_HOME=/home/node/.local/share/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

WORKDIR /workspaces/enardo-packages

CMD ["sleep", "infinity"]
