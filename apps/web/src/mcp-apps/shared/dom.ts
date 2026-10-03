/**
 * The views' DOM helpers. A view is plain DOM because it is one HTML document a host loads in a sandboxed iframe;
 * every text from a run, a plan or GitHub goes in as text, never as markup.
 */

/** Opens a dashboard or GitHub address through the host; false when the host does not open links. */
export type OpenLink = (url: string) => Promise<boolean>;

export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, ...children: Child[]) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) if (child) node.append(child);
  return node;
}

/** An SVG icon from lucide's paths, drawn inline so the view loads nothing. */
export function icon(paths: string[]) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) {
    svg.setAttribute(name, value);
  }
  for (const d of paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** lucide's paths for the icons the views draw. */
export const ICONS = {
  play: ["M6 3l14 9-14 9V3z"],
  external: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  shield: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z", "M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3", "M12 17h.01"],
  question: ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"],
  review: ["M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z", "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2", "m9 14 2 2 4-4"],
  merge: ["M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M6 21V9a9 9 0 0 0 9 9"],
  failed: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "m15 9-6 6", "m9 9 6 6"],
  loop: ["m17 2 4 4-4 4", "M3 11v-1a4 4 0 0 1 4-4h14", "m7 22-4-4 4-4", "M21 13v1a4 4 0 0 1-4 4H3"],
  pull: ["M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M13 6h3a2 2 0 0 1 2 2v7", "M6 9v12"],
  check: ["M20 6 9 17l-5-5"],
  files: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M12 12v4", "M12 18h.01"],
};

/**
 * A link that opens in the person's browser. When the host opens links (ui/open-link), the click asks it to;
 * otherwise it is a plain link to a new tab.
 */
export function link(href: string, className: string | undefined, open: OpenLink | undefined, ...children: (Node | string)[]) {
  const a = el("a", className, ...children);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  if (open) {
    a.addEventListener("click", (event) => {
      event.preventDefault();
      void open(href).then((opened) => {
        if (!opened) window.open(href, "_blank", "noopener");
      });
    });
  }
  return a;
}

export function button(label: Child, className = "btn btn-primary", onClick?: () => void) {
  const b = el("button", className, label);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

/** A line in place of a view: while its tool runs, or the tool's error. */
export function renderState(root: HTMLElement, text: string, error = false) {
  const line = el("p", error ? "state err" : "state", text);
  if (error) line.setAttribute("role", "alert");
  root.replaceChildren(line);
}

/** The parts of a line with a dot between each two, which screen readers skip. */
export function dotted(className: string, parts: Child[]) {
  const line = el("div", className);
  for (const part of parts.filter(Boolean)) {
    if (line.childNodes.length) {
      const dot = el("span", undefined, "·");
      dot.setAttribute("aria-hidden", "true");
      line.append(dot);
    }
    line.append(typeof part === "string" ? el("span", undefined, part) : (part as Node));
  }
  return line;
}

/** A count with its noun: "1 item", "3 items". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
