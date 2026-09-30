const NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
export type AnsiColor = (typeof NAMES)[number] | `bright${Capitalize<(typeof NAMES)[number]>}`;
export type AnsiRun = { text: string; fg?: AnsiColor; bg?: AnsiColor; bold?: boolean; dim?: boolean };

const bright = (i: number) => `bright${NAMES[i]![0]!.toUpperCase()}${NAMES[i]!.slice(1)}` as AnsiColor;

type Style = Omit<AnsiRun, "text">;

function apply(style: Style, codes: number[]): Style {
  const next = { ...style };
  for (const code of codes.length ? codes : [0]) {
    if (code === 0) for (const key of Object.keys(next) as (keyof Style)[]) delete next[key];
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 22) {
      delete next.bold;
      delete next.dim;
    } else if (code >= 30 && code <= 37) next.fg = NAMES[code - 30]!;
    else if (code >= 90 && code <= 97) next.fg = bright(code - 90);
    else if (code === 39) delete next.fg;
    else if (code >= 40 && code <= 47) next.bg = NAMES[code - 40]!;
    else if (code >= 100 && code <= 107) next.bg = bright(code - 100);
    else if (code === 49) delete next.bg;
  }
  return next;
}

// SGR sequences carry the styling; every other CSI or OSC sequence is dropped.
const SEQUENCE = /\u001b\[([0-9;]*)m|\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** Terminal output as lines of styled runs: the colours, bold and dim of SGR codes, without the codes. */
export function parseAnsi(text: string): AnsiRun[][] {
  let style: Style = {};
  return text.split("\n").map((line) => {
    const runs: AnsiRun[] = [];
    const push = (chunk: string) => {
      if (!chunk) return;
      const last = runs.at(-1);
      const same = last && last.fg === style.fg && last.bg === style.bg && last.bold === style.bold && last.dim === style.dim;
      if (same) last.text += chunk;
      else runs.push({ text: chunk, ...style });
    };
    let at = 0;
    for (const match of line.matchAll(SEQUENCE)) {
      push(line.slice(at, match.index));
      at = match.index + match[0].length;
      if (match[1] !== undefined) style = apply(style, match[1] ? match[1].split(";").map(Number) : []);
    }
    push(line.slice(at));
    return runs;
  });
}
