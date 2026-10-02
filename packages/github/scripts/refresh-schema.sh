#!/bin/sh
# Refreshes the vendored copy of GitHub's published GraphQL schema, then regenerates the operation types.
# The npm package @octokit/graphql-schema lags behind GitHub (it has no blockedBy or issueType), so codegen
# reads this copy instead. Review the diff of src/gql before committing.
set -eu

cd "$(dirname "$0")/.."
curl -fsSL https://docs.github.com/public/fpt/schema.docs.graphql -o src/schema/schema.docs.graphql.tmp
mv src/schema/schema.docs.graphql.tmp src/schema/schema.docs.graphql
pnpm codegen
