"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";

/**
 * 渲染回答正文，把 [1] [2] 这样的引用编号变成可点击的角标。
 * 实现：先把 [n] 改写成 markdown 链接 [n](#cite-n)，再在 a 标签渲染时识别出来。
 */
export const AnswerMarkdown = memo(function AnswerMarkdown({
  content,
  streaming,
  validIndexes,
  onCite,
}: {
  content: string;
  streaming?: boolean;
  /** 已校验的引用编号；流式过程中为 undefined，此时全部先显示 */
  validIndexes?: Set<number>;
  onCite?: (index: number) => void;
}) {
  const text = content.replace(/\[(\d{1,2})\](?!\()/g, "[$1](#cite-$1)");
  return (
    <div className={clsx("prose-answer", streaming && "typing-cursor")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => {
            const m = href?.match(/^#cite-(\d+)$/);
            if (m) {
              const n = Number(m[1]);
              if (validIndexes && !validIndexes.has(n)) return null;
              return (
                <button
                  type="button"
                  onClick={() => onCite?.(n)}
                  className="mx-[1px] inline-flex h-[17px] min-w-[17px] -translate-y-[1px] items-center justify-center rounded-[5px] bg-brand-50 px-1 align-middle font-mono text-[10.5px] font-semibold text-brand-700 ring-1 ring-brand-200/70 transition-colors hover:bg-brand-600 hover:text-white"
                  title={`查看引用 [${n}]`}
                >
                  {n}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" className="text-brand-600 underline" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
