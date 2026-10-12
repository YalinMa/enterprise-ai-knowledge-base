"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import clsx from "clsx";
import { ChevronRight, History, ThumbsDown, ThumbsUp } from "lucide-react";
import { fetcher, type QueryLogSummary } from "@/lib/api";
import { formatDateTime, formatMs } from "@/lib/format";
import { Button, Card, EmptyState, ErrorBanner, PageContainer, PageHeader, QueryStatusBadge, Spinner } from "@/components/ui";

export default function RetrievalsPage() {
  const [filter, setFilter] = useState<"" | "down" | "up">("");
  const { data, error } = useSWR<QueryLogSummary[]>(`/api/retrievals${filter ? `?feedback=${filter}` : ""}`, fetcher, {
    refreshInterval: 5000,
  });

  return (
    <PageContainer>
      <PageHeader
        title="检索记录"
        description="每一次问答的完整 RAG 轨迹：召回了哪些切片、相似度多少、哪些被引用、发给模型的 Prompt 和各阶段耗时。"
      />
      {error && <ErrorBanner message={error.message} />}
      <div className="mb-3 flex gap-1 self-start rounded-lg bg-zinc-100 p-0.5 text-[12.5px]" style={{ width: "fit-content" }}>
        {([["", "全部"], ["down", "差评"], ["up", "好评"]] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={clsx("rounded-md px-3 py-1", filter === v ? "bg-white font-medium shadow-sm" : "text-zinc-500")}
          >
            {label}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        {!data ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            icon={History}
            title={filter ? "没有符合条件的记录" : "还没有检索记录"}
            description={filter ? "在 AI 问答里给回答点赞或点踩后，会出现在这里。" : "去 AI 问答提一个问题，这里会记录它的完整检索过程。"}
            action={
              <Link href="/chat">
                <Button variant="primary">去提问</Button>
              </Link>
            }
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-[12px] text-zinc-400">
                <th className="py-2.5 pr-3 pl-5 font-medium">问题</th>
                <th className="px-3 font-medium">知识库</th>
                <th className="px-3 font-medium">状态</th>
                <th className="px-3 font-medium">反馈</th>
                <th className="px-3 text-right font-medium">引用</th>
                <th className="px-3 text-right font-medium">耗时</th>
                <th className="px-3 font-medium">时间</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {data.map((q) => (
                <tr key={q.id} className="group border-b border-zinc-50 last:border-0 hover:bg-zinc-50/70">
                  <td className="py-3 pr-3 pl-5">
                    <Link href={`/retrievals/${q.id}`} className="block max-w-[420px] truncate font-medium text-zinc-800 group-hover:text-brand-700">
                      {q.question}
                    </Link>
                    <div className="max-w-[420px] truncate text-[11.5px] text-zinc-400">{q.answer.replace(/\s+/g, " ").slice(0, 80) || "—"}</div>
                  </td>
                  <td className="px-3 whitespace-nowrap text-zinc-500">{q.kb_name}</td>
                  <td className="px-3">
                    <QueryStatusBadge status={q.status} />
                  </td>
                  <td className="px-3">
                    {q.feedback?.rating === 1 ? (
                      <ThumbsUp size={14} className="text-emerald-600" />
                    ) : q.feedback?.rating === -1 ? (
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-rose-600" title={q.feedback.comment}>
                        <ThumbsDown size={14} /> {q.feedback.reasons.join("、")}
                      </span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-3 text-right text-zinc-600 tabular-nums">{q.citations.length}</td>
                  <td className="px-3 text-right whitespace-nowrap text-zinc-500 tabular-nums">{formatMs(q.timings?.total_ms)}</td>
                  <td className="px-3 whitespace-nowrap text-zinc-500 tabular-nums">{formatDateTime(q.created_at)}</td>
                  <td className="pr-4">
                    <Link href={`/retrievals/${q.id}`}>
                      <ChevronRight size={15} className="text-zinc-300 group-hover:text-zinc-500" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PageContainer>
  );
}
