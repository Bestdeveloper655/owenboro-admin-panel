"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";

type Props<T> = {
  items: T[];
  getId: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /* Called with the full list in its new order after a drop or a move. */
  onReorder: (next: T[]) => void;
  disabled?: boolean;
};

/* Vertical list reordered by drag and drop, with up/down buttons for touch
 * screens and keyboard users (HTML5 drag events don't fire on mobile). */
export default function SortableList<T>({
  items,
  getId,
  renderItem,
  onReorder,
  disabled = false,
}: Props<T>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  };

  return (
    <ol className="space-y-2">
      {items.map((item, index) => (
        <li
          key={getId(item)}
          draggable={!disabled}
          onDragStart={(e) => {
            setDragIndex(index);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (overIndex !== index) setOverIndex(index);
          }}
          onDragLeave={() => setOverIndex((cur) => (cur === index ? null : cur))}
          onDrop={(e) => {
            e.preventDefault();
            if (dragIndex !== null) move(dragIndex, index);
            setDragIndex(null);
            setOverIndex(null);
          }}
          onDragEnd={() => {
            setDragIndex(null);
            setOverIndex(null);
          }}
          className={`flex items-center gap-3 rounded-xl border bg-[#ece2cb] px-3 py-2 text-black transition ${
            overIndex === index && dragIndex !== index
              ? "border-[#ff7a59] ring-2 ring-[#ff7a59]/40"
              : "border-transparent"
          } ${dragIndex === index ? "opacity-50" : ""} ${
            disabled ? "cursor-not-allowed opacity-70" : "cursor-grab"
          }`}
        >
          <GripVertical className="h-5 w-5 shrink-0 text-black/40" aria-hidden />
          <span className="w-8 shrink-0 text-center text-sm font-semibold text-black/50">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">{renderItem(item, index)}</div>
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              disabled={disabled || index === 0}
              onClick={() => move(index, index - 1)}
              className="rounded p-0.5 text-black/60 hover:bg-black/10 disabled:opacity-25"
              aria-label="Move up"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={disabled || index === items.length - 1}
              onClick={() => move(index, index + 1)}
              className="rounded p-0.5 text-black/60 hover:bg-black/10 disabled:opacity-25"
              aria-label="Move down"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}
