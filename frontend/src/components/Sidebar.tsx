"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { BookOpen, FlaskConical, History, MessageSquareText, Settings, Sparkles } from "lucide-react";
import clsx from "clsx";
import { fetcher, type SystemConfig } from "@/lib/api";

const NAV = [
  { href: "/", label: "知识库", icon: BookOpen, match: (p: string) => p === "/" || p.startsWith("/kb") },
  { href: "/chat", label: "AI 问答", icon: MessageSquareText, match: (p: string) => p.startsWith("/chat") },
  { href: "/retrievals", label: "检索记录", icon: History, match: (p: string) => p.startsWith("/retrievals") },
  { href: "/evals", label: "RAG 评测", icon: FlaskConical, match: (p: string) => p.startsWith("/evals") },
  { href: "/settings", label: "设置", icon: Settings, match: (p: string) => p.startsWith("/settings") },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: cfg, error } = useSWR<SystemConfig>("/api/system/config", fetcher);

  return (
    <aside className="flex w-[60px] shrink-0 flex-col border-r border-zinc-200/80 bg-white lg:w-[232px]">
      <Link href="/" className="flex items-center gap-2.5 px-3.5 pt-5 pb-6 lg:px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-sm shadow-brand-500/30">
          <Sparkles size={16} strokeWidth={2.4} />
        </div>
        <div className="hidden leading-tight lg:block">
          <div className="text-[15px] font-semibold tracking-tight">知源</div>
          <div className="text-[11px] text-zinc-400">Enterprise AI Knowledge</div>
        </div>
      </Link>

      <nav className="flex flex-col gap-0.5 px-2 lg:px-3">
        {NAV.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={clsx(
                "flex items-center justify-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors lg:justify-start",
                active ? "bg-zinc-100 font-medium text-zinc-900" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800",
              )}
            >
              <Icon size={16} className={clsx("shrink-0", active && "text-brand-600")} />
              <span className="hidden lg:inline">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto hidden p-3 lg:block">
        <Link
          href="/settings"
          className="block rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3 text-[11.5px] leading-relaxed text-zinc-500 hover:border-zinc-300"
        >
          {error ? (
            <div className="flex items-center gap-1.5 text-rose-500">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              后端未连接
            </div>
          ) : cfg ? (
            <>
              <div className="mb-1 flex items-center gap-1.5 font-medium text-zinc-700">
                <span
                  className={clsx(
                    "h-1.5 w-1.5 rounded-full",
                    cfg.providers.llm.is_mock ? "bg-amber-400" : "bg-emerald-500",
                  )}
                />
                {cfg.providers.llm.is_mock ? "Mock 演示模式" : "模型已连接"}
              </div>
              <div className="truncate">LLM · {cfg.providers.llm.model}</div>
              <div className="truncate">Embedding · {cfg.providers.embedding.model}</div>
            </>
          ) : (
            <div>正在连接后端…</div>
          )}
        </Link>
      </div>
    </aside>
  );
}
