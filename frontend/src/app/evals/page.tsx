"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import clsx from "clsx";
import { FlaskConical, Play, Trash2 } from "lucide-react";
import {
  api,
  fetcher,
  type EvalDataset,
  type EvalMetrics,
  type EvalRun,
  type KnowledgeBase,
  type RetrievalSettings,
  type SystemConfig,
} from "@/lib/api";
import { formatDateTime, formatMs } from "@/lib/format";
import { ConfigBadges } from "@/components/ConfigBadges";
import { Badge, Button, Card, ConfirmModal, EmptyState, Modal, PageContainer, PageHeader, Spinner } from "@/components/ui";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/** 对比表的列：higher 表示越大越好，用于标出每列的最优值 */
const COLUMNS: { key: keyof EvalMetrics; label: string; hint: string; fmt: (v: number) => string; higher: boolean }[] = [
  { key: "pass_rate", label: "通过率", hint: "全部题目中判定通过的比例", fmt: pct, higher: true },
  { key: "hit_rate", label: "Hit@K", hint: "正确文档出现在送入 LLM 的切片中的比例", fmt: pct, higher: true },
  { key: "mrr", label: "MRR", hint: "正确文档首次出现位置的倒数平均", fmt: (v) => v.toFixed(3), higher: true },
  { key: "context_recall", label: "Ctx Recall", hint: "关键事实出现在送入 LLM 的切片中的比例", fmt: pct, higher: true },
  { key: "refusal_accuracy", label: "拒答准确", hint: "该拒答的拒答、不该拒答的作答", fmt: pct, higher: true },
  { key: "false_refusal_rate", label: "误拒率", hint: "能回答的题被拒答的比例", fmt: pct, higher: false },
  { key: "answer_accuracy", label: "答案准确", hint: "（完整模式）答案包含全部关键事实", fmt: pct, higher: true },
  { key: "citation_hit_rate", label: "引用命中", hint: "（完整模式）引用包含正确文档", fmt: pct, higher: true },
  { key: "latency_avg_ms", label: "平均耗时", hint: "单题平均耗时", fmt: (v) => formatMs(v), higher: false },
];

export default function EvalsPage() {
  const router = useRouter();
  const { data: runs, mutate } = useSWR<EvalRun[]>("/api/evals", fetcher, {
    refreshInterval: (d) => (d?.some((r) => r.status === "running") ? 1500 : 0),
    refreshWhenHidden: true,
  });
  const { data: datasets } = useSWR<EvalDataset[]>("/api/evals/datasets", fetcher);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<EvalRun | null>(null);

  const done = (runs ?? []).filter((r) => r.status === "done");
  const best = (key: keyof EvalMetrics, higher: boolean) => {
    const vals = done.map((r) => r.metrics[key]).filter((v): v is number => typeof v === "number");
    if (!vals.length) return null;
    return higher ? Math.max(...vals) : Math.min(...vals);
  };
  const cols = COLUMNS.filter((c) => (runs ?? []).some((r) => r.metrics[c.key] != null));
  const ds = datasets?.[0];

  return (
    <PageContainer>
      <PageHeader
        title="RAG 评测"
        description="用一组带标准答案的问题，量化检索与生成质量；切换检索策略后重跑，对比每项改进带来的提升。"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Play size={14} /> 新建评测
          </Button>
        }
      />

      {ds && (
        <Card className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-zinc-900">
              评测集：{ds.name} <span className="font-normal text-zinc-400">· {ds.count} 题</span>
            </div>
            <div className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">{ds.description}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(ds.categories).map(([k, v]) => (
              <Badge key={k}>
                {k} {v}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        {!runs ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : runs.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            title="还没有评测记录"
            description="新建一次评测，或在后端运行 python scripts/run_eval.py 一次对比 4 组检索策略。"
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Play size={14} /> 新建评测
              </Button>
            }
          />
        ) : (
          <table className="w-full min-w-[960px] text-[13px]">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-[12px] text-zinc-400">
                <th className="py-2.5 pr-3 pl-5 font-medium">#</th>
                <th className="px-3 font-medium">策略</th>
                {cols.map((c) => (
                  <th key={c.key} className="px-3 text-right font-medium whitespace-nowrap" title={c.hint}>
                    {c.label}
                  </th>
                ))}
                <th className="px-3 font-medium">时间</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/evals/${r.id}`)}
                  className="group cursor-pointer border-b border-zinc-50 last:border-0 hover:bg-zinc-50/70"
                >
                  <td className="py-3 pr-3 pl-5 font-mono text-zinc-400">{r.id}</td>
                  <td className="px-3">
                    <ConfigBadges run={r} />
                    <div className="mt-1 text-[11.5px] text-zinc-400">{r.kb_name}</div>
                  </td>
                  {r.status !== "done" ? (
                    <td colSpan={cols.length} className="px-3 text-right text-[12.5px]">
                      {r.status === "running" ? (
                        <span className="inline-flex items-center gap-2 text-sky-600">
                          <Spinner size={13} className="text-sky-500" /> 评测中 {r.progress}/{r.total}
                        </span>
                      ) : (
                        <span className="text-rose-600">失败：{r.error}</span>
                      )}
                    </td>
                  ) : (
                    cols.map((c) => {
                      const v = r.metrics[c.key];
                      const isBest = typeof v === "number" && done.length > 1 && v === best(c.key, c.higher);
                      return (
                        <td
                          key={c.key}
                          className={clsx("px-3 text-right tabular-nums", isBest ? "font-semibold text-emerald-700" : "text-zinc-700")}
                        >
                          {typeof v === "number" ? c.fmt(v) : "—"}
                        </td>
                      );
                    })
                  )}
                  <td className="px-3 whitespace-nowrap text-zinc-500 tabular-nums">{formatDateTime(r.created_at)}</td>
                  <td className="pr-4">
                    <button
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleting(r);
                      }}
                      className="rounded-md p-1.5 text-zinc-300 opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {done.length > 1 && <div className="mt-2 text-[12px] text-zinc-400">绿色加粗为每列最优值 · 鼠标悬停列名查看指标定义</div>}

      <CreateEvalModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(run) => {
          mutate();
          router.push(`/evals/${run.id}`);
        }}
      />
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="删除评测记录"
        message={`确定删除评测 #${deleting?.id}？`}
        confirmText="删除"
        onConfirm={async () => {
          if (!deleting) return;
          await api.deleteEval(deleting.id);
          setDeleting(null);
          mutate();
        }}
      />
    </PageContainer>
  );
}

function CreateEvalModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (r: EvalRun) => void }) {
  const { data: kbs } = useSWR<KnowledgeBase[]>(open ? "/api/knowledge-bases" : null, fetcher);
  const { data: cfg } = useSWR<SystemConfig>("/api/system/config", fetcher);
  const rerankAvailable = cfg?.providers.rerank.enabled ?? false;
  const [pickedKb, setKbId] = useState<number | null>(null);
  // 未手动选择时，默认选名称含 Demo 的知识库
  const kbId = pickedKb ?? (kbs?.find((k) => k.name.includes("Demo")) ?? kbs?.[0])?.id ?? null;
  const [mode, setMode] = useState<"retrieval" | "full">("retrieval");
  const { data: datasets } = useSWR<EvalDataset[]>(open ? "/api/evals/datasets" : null, fetcher);
  const [dataset, setDataset] = useState("demo");
  const [rs, setRs] = useState<RetrievalSettings>({ retrieval_mode: "hybrid", rerank: true, query_rewrite: true });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!kbId) return setErr("请选择知识库");
    setLoading(true);
    setErr("");
    try {
      const run = await api.createEval({ kb_id: kbId, dataset, mode, top_k: 5, ...rs, rerank: rs.rerank && rerankAvailable });
      onClose();
      onCreated(run);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const seg = (active: boolean) =>
    clsx("rounded-md py-1.5 text-[12.5px] transition-colors", active ? "bg-white font-medium text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建评测"
      width={480}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={submit} loading={loading}>
            <Play size={14} /> 开始评测
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-[13px]">
        <label className="block">
          <div className="mb-1.5 font-medium text-zinc-700">知识库</div>
          <select
            value={kbId ?? ""}
            onChange={(e) => setKbId(Number(e.target.value))}
            className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 outline-none focus:border-brand-500"
          >
            {(kbs ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}（{k.document_count} 文档）
              </option>
            ))}
          </select>
          <div className="mt-1 text-[11.5px] text-zinc-400">评测集基于 demo-data 的 7 份文件，请选择包含这些文件的知识库</div>
        </label>
        {datasets && datasets.length > 1 && (
          <label className="block">
            <div className="mb-1.5 font-medium text-zinc-700">评测集</div>
            <select
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
              className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 outline-none focus:border-brand-500"
            >
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}（{d.count} 题）
                </option>
              ))}
            </select>
          </label>
        )}
        <div>
          <div className="mb-1.5 font-medium text-zinc-700">评测模式</div>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-0.5">
            <button className={seg(mode === "retrieval")} onClick={() => setMode("retrieval")}>
              仅检索 · 约 15 秒
            </button>
            <button className={seg(mode === "full")} onClick={() => setMode("full")}>
              完整问答 · 约 2 分钟
            </button>
          </div>
        </div>
        <div>
          <div className="mb-1.5 font-medium text-zinc-700">检索方式</div>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-0.5">
            <button className={seg(rs.retrieval_mode === "hybrid")} onClick={() => setRs({ ...rs, retrieval_mode: "hybrid" })}>
              混合（向量 + BM25）
            </button>
            <button className={seg(rs.retrieval_mode === "vector")} onClick={() => setRs({ ...rs, retrieval_mode: "vector" })}>
              仅向量
            </button>
          </div>
        </div>
        <div className="flex gap-4">
          <label className={clsx("flex items-center gap-2", !rerankAvailable && "opacity-50")}>
            <input
              type="checkbox"
              disabled={!rerankAvailable}
              checked={rs.rerank && rerankAvailable}
              onChange={(e) => setRs({ ...rs, rerank: e.target.checked })}
              className="accent-brand-600"
            />
            Rerank 重排{!rerankAvailable && "（未配置）"}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={rs.query_rewrite}
              onChange={(e) => setRs({ ...rs, query_rewrite: e.target.checked })}
              className="accent-brand-600"
            />
            追问改写
          </label>
        </div>
        {err && <div className="text-[12.5px] text-rose-600">{err}</div>}
      </div>
    </Modal>
  );
}
