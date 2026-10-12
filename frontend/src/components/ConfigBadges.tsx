import type { EvalRun } from "@/lib/api";
import { Badge } from "./ui";

/** 评测使用的检索策略标签 */
export function ConfigBadges({ run }: { run: Pick<EvalRun, "config" | "mode"> }) {
  const c = run.config;
  return (
    <div className="flex flex-wrap gap-1">
      <Badge tone={c.retrieval_mode === "hybrid" ? "violet" : "zinc"}>{c.retrieval_mode === "hybrid" ? "混合检索" : "向量检索"}</Badge>
      {c.rerank && <Badge tone="blue">Rerank</Badge>}
      {c.query_rewrite && <Badge tone="amber">追问改写</Badge>}
      <Badge tone={run.mode === "full" ? "green" : "zinc"}>{run.mode === "full" ? "完整问答" : "仅检索"}</Badge>
      {c.split === "dev" && <Badge tone="zinc">调参集</Badge>}
      {c.split === "test" && <Badge tone="red">测试集</Badge>}
      {c.llm_model && <Badge tone="zinc">{c.llm_model}</Badge>}
    </div>
  );
}
