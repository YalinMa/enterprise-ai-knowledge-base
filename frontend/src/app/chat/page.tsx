"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import clsx from "clsx";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  Database,
  FileText,
  Loader2,
  MessageSquarePlus,
  ScanSearch,
  Sparkles,
  Square,
  TriangleAlert,
} from "lucide-react";
import {
  fetcher,
  streamChat,
  type Citation,
  type DocumentItem,
  type KnowledgeBase,
  type QueryStatus,
  type RetrievedChunk,
  type Timings,
} from "@/lib/api";
import { formatMs, locationLabel } from "@/lib/format";
import { AnswerMarkdown } from "@/components/AnswerMarkdown";
import { SourceDrawer, type SourceRef } from "@/components/SourceDrawer";
import { Button, EmptyState, KBIcon, Spinner } from "@/components/ui";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  phase?: "retrieving" | "generating" | "done" | "error";
  retrieved?: RetrievedChunk[];
  usedCount?: number;
  citations?: Citation[];
  queryId?: number;
  status?: QueryStatus;
  timings?: Timings;
  error?: string;
  warning?: string | null;
}

const STORAGE_KEY = "kb-chat-v1";
const DEMO_QUESTIONS = [
  "员工出差住宿最多可以报销多少钱？",
  "商品退款需要满足什么条件？",
  "经销商提现规则是什么？",
  "员工请婚假可以休几天？",
];

function loadConversations(): Record<number, Message[]> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <Chat />
    </Suspense>
  );
}

function Chat() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: kbs } = useSWR<KnowledgeBase[]>("/api/knowledge-bases", fetcher);
  const [convs, setConvs] = useState<Record<number, Message[]>>({});
  const [hydrated, setHydrated] = useState(false);
  const [source, setSource] = useState<SourceRef | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const kbId = useMemo(() => {
    const fromUrl = Number(params.get("kb"));
    if (fromUrl && kbs?.some((k) => k.id === fromUrl)) return fromUrl;
    return kbs?.find((k) => k.chunk_count > 0)?.id ?? kbs?.[0]?.id ?? null;
  }, [params, kbs]);
  const kb = kbs?.find((k) => k.id === kbId);
  const messages = useMemo(() => (kbId ? convs[kbId] ?? [] : []), [convs, kbId]);
  const busy = messages.some((m) => m.phase === "retrieving" || m.phase === "generating");

  useEffect(() => {
    setConvs(loadConversations());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(convs));
    } catch {}
  }, [convs, hydrated]);

  const update = useCallback((kid: number, mid: string, patch: (m: Message) => Partial<Message>) => {
    setConvs((c) => ({ ...c, [kid]: (c[kid] ?? []).map((m) => (m.id === mid ? { ...m, ...patch(m) } : m)) }));
  }, []);

  async function send(question: string) {
    if (!kbId || !question.trim() || busy) return;
    const history = messages
      .filter((m) => m.phase === undefined || m.phase === "done")
      .map((m) => ({ role: m.role, content: m.content }));
    const uid = crypto.randomUUID();
    const aid = crypto.randomUUID();
    setConvs((c) => ({
      ...c,
      [kbId]: [
        ...(c[kbId] ?? []),
        { id: uid, role: "user", content: question.trim() },
        { id: aid, role: "assistant", content: "", phase: "retrieving" },
      ],
    }));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamChat(
        { kb_id: kbId, question: question.trim(), history },
        (ev) => {
          if (ev.type === "retrieval")
            update(kbId, aid, () => ({
              phase: "generating",
              retrieved: ev.chunks,
              usedCount: ev.used_count,
              queryId: ev.query_id,
              warning: ev.warning,
            }));
          else if (ev.type === "token") update(kbId, aid, (m) => ({ content: m.content + ev.text }));
          else if (ev.type === "done")
            update(kbId, aid, () => ({
              phase: "done",
              content: ev.answer,
              citations: ev.citations,
              status: ev.status,
              timings: ev.timings,
              queryId: ev.query_id,
            }));
          else if (ev.type === "error")
            update(kbId, aid, () => ({ phase: "error", error: ev.message, queryId: ev.query_id }));
        },
        ctrl.signal,
      );
      update(kbId, aid, (m) => (m.phase === "done" || m.phase === "error" ? {} : { phase: "done" }));
    } catch (e) {
      update(kbId, aid, () => ({ phase: "error", error: (e as Error).message }));
    } finally {
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    if (kbId)
      setConvs((c) => ({
        ...c,
        [kbId]: (c[kbId] ?? []).map((m) =>
          m.phase === "retrieving" || m.phase === "generating" ? { ...m, phase: "done", content: m.content || "（已停止）" } : m,
        ),
      }));
  }

  return (
    <div className="flex h-full">
      {/* 知识库选择 */}
      <div className="hidden w-[248px] shrink-0 flex-col border-r border-zinc-200/80 bg-zinc-50/50 md:flex">
        <div className="px-4 pt-5 pb-3">
          <div className="text-[13px] font-semibold text-zinc-800">选择知识库</div>
          <div className="mt-0.5 text-[11.5px] text-zinc-400">AI 只会基于所选知识库回答</div>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2.5">
          {!kbs ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            kbs.map((k) => (
              <button
                key={k.id}
                onClick={() => router.replace(`/chat?kb=${k.id}`)}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                  k.id === kbId ? "bg-white shadow-sm ring-1 ring-zinc-200" : "hover:bg-white/70",
                )}
              >
                <KBIcon icon={k.icon} size={28} />
                <div className="min-w-0 flex-1">
                  <div className={clsx("truncate text-[13px]", k.id === kbId ? "font-semibold text-zinc-900" : "text-zinc-700")}>
                    {k.name}
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    {k.document_count} 文档 · {k.chunk_count} 切片
                  </div>
                </div>
                {(convs[k.id]?.length ?? 0) > 0 && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />}
              </button>
            ))
          )}
        </div>
        <Link href="/" className="m-3 flex items-center justify-center gap-1 rounded-lg py-2 text-[12.5px] text-zinc-500 hover:bg-white hover:text-zinc-800">
          <Database size={13} /> 管理知识库
        </Link>
      </div>

      {/* 聊天窗口 */}
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-100 px-6">
          <div className="flex min-w-0 items-center gap-2 text-[14px]">
            <span className="text-zinc-400">AI 问答</span>
            <ChevronRight size={14} className="text-zinc-300" />
            <span className="truncate font-semibold text-zinc-900">{kb?.name ?? "—"}</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={!messages.length || busy}
            onClick={() => kbId && setConvs((c) => ({ ...c, [kbId]: [] }))}
          >
            <MessageSquarePlus size={14} /> 新对话
          </Button>
        </div>

        <MessageList
          kb={kb}
          kbsLoaded={!!kbs}
          messages={messages}
          onAsk={send}
          onCite={(m, n) => {
            const c = m.citations?.find((x) => x.index === n);
            if (c) setSource(c);
          }}
          onSource={setSource}
        />

        <Composer disabled={!kb || kb.chunk_count === 0} busy={busy} onSend={send} onStop={stop} kbName={kb?.name} />
      </div>

      <SourceDrawer source={source} onClose={() => setSource(null)} />
    </div>
  );
}

function MessageList({
  kb,
  kbsLoaded,
  messages,
  onAsk,
  onCite,
  onSource,
}: {
  kb?: KnowledgeBase;
  kbsLoaded: boolean;
  messages: Message[];
  onAsk: (q: string) => void;
  onCite: (m: Message, n: number) => void;
  onSource: (s: SourceRef) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1];
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, last?.content.length, last?.phase]);

  if (kbsLoaded && !kb)
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={Database}
          title="还没有知识库"
          description="先创建知识库并上传资料，再回来提问。"
          action={
            <Link href="/">
              <Button variant="primary">去创建知识库</Button>
            </Link>
          }
        />
      </div>
    );

  if (!messages.length) return <Welcome kb={kb} onAsk={onAsk} />;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-7 px-6 py-8">
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="animate-fade-up flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-md bg-zinc-100 px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap text-zinc-900">
                {m.content}
              </div>
            </div>
          ) : (
            <AssistantMessage key={m.id} m={m} onCite={(n) => onCite(m, n)} onSource={onSource} />
          ),
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function Welcome({ kb, onAsk }: { kb?: KnowledgeBase; onAsk: (q: string) => void }) {
  const { data: docs } = useSWR<DocumentItem[]>(kb ? `/api/knowledge-bases/${kb.id}/documents` : null, fetcher);
  const isDemo = kb?.name.includes("Demo") || docs?.some((d) => d.filename.startsWith("员工报销制度"));
  const suggestions = isDemo
    ? DEMO_QUESTIONS
    : (docs ?? [])
        .filter((d) => d.status === "ready")
        .slice(0, 4)
        .map((d) => `《${d.filename.replace(/\.[^.]+$/, "")}》主要规定了哪些内容？`);

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-10">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-lg shadow-brand-500/25">
        <Sparkles size={22} />
      </div>
      <h2 className="text-[20px] font-semibold tracking-tight text-zinc-900">有什么可以帮你？</h2>
      <p className="mt-1.5 max-w-md text-center text-[13.5px] text-zinc-500">
        {kb && kb.chunk_count === 0
          ? "该知识库还没有可检索的内容，请先上传文档。"
          : `我会在「${kb?.name ?? ""}」中检索相关资料，基于原文回答，并标注每条信息的出处。`}
      </p>
      {suggestions.length > 0 && kb && kb.chunk_count > 0 && (
        <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
          {suggestions.map((q) => (
            <button
              key={q}
              onClick={() => onAsk(q)}
              className="group flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-[13.5px] text-zinc-700 transition-all hover:border-brand-200 hover:bg-brand-50/40 hover:text-zinc-900"
            >
              <span>{q}</span>
              <ArrowUp size={14} className="shrink-0 rotate-45 text-zinc-300 group-hover:text-brand-500" />
            </button>
          ))}
        </div>
      )}
      {kb && kb.chunk_count === 0 && (
        <Link href={`/kb/${kb.id}`} className="mt-5">
          <Button variant="primary">去上传文档</Button>
        </Link>
      )}
    </div>
  );
}

function PipelineSteps({ m }: { m: Message }) {
  const total = m.retrieved?.length ?? 0;
  const steps = [
    {
      label: m.phase === "retrieving" ? "正在检索知识库" : `召回 ${total} 个片段${m.usedCount !== undefined && m.usedCount < total ? `，${m.usedCount} 个高于阈值` : ""}`,
      state: m.phase === "retrieving" ? "active" : m.retrieved ? "done" : m.phase === "error" ? "error" : "idle",
    },
    {
      label:
        m.phase === "generating"
          ? "正在生成回答"
          : m.status === "no_context"
            ? "无相关资料，跳过生成"
            : m.phase === "done"
              ? `生成完成 · ${formatMs(m.timings?.total_ms)}`
              : "生成回答",
      state: m.phase === "generating" ? "active" : m.phase === "done" ? "done" : m.phase === "error" ? "error" : "idle",
    },
  ];
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-1.5 text-[12px]">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={12} className="text-zinc-300" />}
          <span
            className={clsx(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
              s.state === "active" && "bg-brand-50 text-brand-700",
              s.state === "done" && "bg-zinc-100 text-zinc-500",
              s.state === "error" && "bg-rose-50 text-rose-600",
              s.state === "idle" && "text-zinc-300",
            )}
          >
            {s.state === "active" ? (
              <Loader2 size={11} className="animate-spin" />
            ) : s.state === "done" ? (
              <Check size={11} />
            ) : i === 0 ? (
              <ScanSearch size={11} />
            ) : (
              <Sparkles size={11} />
            )}
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function AssistantMessage({ m, onCite, onSource }: { m: Message; onCite: (n: number) => void; onSource: (s: SourceRef) => void }) {
  const [copied, setCopied] = useState(false);
  const done = m.phase === "done";
  const valid = done ? new Set(m.citations?.map((c) => c.index)) : undefined;

  return (
    <div className="animate-fade-up flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white">
        <Sparkles size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <PipelineSteps m={m} />

        {m.warning && (
          <div className="mb-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-700">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {m.warning}
          </div>
        )}

        {m.content && <AnswerMarkdown content={m.content} streaming={m.phase === "generating"} validIndexes={valid} onCite={onCite} />}
        {m.phase === "error" && (
          <div className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {m.error}
          </div>
        )}

        {done && m.citations && m.citations.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[12px] font-medium text-zinc-400">引用来源 · {m.citations.length}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {m.citations.map((c) => (
                <button
                  key={c.chunk_id}
                  onClick={() => onSource(c)}
                  className="group flex items-start gap-2.5 rounded-xl border border-zinc-200/80 bg-zinc-50/50 px-3 py-2.5 text-left transition-all hover:border-brand-200 hover:bg-brand-50/40"
                >
                  <span className="mt-[1px] flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-white font-mono text-[10.5px] font-semibold text-brand-700 ring-1 ring-brand-200">
                    {c.index}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 truncate text-[12.5px] font-medium text-zinc-800">
                      <FileText size={12} className="shrink-0 text-zinc-400" />
                      <span className="truncate">《{c.document_name}》</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11.5px] text-zinc-500">
                      {locationLabel(c.page, c.section) || "全文"} · 相似度 {c.score.toFixed(2)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {(done || m.phase === "error") && m.queryId && (
          <div className="mt-3 flex items-center gap-1 text-[12px] text-zinc-400">
            <Link
              href={`/retrievals/${m.queryId}`}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <ScanSearch size={13} /> 查看检索详情
            </Link>
            {done && (
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(m.content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-zinc-100 hover:text-zinc-700"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "已复制" : "复制"}
              </button>
            )}
            {m.timings?.total_ms !== undefined && (
              <span className="ml-auto tabular-nums">
                检索 {formatMs((m.timings.embed_ms ?? 0) + (m.timings.search_ms ?? 0))} · 首字 {formatMs(m.timings.first_token_ms)} · 总计{" "}
                {formatMs(m.timings.total_ms)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Composer({
  disabled,
  busy,
  onSend,
  onStop,
  kbName,
}: {
  disabled: boolean;
  busy: boolean;
  onSend: (q: string) => void;
  onStop: () => void;
  kbName?: string;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  function submit() {
    if (!text.trim() || busy || disabled) return;
    onSend(text);
    setText("");
  }

  return (
    <div className="shrink-0 px-6 pt-2 pb-5">
      <div className="mx-auto max-w-3xl">
        <div
          className={clsx(
            "flex items-end gap-2 rounded-2xl border bg-white p-2 pl-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-colors",
            "border-zinc-200 focus-within:border-zinc-300 focus-within:shadow-[0_2px_16px_rgba(0,0,0,0.07)]",
          )}
        >
          <textarea
            ref={ref}
            rows={1}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={disabled ? "请先选择有内容的知识库" : `向「${kbName ?? "知识库"}」提问，Enter 发送，Shift + Enter 换行`}
            className="max-h-[180px] flex-1 resize-none bg-transparent py-1.5 text-[14.5px] leading-6 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed"
          />
          {busy ? (
            <button
              onClick={onStop}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white hover:bg-zinc-700"
              title="停止生成"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim() || disabled}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white transition-opacity hover:bg-zinc-700 disabled:opacity-20"
              title="发送"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        <div className="mt-2 text-center text-[11.5px] text-zinc-400">回答仅基于知识库资料生成，每条结论均可点击角标查看原文出处</div>
      </div>
    </div>
  );
}
