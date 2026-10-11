"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import clsx from "clsx";
import { Boxes, Clock, Database, FileStack, Layers, Plus, Sparkles, Wand2 } from "lucide-react";
import { api, fetcher, type KnowledgeBase, type Stats } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import { Button, Card, EmptyState, ErrorBanner, KBIcon, KB_ICONS, Modal, PageContainer, PageHeader } from "@/components/ui";

export default function HomePage() {
  const router = useRouter();
  const { data: stats, mutate: mutateStats } = useSWR<Stats>("/api/stats", fetcher, { refreshInterval: 4000 });
  const { data: kbs, error, mutate } = useSWR<KnowledgeBase[]>("/api/knowledge-bases", fetcher, {
    refreshInterval: 4000,
  });
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const hasDemo = kbs?.some((k) => k.name === "Demo 企业知识库");

  async function seed() {
    setSeeding(true);
    try {
      const r = await api.seedDemo();
      await Promise.all([mutate(), mutateStats()]);
      router.push(`/kb/${r.kb_id}`);
    } finally {
      setSeeding(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="企业知识库"
        description="把散落在各处的制度、手册、FAQ 汇集成可检索的知识库，员工直接提问，AI 给出带出处的答案。"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> 新建知识库
          </Button>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Boxes} label="知识库" value={stats?.kb_count} />
        <StatCard icon={FileStack} label="文档" value={stats?.document_count} />
        <StatCard icon={Layers} label="Chunk 切片" value={stats?.chunk_count} />
        <StatCard
          icon={Clock}
          label="最近更新"
          value={stats ? timeAgo(stats.last_updated) : undefined}
          hint={stats?.last_updated ? formatDateTime(stats.last_updated) : undefined}
        />
      </div>

      {error && <ErrorBanner message={error.message} />}

      {kbs && !hasDemo && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50 to-violet-50/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-brand-600 shadow-sm">
              <Wand2 size={17} />
            </div>
            <div>
              <div className="text-[14px] font-medium text-zinc-900">一键导入示例资料</div>
              <div className="text-[12.5px] text-zinc-500">
                创建「Demo 企业知识库」，导入报销、请假、退款、经销商等 7 份虚构企业制度（MD / PDF / DOCX / TXT）
              </div>
            </div>
          </div>
          <Button variant="primary" onClick={seed} loading={seeding}>
            <Sparkles size={14} /> 导入 Demo 数据
          </Button>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-zinc-800">全部知识库</h2>
        {kbs && <span className="text-[12.5px] text-zinc-400">{kbs.length} 个</span>}
      </div>

      {kbs && kbs.length === 0 ? (
        <Card>
          <EmptyState
            icon={Database}
            title="还没有知识库"
            description="新建一个知识库并上传 PDF、Word、Markdown 或 TXT 文件，或者先导入 Demo 数据体验完整流程。"
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={15} /> 新建知识库
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(kbs ?? []).map((kb) => (
            <Link key={kb.id} href={`/kb/${kb.id}`} className="group">
              <Card className="flex h-full flex-col p-5 transition-all group-hover:-translate-y-0.5 group-hover:border-zinc-300 group-hover:shadow-md">
                <div className="flex items-start gap-3">
                  <KBIcon icon={kb.icon} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-zinc-900">{kb.name}</div>
                    <div className="mt-0.5 line-clamp-2 min-h-[38px] text-[12.5px] leading-[19px] text-zinc-500">
                      {kb.description || "暂无描述"}
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex items-center gap-4 border-t border-zinc-100 pt-3.5 text-[12.5px] text-zinc-500">
                  <span>
                    <b className="font-semibold text-zinc-800">{kb.document_count}</b> 文档
                  </span>
                  <span>
                    <b className="font-semibold text-zinc-800">{kb.chunk_count}</b> 切片
                  </span>
                  <span className="ml-auto text-zinc-400">{timeAgo(kb.updated_at)}更新</span>
                </div>
              </Card>
            </Link>
          ))}
          {kbs && (
            <button
              onClick={() => setCreating(true)}
              className="flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 text-[13px] text-zinc-500 transition-colors hover:border-brand-500 hover:bg-white hover:text-brand-600"
            >
              <Plus size={18} />
              新建知识库
            </button>
          )}
        </div>
      )}

      <CreateKBModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(kb) => {
          mutate();
          mutateStats();
          router.push(`/kb/${kb.id}`);
        }}
      />
    </PageContainer>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Boxes;
  label: string;
  value: number | string | undefined;
  hint?: string;
}) {
  return (
    <Card className="p-4" >
      <div className="flex items-center gap-2 text-[12.5px] text-zinc-500" title={hint}>
        <Icon size={14} className="text-zinc-400" />
        {label}
      </div>
      <div className="mt-2 text-[26px] leading-none font-semibold tracking-tight text-zinc-900 tabular-nums">
        {value ?? <span className="inline-block h-6 w-12 animate-pulse rounded bg-zinc-100" />}
      </div>
    </Card>
  );
}

function CreateKBModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (kb: KnowledgeBase) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("book");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!name.trim()) return setErr("请填写知识库名称");
    setLoading(true);
    setErr("");
    try {
      const kb = await api.createKB({ name, description, icon });
      setName("");
      setDescription("");
      setIcon("book");
      onClose();
      onCreated(kb);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建知识库"
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={submit} loading={loading}>
            创建
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <div className="mb-1.5 text-[13px] font-medium text-zinc-700">名称</div>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && submit()}
            placeholder="例如：Demo 企业知识库"
            className="h-9 w-full rounded-lg border border-zinc-200 px-3 text-[13.5px] outline-none focus:border-brand-500 focus:ring-3 focus:ring-brand-100"
          />
        </label>
        <label className="block">
          <div className="mb-1.5 text-[13px] font-medium text-zinc-700">描述</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="这个知识库包含哪些资料、给谁用"
            className="w-full resize-none rounded-lg border border-zinc-200 px-3 py-2 text-[13.5px] outline-none focus:border-brand-500 focus:ring-3 focus:ring-brand-100"
          />
        </label>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-zinc-700">图标</div>
          <div className="flex flex-wrap gap-2">
            {Object.keys(KB_ICONS).map((k) => (
              <button
                key={k}
                onClick={() => setIcon(k)}
                className={clsx(
                  "rounded-xl p-1 ring-2 transition-all",
                  icon === k ? "ring-brand-500" : "ring-transparent hover:ring-zinc-200",
                )}
              >
                <KBIcon icon={k} size={32} />
              </button>
            ))}
          </div>
        </div>
        {err && <div className="text-[12.5px] text-rose-600">{err}</div>}
      </div>
    </Modal>
  );
}
