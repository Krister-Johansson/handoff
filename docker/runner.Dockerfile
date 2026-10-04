# Runner image for HANDOFF_WORKSPACE=docker: one container per run executes claude, tests and
# shell nodes against the run's worktree, which is mounted at the same path as on the host.
# node:24 (Debian) already ships git and procps, so the build needs only the npm registry.
ARG BASE_IMAGE=node:24
FROM ${BASE_IMAGE}

ARG CLAUDE_CODE_VERSION=2.1.285
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} pnpm@12.6.0 && npm cache clean --force

# The Demo step's browser: the Playwright MCP server (PLAYWRIGHT_MCP in packages/engine/src/executors/demo.ts)
# and Playwright's Chromium with its system libraries. Google Chrome, the server's default, has no Linux arm64
# build, so the worker passes --browser chromium in Docker mode, which the server runs as Chrome for Testing,
# the full Chromium build; the headless shell is not needed. The browser lives outside HOME, which is /tmp in a
# run's container, and is readable by the run's user.
ARG PLAYWRIGHT_MCP_VERSION=0.0.83
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install -g @playwright/mcp@${PLAYWRIGHT_MCP_VERSION} \
  && playwright-mcp install-browser --with-deps --no-shell chromium \
  && chmod -R a+rX /ms-playwright \
  && rm -rf /var/lib/apt/lists/* \
  && npm cache clean --force

# The worker pins the CLI version; the container must not update itself mid-run.
ENV DISABLE_AUTOUPDATER=1
CMD ["sleep", "infinity"]
