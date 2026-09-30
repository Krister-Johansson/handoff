#!/bin/sh
# Relays a repository's GitHub webhooks to the local dashboard through GitHub itself, so the
# unauthenticated dashboard is never exposed publicly. Needs: gh extension install cli/gh-webhook
# Usage: pnpm dev:webhooks owner/repo
set -eu
repo="${1:?usage: pnpm dev:webhooks owner/repo}"
secret="$(grep -E '^GITHUB_WEBHOOK_SECRET=' "$(dirname "$0")/../.env" | cut -d= -f2-)"
[ -n "$secret" ] || { echo "Set GITHUB_WEBHOOK_SECRET in .env first (openssl rand -hex 32)"; exit 1; }
exec gh webhook forward --repo="$repo" \
  --events=check_suite,check_run,workflow_run,pull_request,pull_request_review,pull_request_review_comment,issue_comment \
  --url="http://127.0.0.1:${WEB_PORT:-3000}/api/webhooks/github" --secret="$secret"
