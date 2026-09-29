/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
/** The possible states for a check suite or run conclusion. */
export type CheckConclusionState =
  /** The check suite or run requires action. */
  | 'ACTION_REQUIRED'
  /** The check suite or run has been cancelled. */
  | 'CANCELLED'
  /** The check suite or run has failed. */
  | 'FAILURE'
  /** The check suite or run was neutral. */
  | 'NEUTRAL'
  /** The check suite or run was skipped. */
  | 'SKIPPED'
  /** The check suite or run was marked stale by GitHub. Only GitHub can use this conclusion. */
  | 'STALE'
  /** The check suite or run has failed at startup. */
  | 'STARTUP_FAILURE'
  /** The check suite or run has succeeded. */
  | 'SUCCESS'
  /** The check suite or run has timed out. */
  | 'TIMED_OUT';

/** The possible states for a check suite or run status. */
export type CheckStatusState =
  /** The check suite or run has been completed. */
  | 'COMPLETED'
  /** The check suite or run is in progress. */
  | 'IN_PROGRESS'
  /** The check suite or run is in pending state. */
  | 'PENDING'
  /** The check suite or run has been queued. */
  | 'QUEUED'
  /** The check suite or run has been requested. */
  | 'REQUESTED'
  /** The check suite or run is in waiting state. */
  | 'WAITING';

/** Whether or not a PullRequest can be merged. */
export type MergeableState =
  /** The pull request cannot be merged due to merge conflicts. */
  | 'CONFLICTING'
  /** The pull request can be merged. */
  | 'MERGEABLE'
  /** The mergeability of the pull request is still being calculated. */
  | 'UNKNOWN';

/** The review status of a pull request. */
export type PullRequestReviewDecision =
  /** The pull request has received an approving review. */
  | 'APPROVED'
  /** Changes have been requested on the pull request. */
  | 'CHANGES_REQUESTED'
  /** A review is required before the pull request can be merged. */
  | 'REVIEW_REQUIRED';

/** The possible states of a pull request. */
export type PullRequestState =
  /** A pull request that has been closed without being merged. */
  | 'CLOSED'
  /** A pull request that has been closed by being merged. */
  | 'MERGED'
  /** A pull request that is still open. */
  | 'OPEN';

/** The possible commit status states. */
export type StatusState =
  /** Status is errored. */
  | 'ERROR'
  /** Status is expected. */
  | 'EXPECTED'
  /** Status is failing. */
  | 'FAILURE'
  /** Status is pending. */
  | 'PENDING'
  /** Status is successful. */
  | 'SUCCESS';

export type PullRequestSnapshotQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
}>;


export type PullRequestSnapshotQuery = { repository: { pullRequest: { number: number, url: string, headRefOid: string, headRefName: string, state: PullRequestState, merged: boolean, mergeable: MergeableState, reviewDecision: PullRequestReviewDecision | null, commits: { nodes: Array<{ commit: { statusCheckRollup: { state: StatusState, contexts: { nodes: Array<
                  | { __typename: 'CheckRun', databaseId: number | null, name: string, status: CheckStatusState, conclusion: CheckConclusionState | null, detailsUrl: string | null }
                  | { __typename: 'StatusContext', context: string, state: StatusState, targetUrl: string | null }
                 | null> | null } } | null } } | null> | null }, reviewThreads: { nodes: Array<{ isResolved: boolean, comments: { nodes: Array<{ body: string, path: string, line: number | null, url: string, author:
                | { login: string }
                | { login: string }
                | { login: string }
                | { login: string }
                | { login: string }
               | null } | null> | null } } | null> | null }, comments: { nodes: Array<{ body: string, url: string, author:
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
           | null } | null> | null } } | null } | null };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}

export const PullRequestSnapshotDocument = new TypedDocumentString(`
    query PullRequestSnapshot($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      url
      headRefOid
      headRefName
      state
      merged
      mergeable
      reviewDecision
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              state
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun {
                    databaseId
                    name
                    status
                    conclusion
                    detailsUrl
                  }
                  ... on StatusContext {
                    context
                    state
                    targetUrl
                  }
                }
              }
            }
          }
        }
      }
      reviewThreads(first: 100) {
        nodes {
          isResolved
          comments(first: 1) {
            nodes {
              author {
                login
              }
              body
              path
              line
              url
            }
          }
        }
      }
      comments(last: 50) {
        nodes {
          author {
            login
          }
          body
          url
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<PullRequestSnapshotQuery, PullRequestSnapshotQueryVariables>;