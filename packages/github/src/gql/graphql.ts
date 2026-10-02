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

/** The possible states of an issue. */
export type IssueState =
  /** An issue that has been closed */
  | 'CLOSED'
  /** An issue that is still open */
  | 'OPEN';

/** Whether or not a PullRequest can be merged. */
export type MergeableState =
  /** The pull request cannot be merged due to merge conflicts. */
  | 'CONFLICTING'
  /** The pull request can be merged. */
  | 'MERGEABLE'
  /** The mergeability of the pull request is still being calculated. */
  | 'UNKNOWN';

/** The display color of a single-select field option. */
export type ProjectV2SingleSelectFieldOptionColor =
  /** BLUE */
  | 'BLUE'
  /** GRAY */
  | 'GRAY'
  /** GREEN */
  | 'GREEN'
  /** ORANGE */
  | 'ORANGE'
  /** PINK */
  | 'PINK'
  /** PURPLE */
  | 'PURPLE'
  /** RED */
  | 'RED'
  /** YELLOW */
  | 'YELLOW';

/** Represents a single select field option */
export type ProjectV2SingleSelectFieldOptionInput = {
  /** The display color of the option */
  color: ProjectV2SingleSelectFieldOptionColor;
  /** The description text of the option */
  description: string;
  /**
   * The ID of an existing single select option. Include this to preserve the
   * option's identity during updates, preventing item field values from being cleared.
   */
  id?: string | null | undefined;
  /** The name of the option */
  name: string;
};

/** The review status of a pull request. */
export type PullRequestReviewDecision =
  /** The pull request has received an approving review. */
  | 'APPROVED'
  /** Changes have been requested on the pull request. */
  | 'CHANGES_REQUESTED'
  /** A review is required before the pull request can be merged. */
  | 'REVIEW_REQUIRED';

/** The possible states of a pull request review. */
export type PullRequestReviewState =
  /** A review allowing the pull request to merge. */
  | 'APPROVED'
  /** A review blocking the pull request from merging. */
  | 'CHANGES_REQUESTED'
  /** An informational review. */
  | 'COMMENTED'
  /** A review that has been dismissed. */
  | 'DISMISSED'
  /** A review that has not yet been submitted. */
  | 'PENDING';

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

export type IssueNodeIdQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
}>;


export type IssueNodeIdQuery = { repository: { issue: { id: string } | null } | null };

export type IssueCreateRefsQueryVariables = Exact<{
  owner: string;
  name: string;
  parent: number;
  withParent: boolean;
}>;


export type IssueCreateRefsQuery = { repository: { id: string, labels: { nodes: Array<{ id: string, name: string } | null> | null } | null, parent?: { id: string } | null } | null };

export type IssuePlanQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
}>;


export type IssuePlanQuery = { repository: { owner:
      | { id: string }
      | { id: string }
    , issue: { id: string, number: number, title: string, body: string, labels: { nodes: Array<{ name: string } | null> | null } | null, issueType: { name: string } | null, parent: { number: number, title: string, body: string, labels: { nodes: Array<{ name: string } | null> | null } | null, issueType: { name: string } | null, parent: { number: number, title: string, body: string, labels: { nodes: Array<{ name: string } | null> | null } | null, issueType: { name: string } | null, parent: { number: number, parent: { number: number, parent: { number: number } | null } | null } | null } | null } | null, projectItems: { nodes: Array<{ id: string, project: { id: string, number: number, owner:
              | { id: string }
              | { id: string }
              | { id: string }
              | { id: string }
            , field:
              | { __typename: 'ProjectV2Field' }
              | { __typename: 'ProjectV2IterationField' }
              | { __typename: 'ProjectV2MultiSelectField' }
              | { __typename: 'ProjectV2SingleSelectField', id: string, options: Array<{ id: string, name: string }> }
             | null }, status:
            | { __typename: 'ProjectV2ItemFieldDateValue' }
            | { __typename: 'ProjectV2ItemFieldIterationValue' }
            | { __typename: 'ProjectV2ItemFieldLabelValue' }
            | { __typename: 'ProjectV2ItemFieldMilestoneValue' }
            | { __typename: 'ProjectV2ItemFieldMultiSelectValue' }
            | { __typename: 'ProjectV2ItemFieldNumberValue' }
            | { __typename: 'ProjectV2ItemFieldPullRequestValue' }
            | { __typename: 'ProjectV2ItemFieldRepositoryValue' }
            | { __typename: 'ProjectV2ItemFieldReviewerValue' }
            | { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: string | null }
            | { __typename: 'ProjectV2ItemFieldTextValue' }
            | { __typename: 'ProjectV2ItemFieldUserValue' }
            | { __typename: 'ProjectV2ItemIssueFieldValue' }
           | null } | null> | null } | null } | null } | null };

export type PlanItemsQueryVariables = Exact<{
  login: string;
  number: number;
  cursor?: string | null | undefined;
}>;


export type PlanItemsQuery = { user: { projectV2: { items: { pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ status:
            | { __typename: 'ProjectV2ItemFieldDateValue' }
            | { __typename: 'ProjectV2ItemFieldIterationValue' }
            | { __typename: 'ProjectV2ItemFieldLabelValue' }
            | { __typename: 'ProjectV2ItemFieldMilestoneValue' }
            | { __typename: 'ProjectV2ItemFieldMultiSelectValue' }
            | { __typename: 'ProjectV2ItemFieldNumberValue' }
            | { __typename: 'ProjectV2ItemFieldPullRequestValue' }
            | { __typename: 'ProjectV2ItemFieldRepositoryValue' }
            | { __typename: 'ProjectV2ItemFieldReviewerValue' }
            | { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: string | null }
            | { __typename: 'ProjectV2ItemFieldTextValue' }
            | { __typename: 'ProjectV2ItemFieldUserValue' }
            | { __typename: 'ProjectV2ItemIssueFieldValue' }
           | null, content:
            | { __typename: 'DraftIssue' }
            | { __typename: 'Issue', number: number, title: string, url: string, state: IssueState, updatedAt: string, repository: { name: string, owner:
                  | { login: string }
                  | { login: string }
                 }, labels: { nodes: Array<{ name: string } | null> | null } | null, assignees: { nodes: Array<{ login: string } | null> | null }, issueType: { name: string } | null, parent: { number: number, parent: { number: number, parent: { number: number } | null } | null } | null, subIssuesSummary: { total: number, completed: number }, blockedBy: { nodes: Array<{ number: number, state: IssueState } | null> | null }, closedByPullRequestsReferences: { nodes: Array<{ number: number } | null> | null } | null }
            | { __typename: 'PullRequest' }
           | null } | null> | null } } | null } | null };

export type CreatePlanProjectMutationVariables = Exact<{
  ownerId: string | number;
  title: string;
}>;


export type CreatePlanProjectMutation = { createProjectV2: { projectV2: { id: string, number: number, url: string, title: string, field:
        | { __typename: 'ProjectV2Field' }
        | { __typename: 'ProjectV2IterationField' }
        | { __typename: 'ProjectV2MultiSelectField' }
        | { __typename: 'ProjectV2SingleSelectField', id: string, options: Array<{ id: string, name: string, color: ProjectV2SingleSelectFieldOptionColor, description: string }> }
       | null } | null } | null };

export type SetStatusOptionsMutationVariables = Exact<{
  fieldId: string | number;
  options: Array<ProjectV2SingleSelectFieldOptionInput> | ProjectV2SingleSelectFieldOptionInput;
}>;


export type SetStatusOptionsMutation = { updateProjectV2Field: { projectV2Field:
      | { __typename: 'ProjectV2Field' }
      | { __typename: 'ProjectV2IterationField' }
      | { __typename: 'ProjectV2MultiSelectField' }
      | { __typename: 'ProjectV2SingleSelectField', id: string, options: Array<{ id: string, name: string }> }
     | null } | null };

export type LinkPlanRepositoryMutationVariables = Exact<{
  projectId: string | number;
  repositoryId: string | number;
}>;


export type LinkPlanRepositoryMutation = { linkProjectV2ToRepository: { repository: { id: string } | null } | null };

export type CreatePlanIssueMutationVariables = Exact<{
  repositoryId: string | number;
  title: string;
  body: string;
  labelIds?: Array<string | number> | string | number | null | undefined;
  parentIssueId?: string | number | null | undefined;
}>;


export type CreatePlanIssueMutation = { createIssue: { issue: { id: string, number: number, url: string } | null } | null };

export type AddPlanBlockerMutationVariables = Exact<{
  issueId: string | number;
  blockingIssueId: string | number;
}>;


export type AddPlanBlockerMutation = { addBlockedBy: { issue: { id: string } | null } | null };

export type CreatePlanLabelMutationVariables = Exact<{
  repositoryId: string | number;
  name: string;
  color: string;
  description: string;
}>;


export type CreatePlanLabelMutation = { createLabel: { label: { id: string } | null } | null };

export type AddPlanItemMutationVariables = Exact<{
  projectId: string | number;
  contentId: string | number;
}>;


export type AddPlanItemMutation = { addProjectV2ItemById: { item: { id: string } | null } | null };

export type SetPlanStatusMutationVariables = Exact<{
  projectId: string | number;
  itemId: string | number;
  fieldId: string | number;
  optionId: string;
}>;


export type SetPlanStatusMutation = { updateProjectV2ItemFieldValue: { projectV2Item: { id: string } | null } | null };

export type PlanOwnerIdsQueryVariables = Exact<{
  login: string;
  owner: string;
  name: string;
}>;


export type PlanOwnerIdsQuery = { user: { id: string } | null, repository: { id: string } | null };

export type PlanProjectQueryVariables = Exact<{
  login: string;
  number: number;
}>;


export type PlanProjectQuery = { user: { projectV2: { id: string, number: number, url: string, title: string, field:
        | { __typename: 'ProjectV2Field' }
        | { __typename: 'ProjectV2IterationField' }
        | { __typename: 'ProjectV2MultiSelectField' }
        | { __typename: 'ProjectV2SingleSelectField', id: string, options: Array<{ id: string, name: string }> }
       | null } | null } | null };

export type PullRequestSnapshotQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
}>;


export type PullRequestSnapshotQuery = { repository: { pullRequest: { number: number, title: string, isDraft: boolean, additions: number, deletions: number, changedFiles: number, updatedAt: string, url: string, headRefOid: string, headRefName: string, state: PullRequestState, merged: boolean, mergeable: MergeableState, reviewDecision: PullRequestReviewDecision | null, commits: { nodes: Array<{ commit: { statusCheckRollup: { state: StatusState, contexts: { nodes: Array<
                  | { __typename: 'CheckRun', databaseId: number | null, name: string, status: CheckStatusState, conclusion: CheckConclusionState | null, detailsUrl: string | null }
                  | { __typename: 'StatusContext', context: string, state: StatusState, targetUrl: string | null }
                 | null> | null } } | null } } | null> | null }, reviews: { nodes: Array<{ databaseId: number | null, state: PullRequestReviewState, body: string, submittedAt: string | null, author:
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
           | null, commit: { oid: string } | null } | null> | null } | null, reviewThreads: { nodes: Array<{ isResolved: boolean, comments: { nodes: Array<{ databaseId: number | null, body: string, path: string, line: number | null, url: string, author:
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

export const IssueNodeIdDocument = new TypedDocumentString(`
    query IssueNodeId($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<IssueNodeIdQuery, IssueNodeIdQueryVariables>;
export const IssueCreateRefsDocument = new TypedDocumentString(`
    query IssueCreateRefs($owner: String!, $name: String!, $parent: Int!, $withParent: Boolean!) {
  repository(owner: $owner, name: $name) {
    id
    labels(first: 100) {
      nodes {
        id
        name
      }
    }
    parent: issue(number: $parent) @include(if: $withParent) {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<IssueCreateRefsQuery, IssueCreateRefsQueryVariables>;
export const IssuePlanDocument = new TypedDocumentString(`
    query IssuePlan($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    owner {
      id
    }
    issue(number: $number) {
      id
      number
      title
      body
      labels(first: 20) {
        nodes {
          name
        }
      }
      issueType {
        name
      }
      parent {
        number
        title
        body
        labels(first: 20) {
          nodes {
            name
          }
        }
        issueType {
          name
        }
        parent {
          number
          title
          body
          labels(first: 20) {
            nodes {
              name
            }
          }
          issueType {
            name
          }
          parent {
            number
            parent {
              number
              parent {
                number
              }
            }
          }
        }
      }
      projectItems(first: 20) {
        nodes {
          id
          project {
            id
            number
            owner {
              id
            }
            field(name: "Status") {
              __typename
              ... on ProjectV2SingleSelectField {
                id
                options {
                  id
                  name
                }
              }
            }
          }
          status: fieldValueByName(name: "Status") {
            __typename
            ... on ProjectV2ItemFieldSingleSelectValue {
              name
            }
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<IssuePlanQuery, IssuePlanQueryVariables>;
export const PlanItemsDocument = new TypedDocumentString(`
    query PlanItems($login: String!, $number: Int!, $cursor: String) {
  user(login: $login) {
    projectV2(number: $number) {
      items(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          status: fieldValueByName(name: "Status") {
            __typename
            ... on ProjectV2ItemFieldSingleSelectValue {
              name
            }
          }
          content {
            __typename
            ... on Issue {
              number
              title
              url
              state
              updatedAt
              repository {
                name
                owner {
                  login
                }
              }
              labels(first: 20) {
                nodes {
                  name
                }
              }
              assignees(first: 10) {
                nodes {
                  login
                }
              }
              issueType {
                name
              }
              parent {
                number
                parent {
                  number
                  parent {
                    number
                  }
                }
              }
              subIssuesSummary {
                total
                completed
              }
              blockedBy(first: 20) {
                nodes {
                  number
                  state
                }
              }
              closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
                nodes {
                  number
                }
              }
            }
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<PlanItemsQuery, PlanItemsQueryVariables>;
export const CreatePlanProjectDocument = new TypedDocumentString(`
    mutation CreatePlanProject($ownerId: ID!, $title: String!) {
  createProjectV2(input: { ownerId: $ownerId, title: $title }) {
    projectV2 {
      id
      number
      url
      title
      field(name: "Status") {
        __typename
        ... on ProjectV2SingleSelectField {
          id
          options {
            id
            name
            color
            description
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<CreatePlanProjectMutation, CreatePlanProjectMutationVariables>;
export const SetStatusOptionsDocument = new TypedDocumentString(`
    mutation SetStatusOptions($fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
  updateProjectV2Field(
    input: { fieldId: $fieldId, singleSelectOptions: $options }
  ) {
    projectV2Field {
      __typename
      ... on ProjectV2SingleSelectField {
        id
        options {
          id
          name
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<SetStatusOptionsMutation, SetStatusOptionsMutationVariables>;
export const LinkPlanRepositoryDocument = new TypedDocumentString(`
    mutation LinkPlanRepository($projectId: ID!, $repositoryId: ID!) {
  linkProjectV2ToRepository(
    input: { projectId: $projectId, repositoryId: $repositoryId }
  ) {
    repository {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<LinkPlanRepositoryMutation, LinkPlanRepositoryMutationVariables>;
export const CreatePlanIssueDocument = new TypedDocumentString(`
    mutation CreatePlanIssue($repositoryId: ID!, $title: String!, $body: String!, $labelIds: [ID!], $parentIssueId: ID) {
  createIssue(
    input: {
      repositoryId: $repositoryId
      title: $title
      body: $body
      labelIds: $labelIds
      parentIssueId: $parentIssueId
    }
  ) {
    issue {
      id
      number
      url
    }
  }
}
    `) as unknown as TypedDocumentString<CreatePlanIssueMutation, CreatePlanIssueMutationVariables>;
export const AddPlanBlockerDocument = new TypedDocumentString(`
    mutation AddPlanBlocker($issueId: ID!, $blockingIssueId: ID!) {
  addBlockedBy(input: { issueId: $issueId, blockingIssueId: $blockingIssueId }) {
    issue {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<AddPlanBlockerMutation, AddPlanBlockerMutationVariables>;
export const CreatePlanLabelDocument = new TypedDocumentString(`
    mutation CreatePlanLabel($repositoryId: ID!, $name: String!, $color: String!, $description: String!) {
  createLabel(
    input: {
      repositoryId: $repositoryId
      name: $name
      color: $color
      description: $description
    }
  ) {
    label {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<CreatePlanLabelMutation, CreatePlanLabelMutationVariables>;
export const AddPlanItemDocument = new TypedDocumentString(`
    mutation AddPlanItem($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
    item {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<AddPlanItemMutation, AddPlanItemMutationVariables>;
export const SetPlanStatusDocument = new TypedDocumentString(`
    mutation SetPlanStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }
  ) {
    projectV2Item {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<SetPlanStatusMutation, SetPlanStatusMutationVariables>;
export const PlanOwnerIdsDocument = new TypedDocumentString(`
    query PlanOwnerIds($login: String!, $owner: String!, $name: String!) {
  user(login: $login) {
    id
  }
  repository(owner: $owner, name: $name) {
    id
  }
}
    `) as unknown as TypedDocumentString<PlanOwnerIdsQuery, PlanOwnerIdsQueryVariables>;
export const PlanProjectDocument = new TypedDocumentString(`
    query PlanProject($login: String!, $number: Int!) {
  user(login: $login) {
    projectV2(number: $number) {
      id
      number
      url
      title
      field(name: "Status") {
        __typename
        ... on ProjectV2SingleSelectField {
          id
          options {
            id
            name
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<PlanProjectQuery, PlanProjectQueryVariables>;
export const PullRequestSnapshotDocument = new TypedDocumentString(`
    query PullRequestSnapshot($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      title
      isDraft
      additions
      deletions
      changedFiles
      updatedAt
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
      reviews(last: 50) {
        nodes {
          databaseId
          state
          body
          submittedAt
          author {
            login
          }
          commit {
            oid
          }
        }
      }
      reviewThreads(first: 100) {
        nodes {
          isResolved
          comments(first: 1) {
            nodes {
              databaseId
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