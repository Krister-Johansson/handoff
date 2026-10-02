/** The few mdast fields the plugin reads: a node's type, its text and its children. */
type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };

/** "#145" after a space, an opening bracket or the start, and not part of a word, a URL or an HTML entity. */
const REF = /(^|[\s([{,;:])#(\d+)\b/g;

/** Nodes whose text is not prose: a reference there stays text. */
const SKIP = new Set(["link", "linkReference", "inlineCode", "code", "html", "definition"]);

/** Splits one text node into text and links, one link per reference. */
function split(value: string, href: (n: number) => string): MdNode[] {
  const parts: MdNode[] = [];
  let at = 0;
  for (const match of value.matchAll(REF)) {
    const start = match.index + match[1]!.length;
    if (start > at) parts.push({ type: "text", value: value.slice(at, start) });
    parts.push({ type: "link", url: href(Number(match[2])), children: [{ type: "text", value: `#${match[2]}` }] });
    at = start + 1 + match[2]!.length;
  }
  if (at < value.length) parts.push({ type: "text", value: value.slice(at) });
  return parts;
}

function walk(node: MdNode, href: (n: number) => string) {
  if (!node.children || SKIP.has(node.type)) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && child.value) return split(child.value, href);
    walk(child, href);
    return [child];
  });
}

/** A remark plugin that turns issue references such as #145 in prose into links to `href(145)`. */
export function remarkIssueRefs(options: { href: (number: number) => string }) {
  return (tree: MdNode) => walk(tree, options.href);
}
