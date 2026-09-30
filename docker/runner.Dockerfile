# Runner image for HANDOFF_WORKSPACE=docker: one container per run executes claude, tests and
# shell nodes against the run's worktree, which is mounted at the same path as on the host.
# node:24 (Debian) already ships git and procps, so the build needs only the npm registry.
ARG BASE_IMAGE=node:24
FROM ${BASE_IMAGE}

ARG CLAUDE_CODE_VERSION=2.1.285
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} pnpm@12.6.0 && npm cache clean --force

# The worker pins the CLI version; the container must not update itself mid-run.
ENV DISABLE_AUTOUPDATER=1
CMD ["sleep", "infinity"]
