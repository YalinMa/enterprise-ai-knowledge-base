"use client";

import { useState } from "react";
import useSWR from "swr";
import clsx from "clsx";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { api, fetcher, type Feedback } from "@/lib/api";
import { Button } from "./ui";

/** 回答的点赞 / 点踩。点踩时选择原因并可补充说明，差评会进入「知识洞察」和检索记录的差评筛选。 */
export function FeedbackBar({
  queryId,
  value,
  onChange,
  size = 13,
}: {
  queryId: number;
  value?: Feedback | null;
  onChange?: (f: Feedback | null) => void;
  size?: number;
}) {
  const { data: reasons } = useSWR<string[]>("/api/feedback/reasons", fetcher);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(value?.reasons ?? []);
  const [comment, setComment] = useState(value?.comment ?? "");
  const [saving, setSaving] = useState(false);
  const rating = value?.rating ?? 0;

  async function save(r: number, rs: string[] = [], c = "") {
    setSaving(true);
    try {
      const res = await api.setFeedback(queryId, { rating: r, reasons: rs, comment: c });
      onChange?.(res.feedback ?? null);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const btn = (active: boolean, tone: "up" | "down") =>
    clsx(
      "inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors",
      active
        ? tone === "up"
          ? "bg-emerald-50 text-emerald-700"
          : "bg-rose-50 text-rose-600"
        : "hover:bg-zinc-100 hover:text-zinc-700",
    );

  return (
    <div className="relative inline-flex items-center gap-0.5">
      <button title="有帮助" className={btn(rating === 1, "up")} onClick={() => save(rating === 1 ? 0 : 1)} disabled={saving}>
        <ThumbsUp size={size} />
      </button>
      <button
        title="没帮助"
        className={btn(rating === -1, "down")}
        onClick={() => (rating === -1 ? save(0) : setOpen((o) => !o))}
        disabled={saving}
      >
        <ThumbsDown size={size} />
      </button>
      {rating === -1 && value?.reasons?.length ? (
        <span className="ml-1 text-[11.5px] text-rose-500">{value.reasons.join("、")}</span>
      ) : null}
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-20 mb-1.5 w-72 rounded-xl border border-zinc-200 bg-white p-3 text-[12.5px] shadow-lg">
            <div className="mb-2 font-medium text-zinc-800">哪里不满意？</div>
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {(reasons ?? []).map((r) => (
                <button
                  key={r}
                  onClick={() => setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))}
                  className={clsx(
                    "rounded-full border px-2.5 py-1 transition-colors",
                    picked.includes(r) ? "border-rose-300 bg-rose-50 text-rose-700" : "border-zinc-200 text-zinc-600 hover:border-zinc-300",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="补充说明（可选）：正确答案应该是什么？"
              className="mb-2.5 w-full resize-none rounded-lg border border-zinc-200 px-2.5 py-1.5 outline-none focus:border-brand-500"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button size="sm" variant="primary" loading={saving} onClick={() => save(-1, picked, comment)}>
                提交反馈
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
