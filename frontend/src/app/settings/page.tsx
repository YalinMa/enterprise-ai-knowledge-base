"use client";

import { useState } from "react";
import useSWR from "swr";
import { BrainCircuit, Binary, ListOrdered, CheckCircle2, Database, PlugZap, SlidersHorizontal, XCircle } from "lucide-react";
import { api, API_BASE, fetcher, type SystemConfig } from "@/lib/api";
import { Badge, Button, Card, ErrorBanner, PageContainer, PageHeader, Spinner } from "@/components/ui";

type TestResult = Awaited<ReturnType<typeof api.testSystem>>;

export default function SettingsPage() {
  const { data: cfg, error } = useSWR<SystemConfig>("/api/system/config", fetcher);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testSystem());
    } finally {
      setTesting(false);
    }
  }

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="设置"
        description={
          <>
            模型与 RAG 参数由后端 <code className="rounded bg-zinc-100 px-1 font-mono text-[12px]">backend/.env</code> 配置，修改后重启后端生效。
          </>
        }
        actions={
          <Button onClick={test} loading={testing}>
            <PlugZap size={15} /> 连通性测试
          </Button>
        }
      />
      {error && <ErrorBanner message={error.message} />}
      {!cfg ? (
        !error && (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        )
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <ProviderCard
              icon={BrainCircuit}
              title="LLM"
              envKey="LLM_PROVIDER"
              provider={cfg.providers.llm.provider}
              model={cfg.providers.llm.model}
              mock={cfg.providers.llm.is_mock}
              test={result?.llm && { ok: result.llm.ok, text: result.llm.ok ? `回复：${result.llm.reply}` : result.llm.error! }}
            />
            <ProviderCard
              icon={Binary}
              title="Embedding"
              envKey="EMBEDDING_PROVIDER"
              provider={cfg.providers.embedding.provider}
              model={cfg.providers.embedding.model}
              mock={cfg.providers.embedding.is_mock}
              test={
                result?.embedding && {
                  ok: result.embedding.ok,
                  text: result.embedding.ok ? `向量维度：${result.embedding.dim}` : result.embedding.error!,
                }
              }
            />
            <ProviderCard
              icon={ListOrdered}
              title="Rerank"
              envKey="RERANK_PROVIDER"
              provider={cfg.providers.rerank.provider}
              model={cfg.providers.rerank.model ?? "—"}
              mock={false}
              disabled={!cfg.providers.rerank.enabled}
            />
          </div>

          <Card className="p-5">
            <div className="mb-4 flex items-center gap-1.5 text-[13.5px] font-semibold">
              <SlidersHorizontal size={14} /> RAG 参数
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-[13px] md:grid-cols-3">
              <Item k="Chunk Size" v={`${cfg.rag.chunk_size} 字符`} env="CHUNK_SIZE" />
              <Item k="Chunk Overlap" v={`${cfg.rag.chunk_overlap} 字符`} env="CHUNK_OVERLAP" />
              <Item k="Top-K" v={cfg.rag.top_k} env="TOP_K" />
              <Item k="检索方式" v={cfg.rag.retrieval_mode === "hybrid" ? "混合（向量 + BM25 · RRF）" : "向量"} env="RETRIEVAL_MODE" />
              <Item k="候选数 / RRF k" v={`${cfg.rag.candidate_k} / ${cfg.rag.rrf_k}`} env="CANDIDATE_K" />
              <Item k="追问改写" v={cfg.rag.query_rewrite ? "开启" : "关闭"} env="QUERY_REWRITE" />
              <Item k="相似度阈值（未重排）" v={cfg.rag.min_score} env="MIN_SCORE" />
              <Item
                k="重排阈值"
                v={`Rerank ≥ ${cfg.rag.rerank_min_score} 或 相似度 ≥ ${cfg.rag.rerank_keep_similarity}`}
                env="RERANK_MIN_SCORE"
              />
              <Item k="历史轮数" v={cfg.rag.history_turns} env="HISTORY_TURNS" />
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center gap-1.5 text-[13.5px] font-semibold">
              <Database size={14} /> 存储与格式
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-[13px] md:grid-cols-3">
              <Item k="向量数据库" v={cfg.rag.vector_db} />
              <Item k="关键词索引" v={cfg.rag.keyword_index} />
              <Item k="元数据库" v={cfg.rag.metadata_db} />
              <Item k="后端地址" v={API_BASE} />
              <Item k="支持格式" v={cfg.supported_types.join(" / ")} />
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-3 text-[13.5px] font-semibold">System Prompt</div>
            <pre className="rounded-lg bg-zinc-50 p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-zinc-700">
              {cfg.system_prompt}
            </pre>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}

function ProviderCard({
  icon: Icon,
  title,
  envKey,
  provider,
  model,
  mock,
  disabled,
  test,
}: {
  icon: typeof Database;
  title: string;
  envKey: string;
  provider: string;
  model: string;
  mock: boolean;
  disabled?: boolean;
  test?: { ok: boolean; text: string };
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[13.5px] font-semibold">
          <Icon size={15} /> {title}
        </div>
        {disabled ? <Badge>未开启</Badge> : mock ? <Badge tone="amber">Mock 模式</Badge> : <Badge tone="green">已配置</Badge>}
      </div>
      <div className="space-y-2.5 text-[13px]">
        <Item k="Provider" v={provider} env={envKey} />
        <Item k="Model" v={model} />
      </div>
      {test && (
        <div className={`mt-4 flex items-start gap-1.5 rounded-lg px-3 py-2 text-[12.5px] ${test.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {test.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
          <span className="break-all">{test.text}</span>
        </div>
      )}
    </Card>
  );
}

function Item({ k, v, env }: { k: string; v: React.ReactNode; env?: string }) {
  return (
    <div>
      <div className="text-[11.5px] text-zinc-400">
        {k}
        {env && <span className="ml-1.5 font-mono text-[10.5px] text-zinc-300">{env}</span>}
      </div>
      <div className="mt-0.5 font-medium break-all text-zinc-800">{v}</div>
    </div>
  );
}
