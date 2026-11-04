"use client";

import { useEffect, useRef } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50",
        variant === "primary" && "bg-brand text-white hover:bg-brand-hover",
        variant === "ghost" && "text-fg hover:bg-surface-hover",
        variant === "danger" && "bg-danger text-white hover:opacity-90",
        className,
      )}
    />
  );
}

export function Input({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const input = (
    <input
      {...props}
      className={cx(
        "w-full rounded-lg border border-line bg-bg px-3 py-2 text-fg outline-none placeholder:text-muted focus:border-brand",
        className,
      )}
    />
  );
  if (!label) return input;
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {input}
    </label>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-sidebar p-0 text-fg backdrop:bg-black/60"
    >
      <div className="space-y-4 p-6">
        <h2 className="text-lg font-bold">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

export function Avatar({ name, size = 40, online }: { name: string; size?: number; online?: boolean }) {
  // Deterministic colour from the name.
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  const initial = [...name.trim()][0] ?? "?";
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="flex h-full w-full items-center justify-center rounded-full font-bold text-white"
        style={{ background: `hsl(${h} 45% 40%)`, fontSize: size * 0.42 }}
      >
        {initial}
      </span>
      {online !== undefined && (
        <span
          className={cx(
            "absolute bottom-0 end-0 h-3 w-3 rounded-full border-2 border-sidebar",
            online ? "bg-success" : "bg-muted",
          )}
        />
      )}
    </span>
  );
}

export function Splash({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mark-192.png" alt="" width={72} height={72} className="mx-auto mb-3 h-[72px] w-[72px] rounded-[20px] shadow-lg shadow-brand/30" />
        <div className="mb-1 text-2xl font-bold text-brand">مجلس</div>
        <div className="text-sm text-muted">{label}</div>
      </div>
    </div>
  );
}

/** A big selectable card (radio-like) with an icon, title and one-line explanation. */
export function OptionCard({
  selected,
  onSelect,
  icon,
  title,
  hint,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        "flex w-full items-start gap-3 rounded-xl border-2 p-3 text-start transition disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-brand bg-brand/10" : "border-line hover:border-brand/50",
      )}
    >
      <span className="text-2xl leading-none">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
      <span
        className={cx(
          "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-brand bg-brand text-[10px] text-white" : "border-line",
        )}
      >
        {selected && "✓"}
      </span>
    </button>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs font-semibold uppercase tracking-wide text-muted">{children}</span>;
}
