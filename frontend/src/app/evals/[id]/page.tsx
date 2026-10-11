"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import clsx from "clsx";
import { ArrowLeft, Check, ChevronDown, ScanSearch, X } from "lucide-react";
import { fetcher, type EvalCaseResult, type EvalRun } from "@/lib/api";
import { formatDateTime, formatMs } from "@/lib/format";
import { Badge, Card, ErrorBanner, PageContainer, Spinner } from "@/components/ui";
import { ConfigBadges } from "@/components/ConfigBadges";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export default function EvalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: run, error } = useSWR<EvalRun>(`/api/evals/${id}`, fetcher, {
    refreshInterval: (d) => (d?.status === "running" ? 1000 : 0),
    refreshWhenHidden: true,
  });
  const [filter, setFilter] = useState<"all" | "failed">("all");

  if (error)
    return (
      <PageContainer>
        <ErrorBanner message={error.message} />
      </PageContainer>
    );
  if (!run)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );

  const m = run.metrics;
  const results = run.results ?? [];
  const shown = filter === "failed" ? results.filter((r) => !r.passed) : results;
  const full = run.mode === "full";
  const cards: [string, string, string][] = [
    ["通过率", pct(m.pass_rate), `${results.filter((r) => r.passed).length} / ${run.total} 题`],
    ["Hit@K", pct(m.hit_rate), "正确文档被送入 LLM"],
    ["MRR", m.mrr != null ? m.mrr.toFixed(3) : "—", "正确文档排得越前越高"],
    ["Context Recall", pct(m.context_recall), "关键事实被检索到"],
    ["拒答准确率", pct(m.refusal_accuracy), `误拒率 ${pct(m.false_refusal_rate)}`],
    ...(full
      ? ([
          ["答案准确率", pct(m.answer_accuracy), "答案包含全部关键事实"],
          ["引用命中率", pct(m.citation_hit_rate), "引用了正确文档"],
        ] as [string, string, string][])
      : []),
    ["平均耗时", formatMs(m.latency_avg_ms), `P95 ${formatMs(m.latency_p95_ms)}`],
  ];

  return (
    <PageContainer>
      <Link href="/evals" className="mb-4 inline-flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-800">
        <ArrowLeft size={14} /> RAG 评测
      </Link>

      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-zinc-500">
          <span className="font-mono">#{run.id}</span>
          <span>·</span>
          <span>{run.kb_name}</span>
          <span>·</span>
          <span>{formatDateTime(run.created_at)}</span>
        </div>
        <h1 className="mb-2 text-[22px] font-semibold tracking-tight text-zinc-900">评测结果</h1>
        <ConfigBadges run={run} />
        <div className="mt-2 font-mono text-[11.5px] text-zinc-400">
          Embedding {run.config.embedding} · LLM {run.config.llm}
          {run.config.rerank && ` · Reranker ${run.config.reranker}`} · Top-{run.config.top_k}
        </div>
      </div>

      {run.status === "running" && (
        <Card className="mb-6 p-5">
          <div className="mb-2 flex items-center gap-2 text-[13px] text-sky-700">
            <Spinner size={14} className="text-sky-500" /> 评测进行中 {run.progress} / {run.total}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(run.progress / run.total) * 100}%` }} />
          </div>
        </Card>
      )}
      {run.status === "failed" && (
        <div className="mb-6">
          <ErrorBanner message={`评测失败：${run.error}`} />
        </div>
      )}

      {run.status === "done" && (
        <>
          <div className={clsx("mb-6 grid grid-cols-2 gap-3 md:grid-cols-3", full ? "xl:grid-cols-4" : "xl:grid-cols-6")}>
            {cards.map(([label, value, sub]) => (
              <Card key={label} className="p-4">
                <div className="text-[12px] text-zinc-500">{label}</div>
                <div className="mt-1.5 text-[24px] leading-none font-semibold tracking-tight text-zinc-900 tabular-nums">{value}</div>
                <div className="mt-1.5 text-[11.5px] text-zinc-400">{sub}</div>
              </Card>
            ))}
          </div>

          <Card className="mb-6 p-5">
            <div className="mb-3 text-[13px] font-semibold text-zinc-800">按题型</div>
            <div className="space-y-2.5">
              {Object.entries(m.by_category ?? {}).map(([cat, v]) => (
                <div key={cat} className="flex items-center gap-3 text-[12.5px]">
                  <div className="w-20 shrink-0 text-zinc-600">{cat}</div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className={clsx("h-full rounded-full", v.passed === v.total ? "bg-emerald-500" : "bg-brand-500")}
                      style={{ width: `${(v.passed / v.total) * 100}%` }}
                    />
                  </div>
                  <div className="w-14 shrink-0 text-right text-zinc-500 tabular-nums">
                    {v.passed} / {v.total}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-zinc-900">逐题结果</h2>
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 text-[12.5px]">
          {(["all", "failed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx("rounded-md px-3 py-1", filter === f ? "bg-white font-medium shadow-sm" : "text-zinc-500")}
            >
              {f === "all" ? `全部 ${results.length}` : `未通过 ${results.filter((r) => !r.passed).length}`}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2 pb-10">
        {shown.map((r) => (
          <CaseRow key={r.id} r={r} full={full} />
        ))}
        {shown.length === 0 && <Card className="p-6 text-center text-[13px] text-zinc-500">没有未通过的题目 🎉</Card>}
      </div>
    </PageContainer>
  );
}

function CaseRow({ r, full }: { r: EvalCaseResult; full: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className={clsx("overflow-hidden", !r.passed && "border-rose-200")}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50/60">
        <span
          className={clsx(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            r.passed ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-600",
          )}
        >
          {r.passed ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
        </span>
        <span className="w-9 shrink-0 font-mono text-[11.5px] text-zinc-400">{r.id}</span>
        <Badge className="shrink-0">{r.category}</Badge>
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-800">{r.question}</span>
        {r.reason && <span className="shrink-0 text-[12px] text-rose-600">{r.reason}</span>}
        <span className="w-20 shrink-0 text-right text-[12px] text-zinc-400 tabular-nums">
          {r.should_refuse ? (r.refused ? "已拒答" : "未拒答") : r.hit_rank ? `命中 #${r.hit_rank}` : "未命中"}
        </span>
        <ChevronDown size={14} className={clsx("shrink-0 text-zinc-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-zinc-100 bg-zinc-50/40 px-4 py-3 text-[12.5px]">
          {r.retrieval_query && r.retrieval_query !== r.question && (
            <div>
              <span className="text-zinc-400">改写后检索：</span>
              <span className="text-violet-700">{r.retrieval_query}</span>
            </div>
          )}
          {!r.should_refuse && (
            <div className="text-zinc-600">
              <span className="text-zinc-400">期望文档：</span>
              {r.expected_docs.join("、")}
              <span className="ml-4 text-zinc-400">Context Recall：</span>
              {pct(r.context_recall)}
              {full && (
                <>
                  <span className="ml-4 text-zinc-400">答案关键事实：</span>
                  {pct(r.answer_recall)}
                </>
              )}
            </div>
          )}
          {r.top_chunks && r.top_chunks.length > 0 && (
            <table className="w-full max-w-2xl text-[12px]">
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className="py-1 font-medium">#</th>
                  <th className="font-medium">召回文档</th>
                  <th className="text-right font-medium">Similarity</th>
                  <th className="text-right font-medium">Rerank</th>
                  <th className="text-right font-medium">送入 LLM</th>
                </tr>
              </thead>
              <tbody>
                {r.top_chunks.map((c, i) => (
                  <tr key={i} className={clsx(r.expected_docs.includes(c.document_name) ? "text-zinc-900" : "text-zinc-500")}>
                    <td className="py-0.5">{i + 1}</td>
                    <td>
                      {c.document_name}
                      {r.expected_docs.includes(c.document_name) && <span className="ml-1 text-emerald-600">✓</span>}
                    </td>
                    <td className="text-right tabular-nums">{c.score.toFixed(3)}</td>
                    <td className="text-right tabular-nums">{c.rerank_score != null ? c.rerank_score.toFixed(3) : "—"}</td>
                    <td className="text-right">{c.passed ? "是" : "否"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {full && r.answer && <div className="rounded-lg bg-white p-3 leading-relaxed whitespace-pre-wrap text-zinc-700">{r.answer}</div>}
          {r.query_id && (
            <Link href={`/retrievals/${r.query_id}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline">
              <ScanSearch size={13} /> 查看检索详情
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
