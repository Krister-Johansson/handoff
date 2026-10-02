import { ExternalLinkIcon, MessageSquarePlusIcon, PencilIcon } from "lucide-react";
import type { IssueComment } from "@handoff/github";
import { Tag } from "@/components/tag";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { utcStamp } from "@/lib/issue-dates";
import { Foldable, isLong } from "./foldable";
import { IssueMarkdown } from "./issue-markdown";
import { IssueSection, Quiet } from "./issue-section";

/** GitHub's author associations worth a tag beside a name: the people who run the repository. */
const ROLES: Record<string, string> = { OWNER: "owner", MEMBER: "member", COLLABORATOR: "collaborator" };

const ACTION = "inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-3 [&_svg]:size-3.5";

/** A GitHub user's avatar, from GitHub by login, with the first letter while it loads. */
export function GitHubAvatar({ login, size = "sm" }: { login: string; size?: "sm" | "default" }) {
  return (
    <Avatar size={size}>
      <AvatarImage src={`https://github.com/${encodeURIComponent(login)}.png?size=48`} alt="" />
      <AvatarFallback>{login.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/**
 * The body as rendered Markdown, with Edit on GitHub. A task's shows in full, since the agents work
 * from it; a story's or an epic's folds, because its own list comes first.
 */
export function Description({ body, url, fold, projectId, repoUrl }: { body: string; url: string; fold: boolean; projectId: string; repoUrl: string }) {
  return (
    <IssueSection
      title="Description"
      action={
        <a href={url} className={ACTION}>
          <PencilIcon aria-hidden />
          Edit on GitHub
        </a>
      }
    >
      {body.trim() ? (
        <Foldable folds={fold && isLong(body, 14)} height="description" more="Show the whole description">
          <IssueMarkdown projectId={projectId} repoUrl={repoUrl}>
            {body}
          </IssueMarkdown>
        </Foldable>
      ) : (
        <Quiet>No description on GitHub.</Quiet>
      )}
    </IssueSection>
  );
}

/** The issue's comments from GitHub, oldest first as GitHub lists them; writing stays on GitHub. */
export function Comments({ comments, url, projectId, repoUrl }: { comments: IssueComment[]; url: string; projectId: string; repoUrl: string }) {
  return (
    <IssueSection
      title="Comments"
      count={comments.length}
      action={
        <a href={`${url}#new_comment_field`} className={ACTION}>
          <MessageSquarePlusIcon aria-hidden />
          Comment on GitHub
        </a>
      }
    >
      {comments.length === 0 ? (
        <Quiet>No comments on GitHub yet.</Quiet>
      ) : (
        <ol className="flex flex-col divide-y">
          {comments.map((comment) => {
            const author = comment.author ?? "ghost";
            const role = ROLES[comment.authorAssociation];
            return (
              <li key={comment.id} className="py-4 first:pt-0 last:pb-0">
                <article aria-label={`Comment by ${author}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                  <GitHubAvatar login={author} />
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-semibold">{author}</span>
                    {role && <Tag>{role}</Tag>}
                    <time dateTime={comment.createdAt} className="text-xs text-muted-foreground">
                      {utcStamp(comment.createdAt)}
                    </time>
                    <a href={comment.url} aria-label="Open this comment on GitHub" className="ml-auto text-muted-foreground hover:text-foreground">
                      <ExternalLinkIcon aria-hidden className="size-3.5" />
                    </a>
                  </div>
                  <div className="col-start-2 min-w-0">
                    <Foldable folds={isLong(comment.body, 10)} height="comment" more="Show the whole comment">
                      <IssueMarkdown projectId={projectId} repoUrl={repoUrl} className="text-[13px]/[1.55]">
                        {comment.body}
                      </IssueMarkdown>
                    </Foldable>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </IssueSection>
  );
}
