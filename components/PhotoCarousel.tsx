"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

/*
 * A listing's photos as the app shows them: one at a time, swipe (or the
 * arrows / arrow keys) for the next, dots underneath, and thumbnails that jump
 * to a photo. The first photo is the cover.
 */
export default function PhotoCarousel({
  images,
  className = "",
}: {
  images: string[];
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const start = useRef<number | null>(null);
  const count = images.length;
  if (count === 0) return null;

  const at = Math.min(index, count - 1);
  const go = (i: number) => setIndex((i + count) % count);

  return (
    <div className={className}>
      <div
        className="group relative aspect-video w-full overflow-hidden rounded-2xl bg-black/5 outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        tabIndex={count > 1 ? 0 : -1}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") go(at - 1);
          if (e.key === "ArrowRight") go(at + 1);
        }}
        onPointerDown={(e) => {
          start.current = e.clientX;
        }}
        onPointerUp={(e) => {
          if (start.current === null) return;
          const dx = e.clientX - start.current;
          start.current = null;
          if (Math.abs(dx) > 40) go(dx < 0 ? at + 1 : at - 1);
        }}
        aria-roledescription="carousel"
        aria-label={`Photo ${at + 1} of ${count}`}
      >
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${at * 100}%)` }}
        >
          {images.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${i}-${url}`}
              src={url}
              alt={i === 0 ? "Cover photo" : `Photo ${i + 1}`}
              draggable={false}
              className="h-full w-full shrink-0 select-none object-cover"
            />
          ))}
        </div>

        {at === 0 && (
          <span className="absolute top-3 left-3 rounded-full bg-orange-500 px-2.5 py-0.5 text-xs font-semibold text-white shadow">
            Cover
          </span>
        )}
        <a
          href={images[at]}
          target="_blank"
          rel="noreferrer"
          title="Open full size"
          className="absolute top-3 right-3 rounded-full bg-black/50 p-1.5 text-white opacity-0 transition group-hover:opacity-100"
        >
          <ExternalLink className="h-4 w-4" />
        </a>

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(at - 1)}
              aria-label="Previous photo"
              className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-white/85 p-1.5 text-black shadow transition hover:bg-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => go(at + 1)}
              aria-label="Next photo"
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-white/85 p-1.5 text-black shadow transition hover:bg-white"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="absolute inset-x-0 bottom-3 flex justify-center">
              <div className="flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1.5">
                {images.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => go(i)}
                    aria-label={`Show photo ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      i === at ? "w-4 bg-white" : "w-1.5 bg-white/60 hover:bg-white/80"
                    }`}
                  />
                ))}
              </div>
            </div>
            <span className="absolute right-3 bottom-3 rounded-full bg-black/50 px-2 py-0.5 text-xs font-medium text-white">
              {at + 1} / {count}
            </span>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {images.map((url, i) => (
            <button
              key={`${i}-${url}`}
              type="button"
              onClick={() => go(i)}
              title={i === 0 ? "Cover photo" : `Photo ${i + 1}`}
              className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                i === at ? "border-orange-500" : "border-transparent opacity-70 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
