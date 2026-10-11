"use client";

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";
import {
  BookOpen,
  Building2,
  Code2,
  FileText,
  Headphones,
  Loader2,
  Megaphone,
  Package,
  Scale,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { DocStatus, QueryStatus } from "@/lib/api";

// ---------------- Button ----------------

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-3.5 text-[13.5px]",
        variant === "primary" && "bg-zinc-900 text-white shadow-sm hover:bg-zinc-800",
        variant === "secondary" && "border border-zinc-200 bg-white text-zinc-700 shadow-xs hover:bg-zinc-50",
        variant === "ghost" && "text-zinc-600 hover:bg-zinc-100",
        variant === "danger" && "bg-rose-600 text-white hover:bg-rose-500",
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

// ---------------- Card / Layout ----------------

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={clsx("rounded-xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]", className)}>
      {children}
    </div>
  );
}

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="flex min-w-0 items-start gap-3.5">
        {icon}
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900">{title}</h1>
          {description && <p className="mt-1 text-[13.5px] text-zinc-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400">
        <Icon size={20} />
      </div>
      <div className="text-[14px] font-medium text-zinc-800">{title}</div>
      {description && <div className="mt-1 max-w-sm text-[13px] text-zinc-500">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={clsx("animate-spin text-zinc-400", className)} />;
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{message}</div>
  );
}

// ---------------- Badge ----------------

export function Badge({
  tone = "zinc",
  children,
  className,
}: {
  tone?: "zinc" | "green" | "amber" | "red" | "blue" | "violet";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap",
        tone === "zinc" && "bg-zinc-100 text-zinc-600",
        tone === "green" && "bg-emerald-50 text-emerald-700",
        tone === "amber" && "bg-amber-50 text-amber-700",
        tone === "red" && "bg-rose-50 text-rose-700",
        tone === "blue" && "bg-sky-50 text-sky-700",
        tone === "violet" && "bg-brand-50 text-brand-700",
        className,
      )}
    >
      {children}
    </span>
  );
}

const DOC_STATUS: Record<DocStatus, { label: string; tone: "zinc" | "green" | "amber" | "red" | "blue" }> = {
  pending: { label: "排队中", tone: "zinc" },
  parsing: { label: "解析中", tone: "blue" },
  embedding: { label: "向量化中", tone: "blue" },
  ready: { label: "已完成", tone: "green" },
  failed: { label: "解析失败", tone: "red" },
};

export function DocStatusBadge({ status, error }: { status: DocStatus; error?: string | null }) {
  const s = DOC_STATUS[status] ?? DOC_STATUS.pending;
  const busy = status === "pending" || status === "parsing" || status === "embedding";
  return (
    <span title={error ?? undefined}>
      <Badge tone={s.tone}>
        {busy ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <span className={clsx("h-1.5 w-1.5 rounded-full", status === "ready" ? "bg-emerald-500" : "bg-rose-500")} />
        )}
        {s.label}
      </Badge>
    </span>
  );
}

const QUERY_STATUS: Record<QueryStatus, { label: string; tone: "green" | "amber" | "red" | "zinc" }> = {
  ok: { label: "已回答", tone: "green" },
  no_context: { label: "未召回", tone: "amber" },
  no_answer: { label: "资料不足", tone: "amber" },
  error: { label: "出错", tone: "red" },
  running: { label: "进行中", tone: "zinc" },
};

export function QueryStatusBadge({ status }: { status: QueryStatus }) {
  const s = QUERY_STATUS[status] ?? QUERY_STATUS.running;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

// ---------------- Icons ----------------

export const KB_ICONS: Record<string, { icon: LucideIcon; bg: string }> = {
  book: { icon: BookOpen, bg: "from-indigo-500 to-violet-500" },
  building: { icon: Building2, bg: "from-sky-500 to-indigo-500" },
  package: { icon: Package, bg: "from-orange-400 to-rose-500" },
  code: { icon: Code2, bg: "from-emerald-500 to-teal-500" },
  megaphone: { icon: Megaphone, bg: "from-fuchsia-500 to-pink-500" },
  users: { icon: Users, bg: "from-amber-400 to-orange-500" },
  headphones: { icon: Headphones, bg: "from-cyan-500 to-sky-500" },
  scale: { icon: Scale, bg: "from-slate-500 to-zinc-700" },
};

export function KBIcon({ icon, size = 36 }: { icon: string; size?: number }) {
  const { icon: Icon, bg } = KB_ICONS[icon] ?? KB_ICONS.book;
  return (
    <div
      className={clsx("flex shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br text-white shadow-sm", bg)}
      style={{ width: size, height: size }}
    >
      <Icon size={size * 0.48} strokeWidth={2.1} />
    </div>
  );
}

const FILE_COLORS: Record<string, string> = {
  pdf: "bg-rose-50 text-rose-600",
  docx: "bg-sky-50 text-sky-600",
  md: "bg-zinc-100 text-zinc-700",
  markdown: "bg-zinc-100 text-zinc-700",
  txt: "bg-amber-50 text-amber-700",
};

export function FileTypeIcon({ type, size = 32 }: { type: string; size?: number }) {
  return (
    <div
      className={clsx("flex shrink-0 flex-col items-center justify-center rounded-lg", FILE_COLORS[type] ?? "bg-zinc-100 text-zinc-500")}
      style={{ width: size, height: size }}
    >
      <FileText size={size * 0.42} />
      <span className="mt-[-1px] text-[8px] font-bold uppercase">{type === "markdown" ? "md" : type}</span>
    </div>
  );
}

// ---------------- Modal / Drawer ----------------

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEscape(onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/20 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className="animate-fade-up w-full rounded-2xl border border-zinc-200 bg-white shadow-2xl"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="text-[15px] font-semibold">{title}</div>
          <button onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 pt-2 pb-5">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "确认",
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmText?: string;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={400}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="text-[13.5px] leading-relaxed text-zinc-600">{message}</div>
    </Modal>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  useEscape(onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-zinc-900/10" onMouseDown={onClose}>
      <div
        className="animate-slide-in flex h-full w-full flex-col border-l border-zinc-200 bg-white shadow-2xl"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
          <div className="min-w-0 flex-1">{title}</div>
          <button onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ---------------- Score bar ----------------

export function ScoreBar({ score, threshold }: { score: number; threshold?: number }) {
  const pct = Math.max(0, Math.min(1, score)) * 100;
  const pass = threshold === undefined || score >= threshold;
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative h-1.5 w-28 overflow-hidden rounded-full bg-zinc-100">
        <div
          className={clsx("h-full rounded-full", pass ? "bg-gradient-to-r from-brand-500 to-violet-500" : "bg-zinc-300")}
          style={{ width: `${pct}%` }}
        />
        {threshold !== undefined && (
          <div className="absolute top-[-2px] h-[10px] w-[1.5px] bg-amber-500" style={{ left: `${threshold * 100}%` }} />
        )}
      </div>
      <span className={clsx("font-mono text-[12.5px] tabular-nums", pass ? "text-zinc-800" : "text-zinc-400")}>
        {score.toFixed(3)}
      </span>
    </div>
  );
}
