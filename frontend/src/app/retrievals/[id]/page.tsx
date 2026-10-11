"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import clsx from "clsx";
import {
  ArrowLeft,
  Binary,
  BrainCircuit,
  ChevronDown,
  Database,
  FileText,
  ListOrdered,
  MessageSquareQuote,
  ScanSearch,
  Search,
  SlidersHorizontal,
  WandSparkles,
} from "lucide-react";
import { fetcher, type QueryLog, type RetrievedChunk } from "@/lib/api";
import { formatDateTime, formatMs, locationLabel } from "@/lib/format";
import { AnswerMarkdown } from "@/components/AnswerMarkdown";
import { SourceDrawer, type SourceRef } from "@/components/SourceDrawer";
import { Badge, Card, ErrorBanner, PageContainer, QueryStatusBadge, ScoreBar, Spinner } from "@/components/ui";

export default function RetrievalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: q, error } = useSWR<QueryLog>(`/api/retrievals/${id}`, fetcher, {
    refreshInterval: (d) => (d?.status === "running" ? 1000 : 0),
  });
  const [source, setSource] = useState<SourceRef | null>(null);

  if (error)
    return (
      <PageContainer>
        <ErrorBanner message={error.message} />
      </PageContainer>
    );
  if (!q)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );

  const threshold = q.params.min_score ?? 0;
  const citeIndex = new Map(q.citations.map((c) => [c.chunk_id, c.index]));
  const t = q.timings ?? {};
  const isRerank = q.params.gate === "rerank";
  const gateLabel = isRerank
    ? `Rerank ≥ ${threshold}${q.params.keep_similarity ? ` 或 相似度 ≥ ${q.params.keep_similarity}` : ""}`
    : `相似度 ≥ ${threshold}`;

  return (
    <PageContainer className="max-w-5xl">
      <Link href="/retrievals" className="mb-4 inline-flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-800">
        <ArrowLeft size={14} /> 检索记录
      </Link>

      {/* 问题 */}
      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-zinc-500">
          <QueryStatusBadge status={q.status} />
          <span className="flex items-center gap-1">
            <Database size={12} /> {q.kb_name}
          </span>
          <span>·</span>
          <span>{formatDateTime(q.created_at)}</span>
          <span>·</span>
          <span className="font-mono">#{q.id}</span>
        </div>
        <div className="text-[11.5px] font-medium tracking-wider text-zinc-400 uppercase">User Question</div>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-zinc-900">{q.question}</h1>
        {q.retrieval_query !== q.question && (
          <div className="mt-1 text-[13px] text-zinc-500">
            检索 Query：<span className="font-mono">{q.retrieval_query}</span>
          </div>
        )}
      </div>

      {/* Pipeline 概览 */}
      <Card className="mb-6 p-5">
        <div className="mb-4 flex items-center gap-1.5 text-[13px] font-semibold text-zinc-800">
          <SlidersHorizontal size={14} /> RAG Pipeline
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Stage
            icon={WandSparkles}
            title="Query Rewrite"
            value={t.rewrite_ms !== undefined ? formatMs(t.rewrite_ms) : "跳过"}
            sub={q.retrieval_query !== q.question ? "追问已改写" : q.params.query_rewrite ? "无需改写" : "未开启"}
          />
          <Stage icon={Binary} title="Embedding" value={formatMs(t.embed_ms)} sub={q.params.embedding} />
          <Stage icon={ScanSearch} title="Vector Search" value={formatMs(t.search_ms)} sub={`候选 Top-${q.params.candidate_k ?? q.params.top_k}`} />
          <Stage
            icon={Search}
            title="BM25"
            value={t.bm25_ms !== undefined ? formatMs(t.bm25_ms) : "跳过"}
            sub={q.params.retrieval_mode === "hybrid" ? "RRF 融合" : "仅向量模式"}
          />
          <Stage
            icon={ListOrdered}
            title="Rerank"
            value={t.rerank_ms !== undefined ? formatMs(t.rerank_ms) : "跳过"}
            sub={q.params.reranked ? q.params.reranker ?? "" : "未开启"}
          />
          <Stage
            icon={BrainCircuit}
            title="LLM 生成"
            value={q.status === "no_context" ? "跳过" : formatMs(t.llm_ms)}
            sub={`${q.params.llm ?? "—"}${t.first_token_ms ? ` · 首字 ${formatMs(t.first_token_ms)}` : ""}`}
          />
          <Stage
            icon={MessageSquareQuote}
            title="Answer + Citation"
            value={formatMs(t.total_ms)}
            sub={`${q.citations.length} 条引用${q.params.invalid_citations?.length ? ` · 过滤 ${q.params.invalid_citations.length} 条无效` : ""}`}
            highlight
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-zinc-100 pt-3 text-[12px] text-zinc-500">
          <span>检索方式：{q.params.retrieval_mode === "hybrid" ? "混合（向量 + BM25）" : "向量"}</span>
          <span>Top-K：{q.params.top_k}</span>
          <span>拒答闸门：{gateLabel}</span>
          <span>Chunk Size：{q.params.chunk_size}</span>
          <span>
            送入 LLM：{q.retrieved.filter((r) => r.passed_threshold).length} / {q.retrieved.length} 个切片
          </span>
        </div>
      </Card>

      {/* Retrieved Chunks */}
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-[15px] font-semibold text-zinc-900">Retrieved Chunks</h2>
        <div className="flex items-center gap-3 text-[11.5px] text-zinc-500">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-[1.5px] bg-amber-500" /> 阈值：{gateLabel}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-brand-500" /> 被回答引用
          </span>
        </div>
      </div>
      <div className="mb-8 space-y-3">
        {q.retrieved.length === 0 && <Card className="p-6 text-center text-[13px] text-zinc-500">没有召回任何切片</Card>}
        {q.retrieved.map((r) => (
          <ChunkCard
            key={r.chunk_id}
            r={r}
            threshold={threshold}
            isRerank={isRerank}
            citedAs={citeIndex.get(r.chunk_id)}
            onOpen={() => setSource({ ...r, index: citeIndex.get(r.chunk_id) })}
          />
        ))}
      </div>

      {/* Answer */}
      <h2 className="mb-3 text-[15px] font-semibold text-zinc-900">Answer</h2>
      <Card className="mb-8 p-5">
        {q.error && <ErrorBanner message={q.error} />}
        {q.answer ? (
          <AnswerMarkdown
            content={q.answer}
            validIndexes={new Set(q.citations.map((c) => c.index))}
            onCite={(n) => {
              const c = q.citations.find((x) => x.index === n);
              if (c) setSource(c);
            }}
          />
        ) : (
          !q.error && <div className="text-[13px] text-zinc-400">（无回答）</div>
        )}
      </Card>

      {/* Prompt */}
      {q.prompt.length > 0 && (
        <>
          <h2 className="mb-1 text-[15px] font-semibold text-zinc-900">Prompt</h2>
          <p className="mb-3 text-[12.5px] text-zinc-500">实际发送给大模型的完整消息。检索到的资料按 [编号] 注入，模型只能引用这些编号，后端再校验并对齐到真实切片。</p>
          <div className="mb-10 space-y-2">
            {q.prompt.map((p, i) => (
              <PromptBlock key={i} role={p.role} content={p.content} defaultOpen={p.role !== "system"} />
            ))}
          </div>
        </>
      )}

      <SourceDrawer source={source} onClose={() => setSource(null)} />
    </PageContainer>
  );
}

function Stage({
  icon: Icon,
  title,
  value,
  sub,
  highlight,
}: {
  icon: typeof Search;
  title: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={clsx("rounded-xl border p-3", highlight ? "border-brand-200 bg-brand-50/50" : "border-zinc-200/80 bg-zinc-50/50")}>
      <div className="flex items-center gap-1.5 text-[11.5px] text-zinc-500">
        <Icon size={13} className={highlight ? "text-brand-600" : "text-zinc-400"} />
        {title}
      </div>
      <div className="mt-1.5 text-[17px] font-semibold text-zinc-900 tabular-nums">{value}</div>
      {sub && (
        <div className="mt-0.5 truncate text-[11px] text-zinc-400" title={sub}>
          {sub}
        </div>
      )}
    </div>
  );
}

function ChunkCard({
  r,
  threshold,
  isRerank,
  citedAs,
  onOpen,
}: {
  r: RetrievedChunk;
  threshold: number;
  isRerank: boolean;
  citedAs?: number;
  onOpen: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = r.content.length > 220;
  return (
    <Card className={clsx("p-4", !r.passed_threshold && "opacity-60", citedAs && "ring-1 ring-brand-200")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-semibold text-zinc-900">Chunk {r.rank}</span>
          {citedAs ? (
            <Badge tone="violet">引用 [{citedAs}]</Badge>
          ) : r.passed_threshold ? (
            <Badge tone="zinc">已送入 LLM · 未引用</Badge>
          ) : (
            <Badge tone="amber">低于阈值 · 未使用</Badge>
          )}
        </div>
        {isRerank && r.rerank_score != null ? (
          <div className="flex items-center gap-1.5" title="Rerank 分数（拒答闸门依据）">
            <span className="text-[11px] text-zinc-400">Rerank</span>
            <ScoreBar score={r.rerank_score} threshold={threshold} />
          </div>
        ) : (
          <div className="flex items-center gap-1.5" title="余弦相似度">
            <span className="text-[11px] text-zinc-400">Similarity</span>
            <ScoreBar score={r.score} threshold={threshold} />
          </div>
        )}
        <button onClick={onOpen} className="ml-auto flex min-w-0 items-center gap-1.5 text-[12.5px] text-zinc-600 hover:text-brand-700">
          <FileText size={13} className="shrink-0 text-zinc-400" />
          <span className="truncate font-medium">{r.document_name}</span>
          {locationLabel(r.page, r.section) && <span className="truncate text-zinc-400">· {locationLabel(r.page, r.section)}</span>}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-zinc-400">
        <span>chunk_id: {r.chunk_id}</span>
        {isRerank && <span>similarity {r.score.toFixed(3)}</span>}
        <span className={r.vector_rank ? "text-zinc-500" : ""}>向量 {r.vector_rank ? `#${r.vector_rank}` : "—"}</span>
        {r.bm25_rank !== undefined && (
          <span className={r.bm25_rank ? "text-zinc-500" : ""}>
            BM25 {r.bm25_rank ? `#${r.bm25_rank} (${r.bm25_score})` : "—"}
          </span>
        )}
        {r.rrf_score != null && <span>RRF {r.rrf_score.toFixed(4)}</span>}
      </div>
      <div
        className={clsx(
          "mt-2.5 rounded-lg bg-zinc-50 px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-zinc-700",
          !expanded && long && "line-clamp-4",
        )}
      >
        {r.content}
      </div>
      {long && (
        <button onClick={() => setExpanded((e) => !e)} className="mt-1.5 flex items-center gap-0.5 text-[12px] text-zinc-500 hover:text-zinc-800">
          <ChevronDown size={13} className={clsx("transition-transform", expanded && "rotate-180")} />
          {expanded ? "收起" : "展开全文"}
        </button>
      )}
    </Card>
  );
}

function PromptBlock({ role, content, defaultOpen }: { role: string; content: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-zinc-50">
        <Badge tone={role === "system" ? "violet" : role === "user" ? "blue" : "zinc"} className="font-mono">
          {role}
        </Badge>
        <span className="truncate text-[12.5px] text-zinc-500">{content.slice(0, 60).replace(/\s+/g, " ")}…</span>
        <span className="ml-auto text-[11.5px] text-zinc-400">{content.length} 字</span>
        <ChevronDown size={14} className={clsx("text-zinc-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <pre className="max-h-[480px] overflow-auto border-t border-zinc-100 bg-zinc-50/60 px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-zinc-700">
          {content}
        </pre>
      )}
    </Card>
  );
}
