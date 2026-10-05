"use client";

/* Shared building blocks for dashboard pages, so every screen uses the same
 * look: black page, dark panels for page chrome, cream surfaces for records
 * (table rows, item cards, modals) and the orange accent for actions. */

import {
  useEffect,
  useMemo,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Loader2, Search, Upload, X, type LucideIcon } from "lucide-react";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ PAGE */

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /* Buttons shown on the right (stacked under the title on small screens). */
  actions?: ReactNode;
  /* Extra lines under the description, e.g. a hint with links. */
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-[#ff7a59] sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-3xl text-sm text-[#e8dcc7]/80 sm:text-base">
            {description}
          </p>
        )}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* A smaller heading between blocks of a page. */
export function SectionHeading({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mb-4 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-[#f4ead7]">{title}</h2>
        {description && <p className="mt-1 text-sm text-[#f4ead7]/60">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- BUTTONS */

export type ButtonVariant =
  | "primary" // filled orange: the main action in a modal or row
  | "outline" // orange outline: page-level actions ("Add Listing")
  | "secondary" // neutral, on dark surfaces
  | "light" // neutral, on cream surfaces (modal "Cancel")
  | "danger" // red outline: destructive row action
  | "danger-solid" // filled red: confirm a destructive action
  | "success" // filled green: approve
  | "warning"; // filled amber: restrict / suspend

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-[#ff7a59] text-white hover:bg-[#ff6b4a]",
  outline: "border border-[#ff7a59] text-[#ff7a59] hover:bg-[#ff7a59] hover:text-white",
  secondary:
    "border border-white/15 text-[#f4ead7] hover:border-white/30 hover:bg-white/5",
  light: "border border-black/15 text-black hover:bg-black/5",
  danger: "border border-red-400 text-red-500 hover:bg-red-500 hover:text-white",
  "danger-solid": "bg-red-500 text-white hover:bg-red-600",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
  warning: "bg-amber-600 text-white hover:bg-amber-700",
};

const BUTTON_SIZES = {
  sm: "gap-1 rounded-md px-2.5 py-1 text-xs",
  md: "gap-2 rounded-xl px-4 py-2 text-sm",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: keyof typeof BUTTON_SIZES = "md",
): string {
  return cx(
    "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff7a59]/50 disabled:cursor-not-allowed disabled:opacity-50",
    BUTTON_SIZES[size],
    BUTTON_VARIANTS[variant],
  );
}

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
  icon?: LucideIcon;
  /* Shows a spinner in place of the icon and disables the button. */
  loading?: boolean;
}) {
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(buttonClass(variant, size), className)}
    >
      {loading ? (
        <Loader2 className={cx(iconSize, "animate-spin")} aria-hidden />
      ) : (
        Icon && <Icon className={iconSize} aria-hidden />
      )}
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- PANELS */

/* Dark panel for page chrome (forms, settings, grouped content); `cream` for a
 * record shown as a card (a challenge, a poll, a post). */
export function Card({
  title,
  description,
  actions,
  tone = "dark",
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: "dark" | "cream";
  className?: string;
  children?: ReactNode;
}) {
  const cream = tone === "cream";
  return (
    <section
      className={cx(
        "rounded-2xl p-5",
        cream
          ? "border border-black/5 bg-[#ece2cb] text-black"
          : "border border-white/10 bg-[#0d0d0d] text-[#f4ead7]",
        className,
      )}
    >
      {(title || description || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className={cx("text-base font-semibold", cream ? "text-black" : "text-[#f4ead7]")}>
                {title}
              </h2>
            )}
            {description && (
              <p className={cx("mt-1 text-sm", cream ? "text-black/60" : "text-[#f4ead7]/60")}>
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type BadgeTone = "neutral" | "dark" | "amber" | "green" | "red" | "orange" | "blue" | "purple";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-black/10 text-black/70", // on cream
  dark: "bg-white/10 text-[#f4ead7]/80", // on dark
  amber: "bg-amber-200 text-amber-900",
  green: "bg-emerald-200 text-emerald-900",
  red: "bg-red-200 text-red-900",
  orange: "bg-[#ff7a59] text-white",
  blue: "bg-sky-200 text-sky-900",
  purple: "bg-violet-200 text-violet-900",
};

export function Badge({
  tone = "neutral",
  className,
  title,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- STATES */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("h-5 w-5 animate-spin text-[#ff7a59]", className)} aria-hidden />;
}

export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div
      className={cx(
        "flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#0d0d0d] px-5 py-12 text-sm text-[#f4ead7]/60",
        className,
      )}
    >
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center rounded-2xl border border-dashed border-white/15 bg-[#0d0d0d] px-5 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#ff7a59]/10 text-[#ff7a59]">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      )}
      <p className="text-sm font-medium text-[#f4ead7]">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-[#f4ead7]/55">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export type AlertTone = "error" | "success" | "warning" | "info";

const ALERT_DARK: Record<AlertTone, string> = {
  error: "border-red-400/40 bg-red-500/10 text-red-200",
  success: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
  warning: "border-amber-400/40 bg-amber-500/10 text-amber-100",
  info: "border-sky-400/40 bg-sky-500/10 text-sky-100",
};

const ALERT_LIGHT: Record<AlertTone, string> = {
  error: "border-red-300 bg-red-50 text-red-700",
  success: "border-emerald-300 bg-emerald-50 text-emerald-800",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  info: "border-sky-300 bg-sky-50 text-sky-900",
};

/* `surface="light"` inside cream modals and cards. */
export function Alert({
  tone = "error",
  surface = "dark",
  className,
  onDismiss,
  children,
}: {
  tone?: AlertTone;
  surface?: "dark" | "light";
  className?: string;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm",
        (surface === "light" ? ALERT_LIGHT : ALERT_DARK)[tone],
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 opacity-70 transition hover:opacity-100"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- TABLES */

/* Class names for a data table, matching the Listings table. Rows are kept
 * compact so a screen shows many records (client feedback, Oct 2026). Wrap the
 * <table> in `table.wrap`; give the <table> a min width (e.g.
 * `min-w-[760px]`) so it scrolls sideways on phones instead of squashing. */
export const table = {
  wrap: "overflow-x-auto rounded-2xl border border-white/10",
  table: "w-full text-left text-[13px]",
  thead: "bg-[#e3d7bc] text-[11px] uppercase tracking-wide text-black/60",
  th: "px-3 py-2 font-semibold whitespace-nowrap",
  row: "border-b border-black/10 bg-[#ece2cb] text-black transition last:border-b-0 hover:bg-[#f5ecd7]",
  td: "px-3 py-1.5",
  groupRow: "border-b border-black/10 bg-[#d9cbab] text-black",
  /* Thumbnail image in a cell, and the placeholder when there is none. */
  thumb: "h-9 w-9 rounded-md border border-black/10 object-cover",
  thumbEmpty:
    "flex h-9 w-9 items-center justify-center rounded-md border border-black/10 bg-black/5 text-[9px] text-black/35",
  /* Banner-shaped variants. */
  thumbWide: "h-9 w-16 rounded-md border border-black/10 object-cover",
  thumbWideEmpty:
    "flex h-9 w-16 items-center justify-center rounded-md border border-black/10 bg-black/5 text-[9px] text-black/35",
  /* Right-aligned cell holding the row's action buttons. */
  actions: "flex justify-end gap-1.5",
};

/* -------------------------------------------------------------- FILTERS */

export const filterControlClass =
  "rounded-xl border border-white/15 bg-[#0a0a0a] px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/40 focus:border-[#ff7a59]";

/* Row of filters above a list. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mb-6 flex flex-wrap items-center gap-3", className)}>{children}</div>;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  width = "w-full sm:w-72",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /* Width classes, replacing the default. */
  width?: string;
  className?: string;
}) {
  return (
    <div className={cx("relative", width, className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/40"
        aria-hidden
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cx(filterControlClass, "w-full pr-9 pl-9")}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-white/40 transition hover:text-white"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function FilterSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(filterControlClass, className)} />;
}

/* Pill switch between a few options, used for filters and tabs. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ value: T; label: ReactNode; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cx(
        "inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-[#ff7a59]/50 bg-[#0a0a0a] p-1 text-sm",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition sm:px-4",
              active ? "bg-[#ff7a59] text-white" : "text-[#f3ead7]/80 hover:text-[#ff7a59]",
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={cx(
                  "rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                  active ? "bg-white/25 text-white" : "bg-white/10 text-[#f3ead7]/70",
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* "Showing 1–25 of 286" with numbered pages. `page` is 1-based. */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  total,
  perPage,
  extra,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  total: number;
  perPage: number;
  /* Shown after the summary, e.g. "· 286 total". */
  extra?: ReactNode;
  className?: string;
}) {
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (n) => n === 1 || n === totalPages || Math.abs(n - page) <= 1,
  );
  const pageButton = "min-w-9 rounded-lg px-3 py-1.5 text-sm transition";

  return (
    <div
      className={cx(
        "mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-[#f3ead7]",
        className,
      )}
    >
      <p className="text-[#f3ead7]/70">
        Showing {from}–{to} of {total}
        {extra}
      </p>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className={cx(pageButton, "border border-white/10 hover:border-white/30 disabled:opacity-40")}
          >
            Previous
          </button>
          {pages.map((n, index) => (
            <span key={n} className="flex items-center gap-1.5">
              {index > 0 && n - pages[index - 1] > 1 && <span className="px-1 text-[#f3ead7]/40">…</span>}
              <button
                type="button"
                onClick={() => onPageChange(n)}
                aria-current={n === page ? "page" : undefined}
                className={cx(
                  pageButton,
                  n === page
                    ? "bg-[#ff7a59] text-white"
                    : "border border-white/10 hover:border-white/30",
                )}
              >
                {n}
              </button>
            </span>
          ))}
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className={cx(pageButton, "border border-white/10 hover:border-white/30 disabled:opacity-40")}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- MODAL */

let scrollLocks = 0;

const MODAL_SIZES = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

/* Cream dialog over a dimmed page. The page behind stops scrolling while it
 * is open. Put form fields in `children` and buttons in `footer`. */
export function Modal({
  title,
  description,
  onClose,
  size = "lg",
  layer = "base",
  footer,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  size?: keyof typeof MODAL_SIZES;
  /* "top" stacks above another open dialog or drawer. */
  layer?: "base" | "top";
  /* Pinned under the scrolling body, right-aligned. */
  footer?: ReactNode;
  children?: ReactNode;
}) {
  useEffect(() => {
    if (scrollLocks++ === 0) document.body.style.overflow = "hidden";
    return () => {
      if (--scrollLocks === 0) document.body.style.overflow = "";
    };
  }, []);

  return (
    <div
      className={cx(
        "fixed inset-0 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm",
        layer === "top" ? "z-[60]" : "z-50",
      )}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-3xl bg-[#e8dcc7] text-black shadow-2xl",
          MODAL_SIZES[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-[#ff7a59]">{title}</h2>
            {description && <p className="mt-1 text-sm text-black/60">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/10 text-black transition hover:bg-black/20"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-3 border-t border-black/10 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- FORMS */

/* Fields default to the cream surface of modals; `tone="dark"` on dark panels. */
type Tone = "light" | "dark";

const INPUT_TONES: Record<Tone, string> = {
  light:
    "border-black/15 bg-white text-black placeholder:text-black/35 focus:border-[#ff7a59] focus:ring-[#ff7a59]/30",
  dark: "border-white/15 bg-[#0a0a0a] text-white placeholder:text-white/35 focus:border-[#ff7a59] focus:ring-[#ff7a59]/20",
};

export function inputClass(tone: Tone = "light"): string {
  return cx(
    "w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60",
    INPUT_TONES[tone],
  );
}

export function Field({
  label,
  hint,
  tone = "light",
  flush = false,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  /* Drop the top margin, e.g. for the first field in a grid row. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const dark = tone === "dark";
  return (
    <div className={cx(!flush && "mt-4", className)}>
      <label className={cx("block text-sm font-semibold", dark ? "text-[#f4ead7]" : "text-black")}>
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {hint && <p className={cx("mt-1 text-xs", dark ? "text-[#f4ead7]/50" : "text-black/55")}>{hint}</p>}
    </div>
  );
}

export function TextInput({
  tone = "light",
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { tone?: Tone }) {
  return <input {...props} className={cx(inputClass(tone), className)} />;
}

export function TextArea({
  tone = "light",
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { tone?: Tone }) {
  return <textarea {...props} className={cx(inputClass(tone), "min-h-28", className)} />;
}

export function SelectInput({
  tone = "light",
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { tone?: Tone }) {
  return <select {...props} className={cx(inputClass(tone), className)} />;
}

/* Underlined uppercase heading that splits a long form into sections. */
export function FormSection({ children, tone = "light" }: { children: ReactNode; tone?: Tone }) {
  return (
    <h3
      className={cx(
        "mt-6 border-b pb-1 text-xs font-bold tracking-wide uppercase",
        tone === "dark" ? "border-white/10 text-[#f4ead7]/50" : "border-black/10 text-black/55",
      )}
    >
      {children}
    </h3>
  );
}

export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  tone = "light",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /* Accessible name when there is no visible label next to it. */
  label?: string;
  tone?: Tone;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff7a59]/40 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-[#ff7a59]" : tone === "dark" ? "bg-white/20" : "bg-black/20",
      )}
    >
      <span
        className={cx(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-1",
        )}
      />
    </button>
  );
}

/* A labelled on/off setting in a bordered box. */
export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  tone = "light",
  flush = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  tone?: Tone;
  /* Drop the top margin. */
  flush?: boolean;
  className?: string;
}) {
  const dark = tone === "dark";
  return (
    <div
      className={cx(
        !flush && "mt-4",
        "flex items-center justify-between gap-4 rounded-xl border px-4 py-3",
        dark ? "border-white/10 bg-white/3" : "border-black/10 bg-white/50",
        className,
      )}
    >
      <div className="min-w-0">
        <p className={cx("text-sm font-semibold", dark ? "text-[#f4ead7]" : "text-black")}>{title}</p>
        {description && (
          <p className={cx("mt-0.5 text-xs", dark ? "text-[#f4ead7]/55" : "text-black/60")}>{description}</p>
        )}
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        tone={tone}
        label={typeof title === "string" ? title : undefined}
      />
    </div>
  );
}

/* Object URL for previewing a chosen file; revoked when the file changes. */
export function useObjectUrl(file: File | null): string {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}

/* Image preview with an upload button, for cream modals. */
export function ImagePicker({
  label,
  previewUrl,
  onFile,
  accept,
  note,
  shape = "square",
  children,
}: {
  label: ReactNode;
  previewUrl: string;
  onFile: (file: File | null) => void;
  accept?: string;
  /* Short line under the button, e.g. the chosen file name. */
  note?: ReactNode;
  /* "wide" for banner-shaped images. */
  shape?: "square" | "wide";
  /* Extra controls next to the upload button, e.g. "Remove image". */
  children?: ReactNode;
}) {
  const size = shape === "wide" ? "h-20 w-28" : "h-20 w-20";
  return (
    <Field label={label}>
      <div className="flex flex-col gap-4 rounded-2xl border border-black/10 bg-white/50 p-4 sm:flex-row sm:items-center">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Preview"
            className={cx(size, "shrink-0 rounded-xl border border-black/10 object-cover")}
          />
        ) : (
          <div
            className={cx(
              size,
              "flex shrink-0 items-center justify-center rounded-xl border border-dashed border-black/20 bg-black/5 text-xs text-black/40",
            )}
          >
            No image
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <label className={cx(buttonClass("outline"), "cursor-pointer")}>
              <Upload className="h-4 w-4" aria-hidden />
              {previewUrl ? "Change Image" : "Upload Image"}
              <input
                type="file"
                hidden
                accept={accept}
                onChange={(e) => onFile(e.target.files?.[0] || null)}
              />
            </label>
            {children}
          </div>
          {note && <p className="mt-2 truncate text-xs text-black/55">{note}</p>}
        </div>
      </div>
    </Field>
  );
}
