# The browsers of the browser tests: Playwright's builds of Chromium, Firefox
# and WebKit, behind Playwright's run-server. Vitest, in the dev container,
# connects to it (docker-compose.yml), so the dev image gets no browsers.

# One version for the image, whose browsers it ships, and for the server. It
# must be the catalog's `playwright` (pnpm-workspace.yaml), which
# check-version.sh checks in `pnpm verify`: the server refuses a client of
# another minor version only (428, "Playwright version mismatch").
ARG PLAYWRIGHT_VERSION=1.63.0
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

# The image has the browsers but not the package. Installed here rather than
# with `npx playwright` at start, which would fetch it from the registry every
# time the container is created.
ARG PLAYWRIGHT_VERSION
RUN npm install --global --no-audit --no-fund "playwright@${PLAYWRIGHT_VERSION}"

USER pwuser
WORKDIR /home/pwuser

CMD ["playwright", "run-server", "--port", "3000", "--host", "0.0.0.0"]
