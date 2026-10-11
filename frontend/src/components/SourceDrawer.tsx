"use client";

import useSWR from "swr";
import { ExternalLink, FileSearch, Hash } from "lucide-react";
import { fetcher, fileUrl, type ChunkDetail } from "@/lib/api";
import { locationLabel } from "@/lib/format";
import { Badge, Drawer, ErrorBanner, FileTypeIcon, ScoreBar, Spinner } from "./ui";

export interface SourceRef {
  index?: number;
  chunk_id: string;
  document_id: number;
  document_name: string;
  page: number | null;
  section: string | null;
  content: string;
  score?: number;
}

/** 引用原文查看：展示被引用切片的原文、出处、相似度，并可打开原始文件（PDF 自动跳到对应页）。 */
export function SourceDrawer({ source, onClose }: { source: SourceRef | null; onClose: () => void }) {
  // 再向后端取一次切片，确认引用指向真实存在的数据（文档被删除后会提示）
  const { data, error, isLoading } = useSWR<ChunkDetail>(source ? `/api/chunks/${source.chunk_id}` : null, fetcher);
  const fileType = data?.file_type ?? source?.document_name.split(".").pop() ?? "txt";
  const loc = source ? locationLabel(source.page, source.section) : "";

  return (
    <Drawer
      open={!!source}
      onClose={onClose}
      width={540}
      title={
        source && (
          <div className="flex items-center gap-3">
            <FileTypeIcon type={fileType} size={36} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {source.index !== undefined && (
                  <span className="rounded-md bg-brand-600 px-1.5 font-mono text-[11px] font-semibold text-white">
                    {source.index}
                  </span>
                )}
                <span className="truncate text-[14.5px] font-semibold">《{source.document_name}》</span>
              </div>
              {loc && <div className="mt-0.5 truncate text-[12px] text-zinc-500">{loc}</div>}
            </div>
          </div>
        )
      }
    >
      {source && (
        <div className="p-5">
          <div className="mb-4 grid grid-cols-2 gap-3 text-[12px]">
            <Meta label="Chunk ID">
              <span className="flex items-center gap-1 font-mono text-zinc-700">
                <Hash size={11} />
                {source.chunk_id}
              </span>
            </Meta>
            {source.score !== undefined && (
              <Meta label="Similarity">
                <ScoreBar score={source.score} />
              </Meta>
            )}
            {source.page && <Meta label="页码">第 {source.page} 页</Meta>}
            {data && <Meta label="切片长度">{data.char_count} 字</Meta>}
          </div>

          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-zinc-500">
            <FileSearch size={13} /> 引用原文
          </div>
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 p-4 text-[13.5px] leading-[1.8] whitespace-pre-wrap text-zinc-800">
            {data?.content ?? source.content}
          </div>

          {isLoading && (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-zinc-400">
              <Spinner size={12} /> 正在校验来源…
            </div>
          )}
          {error && (
            <div className="mt-3">
              <ErrorBanner message={error.message} />
            </div>
          )}
          {data && (
            <div className="mt-3 flex items-center justify-between">
              <Badge tone="green">✓ 来源已校验：切片存在于知识库</Badge>
              <a
                href={fileUrl(source.document_id, source.page)}
                target="_blank"
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-600 hover:underline"
              >
                打开原文件{source.page ? `（第 ${source.page} 页）` : ""} <ExternalLink size={12} />
              </a>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2">
      <div className="mb-0.5 text-[11px] text-zinc-400">{label}</div>
      <div className="text-zinc-700">{children}</div>
    </div>
  );
}
