/** A moment as the viewer's clock shows it, hours and minutes. The server and the browser may disagree on the time zone, which the browser settles. */
export function Clock({ at }: { at: string | Date }) {
  const date = new Date(at);
  return (
    <time dateTime={date.toISOString()} title={date.toISOString()} suppressHydrationWarning>
      {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </time>
  );
}
