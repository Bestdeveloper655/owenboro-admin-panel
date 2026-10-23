"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, X } from "lucide-react";

import { Badge, cx, useObjectUrl } from "@/components/ui";

/* A photo in a form: one already saved (its download URL) or a file picked
 * now, previewed from the browser until it's uploaded. */
export type Photo = { id: string; url: string; file: File | null };

/* Ordered photo thumbnails for cream modals, cover first: add several at
 * once, reorder by drag and drop (or the arrows, on touch screens), remove. */
export default function PhotoGrid({
  photos,
  max,
  onChange,
  onAddFiles,
}: {
  photos: Photo[];
  max: number;
  /* Called with the full list after a move or a removal. */
  onChange: (next: Photo[]) => void;
  onAddFiles: (files: File[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= photos.length) return;
    const next = [...photos];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="mt-3">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {photos.map((photo, index) => (
          <div
            key={photo.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              setDragIndex(index);
            }}
            onDragOver={(e) => {
              if (dragIndex === null) return;
              e.preventDefault();
              setOverIndex(index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) move(dragIndex, index);
              endDrag();
            }}
            onDragEnd={endDrag}
            className={cx(
              "group relative aspect-square cursor-grab overflow-hidden rounded-xl border bg-black/5 transition",
              index === 0 ? "border-[#ff7a59]" : "border-black/10",
              dragIndex === index && "opacity-40",
              overIndex === index && dragIndex !== index && "ring-2 ring-[#ff7a59]",
            )}
          >
            <Thumb photo={photo} alt={`Photo ${index + 1}`} />

            {index === 0 && (
              <Badge tone="orange" className="absolute top-1.5 left-1.5 shadow">
                Cover
              </Badge>
            )}

            <button
              type="button"
              onClick={() => onChange(photos.filter((p) => p.id !== photo.id))}
              className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white transition hover:bg-red-600"
              aria-label={`Remove photo ${index + 1}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <ArrowButton
                label={`Move photo ${index + 1} left`}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </ArrowButton>
              <ArrowButton
                label={`Move photo ${index + 1} right`}
                disabled={index === photos.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </ArrowButton>
            </div>
          </div>
        ))}

        {photos.length < max && (
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-black/25 bg-white/50 px-2 text-center text-xs font-medium text-black/55 transition hover:border-[#ff7a59] hover:text-[#ff7a59]">
            <ImagePlus className="h-5 w-5" aria-hidden />
            {photos.length === 0 ? "Add photos" : "Add more"}
            <input
              type="file"
              hidden
              multiple
              accept="image/*"
              onChange={(e) => {
                onAddFiles(Array.from(e.target.files ?? []));
                // Lets the same file be picked again after removing it.
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>

      <p className="mt-2 text-xs text-black/55">
        {photos.length} of {max} photos
      </p>
    </div>
  );
}

function Thumb({ photo, alt }: { photo: Photo; alt: string }) {
  const blobUrl = useObjectUrl(photo.file);
  const src = photo.file ? blobUrl : photo.url;
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} draggable={false} className="h-full w-full object-cover" />
  );
}

function ArrowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-full bg-black/60 p-1 text-white transition hover:bg-black/80 disabled:invisible"
    >
      {children}
    </button>
  );
}
