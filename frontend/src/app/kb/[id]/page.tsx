"use client";

import { useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import clsx from "clsx";
import {
  Archive,
  ArrowLeft,
  ExternalLink,
  FileUp,
  Layers,
  MessageSquareText,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { api, fetcher, fileUrl, type ChunkItem, type DocumentItem, type KnowledgeBase } from "@/lib/api";
import { formatBytes, formatDateTime, locationLabel } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  DocStatusBadge,
  Drawer,
  EmptyState,
  ErrorBanner,
  FileTypeIcon,
  KBIcon,
  PageContainer,
  PageHeader,
  Spinner,
} from "@/components/ui";

const ACCEPT = ".pdf,.docx,.md,.markdown,.txt";
const BUSY = new Set(["pending", "parsing", "embedding"]);

export default function KBDetailPage() {
  const { id } = useParams<{ id: string }>();
  const kbId = Number(id);
  const router = useRouter();

  const { data: kb, error: kbError, mutate: mutateKB } = useSWR<KnowledgeBase>(`/api/knowledge-bases/${kbId}`, fetcher);
  const { data: docs, mutate: mutateDocs } = useSWR<DocumentItem[]>(`/api/knowledge-bases/${kbId}/documents`, fetcher, {
    // 有文档在解析时每秒轮询，全部完成后停止
    refreshInterval: (d) => (d?.some((x) => BUSY.has(x.status)) ? 1000 : 0),
    refreshWhenHidden: true, // 切到其他标签页时解析状态也继续更新
    onSuccess: () => mutateKB(),
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [chunkDoc, setChunkDoc] = useState<DocumentItem | null>(null);
  const [deleting, setDeleting] = useState<DocumentItem | null>(null);
  const [deletingKB, setDeletingKB] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  async function upload(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setUploadErr("");
    try {
      await api.uploadDocuments(kbId, files);
      await mutateDocs();
    } catch (e) {
      setUploadErr((e as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    upload(Array.from(e.dataTransfer.files));
  }

  if (kbError) {
    return (
      <PageContainer>
        <ErrorBanner message={kbError.message} />
      </PageContainer>
    );
  }

  const processing = docs?.filter((d) => BUSY.has(d.status)).length ?? 0;

  return (
    <PageContainer>
      <Link href="/" className="mb-4 inline-flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-800">
        <ArrowLeft size={14} /> 全部知识库
      </Link>

      <PageHeader
        icon={kb ? <KBIcon icon={kb.icon} size={44} /> : <div className="h-11 w-11 animate-pulse rounded-xl bg-zinc-100" />}
        title={kb?.name ?? "…"}
        description={
          kb && (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{kb.description || "暂无描述"}</span>
              <span className="text-zinc-300">|</span>
              <span>
                {kb.document_count} 个文档 · {kb.chunk_count} 个切片
              </span>
              {kb.embedding_signature && (
                <Badge tone="zinc" className="font-mono">
                  {kb.embedding_signature}
                </Badge>
              )}
            </span>
          )
        }
        actions={
          <>
            <Button onClick={() => inputRef.current?.click()} loading={uploading}>
              <FileUp size={15} /> 上传文件
            </Button>
            <Button variant="primary" onClick={() => router.push(`/chat?kb=${kbId}`)}>
              <MessageSquareText size={15} /> 开始问答
            </Button>
            <KBMenu
              onReparse={async () => {
                setBusyAction(true);
                try {
                  await api.reparseKB(kbId);
                  await mutateDocs();
                } finally {
                  setBusyAction(false);
                }
              }}
              onDelete={() => setDeletingKB(true)}
              busy={busyAction}
            />
          </>
        }
      />

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => upload(Array.from(e.target.files ?? []))}
      />

      {uploadErr && (
        <div className="mb-4">
          <ErrorBanner message={uploadErr} />
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className="relative"
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-500 bg-brand-50/80 text-[14px] font-medium text-brand-700">
            <UploadCloud className="mr-2" size={18} /> 松开即可上传
          </div>
        )}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
            <div className="text-[13.5px] font-semibold text-zinc-800">文档</div>
            {processing > 0 && (
              <div className="flex items-center gap-1.5 text-[12.5px] text-sky-600">
                <Spinner size={13} className="text-sky-500" /> {processing} 个文档处理中：解析 → 切片 → Embedding → 写入向量库
              </div>
            )}
          </div>

          {!docs ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : docs.length === 0 ? (
            <EmptyState
              icon={UploadCloud}
              title="拖拽文件到这里，或点击上传"
              description="支持 PDF、Word（.docx）、Markdown、TXT，可多选。上传后自动解析、切片并生成向量。"
              action={
                <div className="flex items-center gap-2">
                  <Button variant="primary" onClick={() => inputRef.current?.click()} loading={uploading}>
                    <FileUp size={15} /> 选择文件
                  </Button>
                  <Button
                    disabled={uploading}
                    onClick={async () => {
                      setUploading(true);
                      try {
                        const names = await api.demoFiles();
                        const files = await Promise.all(names.map(api.fetchDemoFile));
                        await upload(files);
                      } catch (e) {
                        setUploadErr((e as Error).message);
                        setUploading(false);
                      }
                    }}
                  >
                    <Sparkles size={14} /> 使用示例资料
                  </Button>
                </div>
              }
            />
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-[12px] text-zinc-400">
                  <th className="py-2.5 pr-3 pl-5 font-medium">文件名称</th>
                  <th className="px-3 font-medium">类型</th>
                  <th className="px-3 font-medium">大小</th>
                  <th className="px-3 font-medium">解析状态</th>
                  <th className="px-3 text-right font-medium">Chunk 数</th>
                  <th className="px-3 font-medium">上传时间</th>
                  <th className="pr-5 pl-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="group border-b border-zinc-50 last:border-0 hover:bg-zinc-50/60">
                    <td className="py-3 pr-3 pl-5">
                      <div className="flex items-center gap-3">
                        <FileTypeIcon type={d.file_type} />
                        <div className="min-w-0">
                          <div className="flex max-w-[320px] items-center gap-1.5">
                            <span className={clsx("truncate font-medium", d.lifecycle === "deprecated" ? "text-zinc-400 line-through" : "text-zinc-800")}>
                              {d.filename}
                            </span>
                            {d.lifecycle === "deprecated" && (
                              <span title="已废止的文档默认不参与检索，只在询问历史版本时召回">
                                <Badge tone="amber">已废止</Badge>
                              </span>
                            )}
                          </div>
                          {d.status === "failed" && d.error ? (
                            <div className="max-w-[300px] truncate text-[11.5px] text-rose-500" title={d.error}>
                              {d.error}
                            </div>
                          ) : (
                            <div className="text-[11.5px] text-zinc-400">
                              {d.char_count ? `${d.char_count.toLocaleString()} 字` : "—"}
                              {d.page_count ? ` · ${d.page_count} 页` : ""}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 text-zinc-500 uppercase">{d.file_type}</td>
                    <td className="px-3 text-zinc-500 tabular-nums">{formatBytes(d.file_size)}</td>
                    <td className="px-3">
                      <DocStatusBadge status={d.status} error={d.error} />
                    </td>
                    <td className="px-3 text-right tabular-nums">
                      {d.status === "ready" ? (
                        <button onClick={() => setChunkDoc(d)} className="font-medium text-brand-600 hover:underline">
                          {d.chunk_count}
                        </button>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-3 whitespace-nowrap text-zinc-500 tabular-nums">{formatDateTime(d.created_at)}</td>
                    <td className="pr-5 pl-3">
                      <div className="flex justify-end gap-0.5 opacity-70 group-hover:opacity-100">
                        <IconBtn title="查看切片" disabled={d.status !== "ready"} onClick={() => setChunkDoc(d)}>
                          <Layers size={15} />
                        </IconBtn>
                        <IconBtn
                          title="重新解析"
                          disabled={BUSY.has(d.status)}
                          onClick={async () => {
                            await api.reparseDocument(d.id);
                            mutateDocs();
                          }}
                        >
                          <RefreshCw size={15} />
                        </IconBtn>
                        <IconBtn
                          title={d.lifecycle === "deprecated" ? "恢复为生效" : "标记为已废止"}
                          disabled={d.status !== "ready"}
                          onClick={async () => {
                            await api.setLifecycle(d.id, d.lifecycle === "deprecated" ? "active" : "deprecated");
                            mutateDocs();
                          }}
                        >
                          <Archive size={15} />
                        </IconBtn>
                        <IconBtn title="删除" danger onClick={() => setDeleting(d)}>
                          <Trash2 size={15} />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {docs && docs.length > 0 && (
          <div className="mt-3 text-center text-[12px] text-zinc-400">可直接把文件拖拽到列表上传 · 支持 PDF / DOCX / MD / TXT</div>
        )}
      </div>

      <ChunkDrawer doc={chunkDoc} onClose={() => setChunkDoc(null)} />

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="删除文档"
        message={
          <>
            确定删除「{deleting?.filename}」？对应的 {deleting?.chunk_count} 个切片和向量会一并删除，之后的问答将不再引用该文档。
          </>
        }
        confirmText="删除"
        onConfirm={async () => {
          if (!deleting) return;
          await api.deleteDocument(deleting.id);
          setDeleting(null);
          mutateDocs();
        }}
      />
      <ConfirmModal
        open={deletingKB}
        onClose={() => setDeletingKB(false)}
        title="删除知识库"
        message={<>确定删除「{kb?.name}」？其中全部文档、切片、向量都会被删除，且无法恢复。</>}
        confirmText="删除知识库"
        onConfirm={async () => {
          await api.deleteKB(kbId);
          router.push("/");
        }}
      />
    </PageContainer>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "rounded-md p-1.5 text-zinc-400 transition-colors disabled:cursor-not-allowed disabled:opacity-30",
        danger ? "hover:bg-rose-50 hover:text-rose-600" : "hover:bg-zinc-100 hover:text-zinc-700",
      )}
    >
      {children}
    </button>
  );
}

function KBMenu({ onReparse, onDelete, busy }: { onReparse: () => void; onDelete: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="secondary" className="w-9 px-0" onClick={() => setOpen((o) => !o)} aria-label="更多操作" loading={busy}>
        {!busy && <MoreHorizontal size={16} />}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1.5 w-48 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
            <button
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-50"
              onClick={() => {
                setOpen(false);
                onReparse();
              }}
            >
              <RefreshCw size={14} /> 全部重新解析
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-rose-600 hover:bg-rose-50"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              <Trash2 size={14} /> 删除知识库
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ChunkDrawer({ doc, onClose }: { doc: DocumentItem | null; onClose: () => void }) {
  const { data: chunks } = useSWR<ChunkItem[]>(doc ? `/api/documents/${doc.id}/chunks` : null, fetcher);
  return (
    <Drawer
      open={!!doc}
      onClose={onClose}
      width={600}
      title={
        doc && (
          <div className="flex items-center gap-3">
            <FileTypeIcon type={doc.file_type} />
            <div className="min-w-0">
              <div className="truncate text-[14.5px] font-semibold">{doc.filename}</div>
              <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                {doc.chunk_count} 个切片 · {doc.char_count.toLocaleString()} 字
                <a href={fileUrl(doc.id)} target="_blank" className="inline-flex items-center gap-0.5 text-brand-600 hover:underline">
                  原文件 <ExternalLink size={11} />
                </a>
              </div>
            </div>
          </div>
        )
      }
    >
      <div className="space-y-3 p-5">
        {!chunks ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          chunks.map((c) => (
            <div key={c.id} className="rounded-xl border border-zinc-200/80 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11.5px]">
                <Badge tone="violet" className="font-mono">
                  #{c.chunk_index + 1}
                </Badge>
                <span className="font-mono text-zinc-400">{c.id}</span>
                {locationLabel(c.page, c.section) && <span className="text-zinc-500">{locationLabel(c.page, c.section)}</span>}
                <span className="ml-auto text-zinc-400">{c.char_count} 字</span>
              </div>
              <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-zinc-700">{c.content}</div>
            </div>
          ))
        )}
      </div>
    </Drawer>
  );
}
