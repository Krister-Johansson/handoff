/* eslint-disable */
import * as types from './graphql.js';



/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "query PullRequestSnapshot($owner: String!, $name: String!, $number: Int!) {\n  repository(owner: $owner, name: $name) {\n    pullRequest(number: $number) {\n      number\n      title\n      isDraft\n      additions\n      deletions\n      changedFiles\n      updatedAt\n      url\n      headRefOid\n      headRefName\n      state\n      merged\n      mergeable\n      reviewDecision\n      commits(last: 1) {\n        nodes {\n          commit {\n            statusCheckRollup {\n              state\n              contexts(first: 100) {\n                nodes {\n                  __typename\n                  ... on CheckRun {\n                    databaseId\n                    name\n                    status\n                    conclusion\n                    detailsUrl\n                  }\n                  ... on StatusContext {\n                    context\n                    state\n                    targetUrl\n                  }\n                }\n              }\n            }\n          }\n        }\n      }\n      reviewThreads(first: 100) {\n        nodes {\n          isResolved\n          comments(first: 1) {\n            nodes {\n              author {\n                login\n              }\n              body\n              path\n              line\n              url\n            }\n          }\n        }\n      }\n      comments(last: 50) {\n        nodes {\n          author {\n            login\n          }\n          body\n          url\n        }\n      }\n    }\n  }\n}": typeof types.PullRequestSnapshotDocument,
};
const documents: Documents = {
    "query PullRequestSnapshot($owner: String!, $name: String!, $number: Int!) {\n  repository(owner: $owner, name: $name) {\n    pullRequest(number: $number) {\n      number\n      title\n      isDraft\n      additions\n      deletions\n      changedFiles\n      updatedAt\n      url\n      headRefOid\n      headRefName\n      state\n      merged\n      mergeable\n      reviewDecision\n      commits(last: 1) {\n        nodes {\n          commit {\n            statusCheckRollup {\n              state\n              contexts(first: 100) {\n                nodes {\n                  __typename\n                  ... on CheckRun {\n                    databaseId\n                    name\n                    status\n                    conclusion\n                    detailsUrl\n                  }\n                  ... on StatusContext {\n                    context\n                    state\n                    targetUrl\n                  }\n                }\n              }\n            }\n          }\n        }\n      }\n      reviewThreads(first: 100) {\n        nodes {\n          isResolved\n          comments(first: 1) {\n            nodes {\n              author {\n                login\n              }\n              body\n              path\n              line\n              url\n            }\n          }\n        }\n      }\n      comments(last: 50) {\n        nodes {\n          author {\n            login\n          }\n          body\n          url\n        }\n      }\n    }\n  }\n}": types.PullRequestSnapshotDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query PullRequestSnapshot($owner: String!, $name: String!, $number: Int!) {\n  repository(owner: $owner, name: $name) {\n    pullRequest(number: $number) {\n      number\n      title\n      isDraft\n      additions\n      deletions\n      changedFiles\n      updatedAt\n      url\n      headRefOid\n      headRefName\n      state\n      merged\n      mergeable\n      reviewDecision\n      commits(last: 1) {\n        nodes {\n          commit {\n            statusCheckRollup {\n              state\n              contexts(first: 100) {\n                nodes {\n                  __typename\n                  ... on CheckRun {\n                    databaseId\n                    name\n                    status\n                    conclusion\n                    detailsUrl\n                  }\n                  ... on StatusContext {\n                    context\n                    state\n                    targetUrl\n                  }\n                }\n              }\n            }\n          }\n        }\n      }\n      reviewThreads(first: 100) {\n        nodes {\n          isResolved\n          comments(first: 1) {\n            nodes {\n              author {\n                login\n              }\n              body\n              path\n              line\n              url\n            }\n          }\n        }\n      }\n      comments(last: 50) {\n        nodes {\n          author {\n            login\n          }\n          body\n          url\n        }\n      }\n    }\n  }\n}"): typeof import('./graphql.js').PullRequestSnapshotDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
