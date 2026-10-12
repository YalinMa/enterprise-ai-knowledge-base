"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import clsx from "clsx";
import { Check, Copy, FileText, Lightbulb, MessageCircleQuestion, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { api, fetcher, type Insights, type KnowledgeBase, type KnowledgeGap } from "@/lib/api";
import { formatMs, timeAgo } from "@/lib/format";
import { Badge, Button, Card, EmptyState, PageContainer, PageHeader, Spinner } from "@/components/ui";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export default function InsightsPage() {
  const [kbId, setKbId] = useState<number | null>(null);
  const q = kbId ? `?kb_id=${kbId}` : "";
  const { data: kbs } = useSWR<KnowledgeBase[]>("/api/knowledge-bases", fetcher);
  const { data } = useSWR<Insights>(`/api/insights${q}`, fetcher);

  return (
    <PageContainer>
      <PageHeader
        title="知识洞察"
        description="从员工的真实提问里发现知识缺口：哪些问题答不上、被点踩，应该补充什么文档、找哪个部门。"
        actions={
          <select
            value={kbId ?? ""}
            onChange={(e) => setKbId(e.target.value ? Number(e.target.value) : null)}
            className="h-9 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] outline-none focus:border-brand-500"
          >
            <option value="">全部知识库</option>
            {(kbs ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        }
      />

      {!data ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : data.total === 0 ? (
        <Card>
          <EmptyState
            icon={Lightbulb}
            title="近 30 天还没有提问"
            description={
              <>
                去 AI 问答提几个问题，或在后端运行 <code className="font-mono">python scripts/simulate_usage.py</code> 生成模拟数据。
              </>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="提问数（近 30 天）" value={String(data.total)} />
            <Stat
              label="拒答率"
              value={pct(data.refusal_rate)}
              sub={`${data.refused} 次没找到资料`}
              warn={(data.refusal_rate ?? 0) > 0.2}
            />
            <Stat
              label="用户反馈"
              value={
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <ThumbsUp size={18} className="text-zinc-400" />
                    {data.upvotes}
                  </span>
                  <span className="flex items-center gap-1">
                    <ThumbsDown size={18} className="text-zinc-400" />
                    {data.downvotes}
                  </span>
                </span>
              }
              sub={`反馈率 ${pct(data.feedback_rate)}`}
            />
            <Stat label="平均首字 / 总耗时" value={formatMs(data.first_token_avg_ms)} sub={`总耗时 ${formatMs(data.latency_avg_ms)}`} />
          </div>

          <GapsSection kbId={kbId} problemCount={data.problem_count} />

          <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <div className="mb-1 text-[13.5px] font-semibold text-zinc-900">每日提问量</div>
              <div className="mb-4 text-[12px] text-zinc-400">近 14 天 · 悬停查看拒答数</div>
              <TrendBars trend={data.trend} />
            </Card>
            <Card className="p-5">
              <div className="mb-1 text-[13.5px] font-semibold text-zinc-900">文档引用次数</div>
              <div className="mb-4 text-[12px] text-zinc-400">从未被引用的文档可能已过时或不被需要</div>
              <DocUsage docs={data.doc_usage} />
            </Card>
          </div>

          <Card className="mb-10 p-5">
            <div className="mb-4 flex items-center gap-1.5 text-[13.5px] font-semibold text-zinc-900">
              <MessageCircleQuestion size={15} /> 热门问题
              <span className="font-normal text-zinc-400">· 相似问法已合并</span>
            </div>
            <div className="divide-y divide-zinc-100">
              {data.hot_questions.map((h, i) => (
                <div key={i} className="flex items-start gap-3 py-2.5 text-[13px]">
                  <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-[12px] text-zinc-400">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-zinc-800">{h.examples[0]}</div>
                    {h.examples.length > 1 && (
                      <div className="mt-0.5 truncate text-[12px] text-zinc-400">也有人问：{h.examples.slice(1).join(" / ")}</div>
                    )}
                  </div>
                  {h.refused > 0 && <Badge tone="amber">{h.refused} 次拒答</Badge>}
                  <span className="w-12 shrink-0 text-right text-zinc-600 tabular-nums">{h.count} 次</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </PageContainer>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: React.ReactNode; sub?: string; warn?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-[12.5px] text-zinc-500">{label}</div>
      <div className={clsx("mt-2 text-[26px] leading-none font-semibold tracking-tight tabular-nums", warn ? "text-amber-700" : "text-zinc-900")}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[11.5px] text-zinc-400">{sub}</div>}
    </Card>
  );
}

function GapsSection({ kbId, problemCount }: { kbId: number | null; problemCount: number }) {
  const key = `gaps-${kbId ?? "all"}`;
  // 生成报告需要调用 LLM（约 3 秒），首次进入页面时自动生成，之后按数据版本缓存
  const { data, isLoading, error } = useSWR(problemCount ? key : null, () => api.knowledgeGaps(kbId), {
    revalidateOnFocus: false,
  });
  const [copied, setCopied] = useState(false);
  const gaps = (data?.gaps ?? []).filter((g) => !g.out_of_scope);
  const outside = (data?.gaps ?? []).filter((g) => g.out_of_scope);

  async function copyReport() {
    const { markdown } = await api.exportGaps(kbId);
    await navigator.clipboard?.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-zinc-900">
            <Lightbulb size={16} className="text-amber-500" /> 知识缺口报告
          </h2>
          <div className="mt-0.5 text-[12.5px] text-zinc-500">
            {problemCount} 次提问被拒答或被点踩
            {data?.generated_by && (
              <>
                ，由 <span className="font-mono">{data.generated_by}</span> 归纳为 {gaps.length} 个知识缺口
                {outside.length > 0 && `、${outside.length} 类范围外问题`}
              </>
            )}
          </div>
        </div>
        {gaps.length > 0 && (
          <Button size="sm" onClick={copyReport}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "已复制 Markdown" : "复制报告发给负责人"}
          </Button>
        )}
      </div>

      {problemCount === 0 ? (
        <Card className="p-6 text-center text-[13px] text-zinc-500">近 30 天没有被拒答或被点踩的提问 🎉</Card>
      ) : isLoading ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-[13px] text-zinc-500">
          <Sparkles size={14} className="animate-pulse text-brand-500" /> 正在归纳问题主题、生成补充建议…
        </Card>
      ) : error ? (
        <Card className="p-6 text-center text-[13px] text-rose-600">{(error as Error).message}</Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {gaps.map((g, i) => (
              <GapCard key={i} g={g} rank={i + 1} />
            ))}
          </div>
          {outside.length > 0 && (
            <div className="mt-3 rounded-xl border border-dashed border-zinc-200 px-4 py-3 text-[12.5px] text-zinc-500">
              <span className="font-medium text-zinc-600">范围外的问题（拒答是正确的，无需补充文档）：</span>
              {outside.map((g) => `${g.topic}（${g.questions[0]}）`).join("；")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GapCard({ g, rank }: { g: KnowledgeGap; rank: number }) {
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 font-mono text-[12px] text-zinc-400">{rank}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-zinc-900">{g.topic}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone="zinc">{g.count} 次提问</Badge>
            {g.refused > 0 && <Badge tone="amber">{g.refused} 次拒答</Badge>}
            {g.downvoted > 0 && <Badge tone="red">{g.downvoted} 次差评</Badge>}
            {g.owner && <Badge tone="violet">{g.owner}</Badge>}
          </div>
        </div>
      </div>
      {g.suggestion && (
        <div className="mt-3 rounded-lg bg-amber-50/70 px-3 py-2 text-[12.5px] leading-relaxed text-amber-900">
          <span className="font-medium">建议补充：</span>
          {g.suggestion}
        </div>
      )}
      <ul className="mt-3 space-y-1 text-[12.5px] text-zinc-600">
        {g.questions.slice(0, 3).map((q, i) => (
          <li key={i} className="truncate">
            · {q}
          </li>
        ))}
      </ul>
      {g.reasons.length > 0 && <div className="mt-2 text-[11.5px] text-rose-500">差评原因：{g.reasons.join("、")}</div>}
      <div className="mt-auto flex items-center justify-between pt-3 text-[11.5px] text-zinc-400">
        <span>最近一次：{timeAgo(g.last_at)}</span>
        {g.query_ids[0] && (
          <Link href={`/retrievals/${g.query_ids[0]}`} className="text-brand-600 hover:underline">
            查看检索详情
          </Link>
        )}
      </div>
    </Card>
  );
}

/** 单序列柱状图：圆角柱顶、柱间 2px 间隔、弱化的坐标轴；悬停显示当天提问数和拒答数 */
function TrendBars({ trend }: { trend: Insights["trend"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...trend.map((t) => t.total));
  const h = 140;
  return (
    <div>
      <div className="relative flex items-end gap-[2px] border-b border-zinc-200" style={{ height: h }}>
        {trend.map((t, i) => (
          <div
            key={t.date}
            className="relative flex h-full flex-1 cursor-default items-end justify-center"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className={clsx("w-full max-w-[22px] rounded-t-[4px] transition-colors", hover === i ? "bg-brand-600" : "bg-brand-500")}
              style={{ height: t.total ? Math.max(3, (t.total / max) * (h - 18)) : 0 }}
            />
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[11.5px] whitespace-nowrap shadow-md">
                <div className="font-medium text-zinc-800">{t.date}</div>
                <div className="text-zinc-600">提问 {t.total} 次</div>
                <div className="text-zinc-600">拒答 {t.refused} 次</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-zinc-400 tabular-nums">
        <span>{trend[0]?.date}</span>
        <span>{trend[trend.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function DocUsage({ docs }: { docs: Insights["doc_usage"] }) {
  const max = Math.max(1, ...docs.map((d) => d.citations));
  // 「全部知识库」视角下同名文档可能出现在多个知识库，补上知识库名区分
  const dup = new Set(docs.map((d) => d.filename).filter((n, i, a) => a.indexOf(n) !== i));
  return (
    <div className="space-y-2">
      {docs.slice(0, 10).map((d) => (
        <div key={d.document_id} className="flex items-center gap-3 text-[12.5px]">
          <div className="flex w-52 shrink-0 items-center gap-1.5 truncate text-zinc-700" title={`${d.filename} · ${d.kb_name}`}>
            <FileText size={12} className="shrink-0 text-zinc-400" />
            <span className="truncate">{d.filename}</span>
            {dup.has(d.filename) && <span className="shrink-0 text-[11px] text-zinc-400">{d.kb_name.replace("知识库", "")}</span>}
          </div>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
            {d.citations > 0 && <div className="h-full rounded-full bg-brand-500" style={{ width: `${(d.citations / max) * 100}%` }} />}
          </div>
          <span className={clsx("w-16 shrink-0 text-right tabular-nums", d.citations ? "text-zinc-600" : "text-amber-700")}>
            {d.citations ? `${d.citations} 次` : "从未引用"}
          </span>
        </div>
      ))}
    </div>
  );
}
