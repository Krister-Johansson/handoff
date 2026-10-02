import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { PROSE } from "@/components/review/styles";
import { remarkIssueRefs } from "@/lib/issue-refs";
import { issuePath } from "@/lib/paths";
import { cn } from "@/lib/utils";

/** The body's prose: the review pages' reading sizes, with images kept inside the column. */
const BODY = cn(PROSE, "prose-img:my-2 prose-img:max-h-[480px] prose-img:rounded-md prose-img:border prose-a:underline-offset-3 [&_input]:mr-1.5 [&_input]:align-middle [&_li:has(input)]:list-none");

/**
 * An issue's or a comment's body as GitHub writes it: Markdown with GitHub's extensions and the HTML
 * GitHub allows, sanitized as GitHub does, so images in <img> tags show and HTML comments stay hidden.
 * A reference such as #145, or a link to an issue of the repository, opens that issue's page in handoff.
 */
export function IssueMarkdown({ children, projectId, repoUrl, className }: { children: string; projectId: string; repoUrl: string; className?: string }) {
  const issueUrl = new RegExp(`^${repoUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/issues/(\\d+)/?$`, "i");
  const components: Components = {
    a: ({ node: _node, href = "", children: text, ...rest }) => {
      const number = issueUrl.exec(href)?.[1];
      const internal = number ? issuePath(projectId, Number(number)) : href.startsWith("/") ? href : undefined;
      return internal ? (
        <Link href={internal} {...rest}>
          {text}
        </Link>
      ) : (
        <a href={href} {...rest}>
          {text}
        </a>
      );
    },
    // GitHub's images can be large screenshots; they load when they come into view.
    img: ({ node: _node, alt = "", ...rest }) => (
      // eslint-disable-next-line @next/next/no-img-element -- the source is GitHub's, at any size and host
      <img alt={alt} loading="lazy" {...rest} />
    ),
  };
  return (
    <div className={cn(BODY, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkIssueRefs, { href: (n: number) => issuePath(projectId, n) }]]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
