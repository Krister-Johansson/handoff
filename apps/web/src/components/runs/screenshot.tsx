import { Tag } from "@/components/tag";

/** A screenshot a Demo step took: the image, opening full size, with its caption and the criterion it shows. */
export type Shot = { id: string; caption: string; criterion?: string | undefined; works?: boolean | undefined };

export function Screenshot({ shot, showCriterion = true }: { shot: Shot; showCriterion?: boolean }) {
  const src = `/api/screenshots/${shot.id}`;
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <a href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border bg-muted hover:border-ring">
        {/* A local file served by the dashboard, at whatever size the browser took it; next/image would only resize it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={shot.caption} loading="lazy" className="block h-auto w-full" />
      </a>
      <figcaption className="flex flex-col gap-1 text-xs">
        <span className="flex flex-wrap items-center gap-1.5">
          {shot.works !== undefined && <Tag tone={shot.works ? "success" : "danger"}>{shot.works ? "Works" : "Does not work"}</Tag>}
          <span>{shot.caption}</span>
        </span>
        {showCriterion && shot.criterion && <span className="text-muted-foreground">{shot.criterion}</span>}
      </figcaption>
    </figure>
  );
}
