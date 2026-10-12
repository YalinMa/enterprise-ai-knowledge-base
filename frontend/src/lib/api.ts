export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8100";

// ---------------- 类型（与后端 app/schemas.py 对应） ----------------

export interface KnowledgeBase {
  id: number;
  name: string;
  description: string;
  icon: string;
  embedding_signature: string | null;
  created_at: string;
  updated_at: string;
  document_count: number;
  chunk_count: number;
}

export type DocStatus = "pending" | "parsing" | "embedding" | "ready" | "failed";

export interface DocumentItem {
  id: number;
  kb_id: number;
  filename: string;
  file_type: string;
  file_size: number;
  status: DocStatus;
  error: string | null;
  page_count: number | null;
  char_count: number;
  chunk_count: number;
  lifecycle?: "active" | "deprecated";
  created_at: string;
  updated_at: string;
}

export interface ChunkItem {
  id: string;
  document_id: number;
  chunk_index: number;
  content: string;
  page: number | null;
  section: string | null;
  char_count: number;
}

export interface ChunkDetail extends ChunkItem {
  document_name: string;
  file_type: string;
  kb_id: number;
}

export interface Stats {
  kb_count: number;
  document_count: number;
  chunk_count: number;
  query_count: number;
  last_updated: string | null;
}

export interface RetrievedChunk {
  rank: number;
  chunk_id: string;
  document_id: number;
  document_name: string;
  page: number | null;
  section: string | null;
  content: string;
  score: number;
  passed_threshold: boolean;
  cited?: boolean;
  vector_rank?: number | null;
  bm25_rank?: number | null;
  bm25_score?: number | null;
  rrf_score?: number | null;
  rerank_score?: number | null;
  deprecated?: boolean;
}

export interface Citation {
  index: number;
  source_rank: number;
  chunk_id: string;
  document_id: number;
  document_name: string;
  page: number | null;
  section: string | null;
  content: string;
  score: number;
}

export interface Timings {
  rewrite_ms?: number;
  thinking_chars?: number;
  bm25_ms?: number;
  rerank_ms?: number;
  embed_ms?: number;
  search_ms?: number;
  llm_ms?: number;
  first_token_ms?: number | null;
  total_ms?: number;
}

export type QueryStatus = "ok" | "no_context" | "no_answer" | "error" | "running";

export interface QueryLogSummary {
  id: number;
  kb_id: number;
  kb_name: string;
  question: string;
  status: QueryStatus;
  answer: string;
  source?: string;
  feedback?: Feedback | null;
  created_at: string;
  timings: Timings;
  citations: Citation[];
}

export interface QueryLog extends QueryLogSummary {
  retrieval_query: string;
  retrieved: RetrievedChunk[];
  prompt: { role: string; content: string }[];
  params: {
    top_k?: number;
    min_score?: number;
    retrieval_mode?: string;
    rerank?: boolean;
    query_rewrite?: boolean;
    reranked?: boolean;
    reranker?: string | null;
    gate?: "similarity" | "rerank";
    keep_similarity?: number | null;
    candidates?: number;
    candidate_k?: number;
    embedding?: string;
    llm?: string;
    chunk_size?: number;
    chunk_overlap?: number;
    retriever?: string;
    invalid_citations?: number[];
    raw_answer?: string;
  };
  error: string | null;
}

export interface SystemConfig {
  providers: {
    llm: { provider: string; model: string; is_mock: boolean; configured_provider: string; rewrite_model?: string };
    embedding: {
      provider: string;
      model: string;
      is_mock: boolean;
      configured_provider: string;
      signature: string;
    };
    rerank: { provider: string; model: string | null; enabled: boolean; configured_provider: string };
  };
  rag: {
    chunk_size: number;
    chunk_overlap: number;
    top_k: number;
    min_score: number;
    rerank_min_score: number;
    rerank_keep_similarity: number;
    history_turns: number;
    retrieval_mode: string;
    candidate_k: number;
    rrf_k: number;
    query_rewrite: boolean;
    vector_db: string;
    keyword_index: string;
    metadata_db: string;
  };
  supported_types: string[];
  system_prompt: string;
}

export interface Feedback {
  rating: 1 | -1;
  reasons: string[];
  comment: string;
  at: string;
}

export interface Insights {
  total: number;
  refused: number;
  refusal_rate: number | null;
  upvotes: number;
  downvotes: number;
  feedback_rate: number | null;
  latency_avg_ms: number | null;
  first_token_avg_ms: number | null;
  trend: { date: string; total: number; refused: number }[];
  doc_usage: { document_id: number; filename: string; kb_name: string; citations: number }[];
  hot_questions: { question: string; count: number; examples: string[]; refused: number }[];
  problem_count: number;
}

export interface KnowledgeGap {
  topic: string;
  out_of_scope?: boolean;
  suggestion: string;
  owner: string;
  count: number;
  refused: number;
  downvoted: number;
  questions: string[];
  query_ids: number[];
  kb_names: string[];
  reasons: string[];
  last_at: string;
}

export interface RetrievalSettings {
  retrieval_mode: "vector" | "hybrid";
  rerank: boolean;
  query_rewrite: boolean;
}

export interface EvalMetrics {
  pass_rate: number | null;
  hit_rate: number | null;
  mrr: number | null;
  context_recall: number | null;
  refusal_accuracy: number | null;
  false_refusal_rate: number | null;
  refusal_recall: number | null;
  answer_accuracy?: number | null;
  citation_hit_rate?: number | null;
  latency_avg_ms: number | null;
  latency_p95_ms: number | null;
  by_category: Record<string, { total: number; passed: number }>;
}

export interface EvalCaseResult {
  id: string;
  category: string;
  question: string;
  should_refuse: boolean;
  expected_docs: string[];
  retrieval_query?: string;
  query_id?: number | null;
  refused: boolean;
  status?: string | null;
  hit_rank: number | null;
  context_recall: number;
  answer?: string;
  answer_recall?: number;
  citation_hit?: boolean | null;
  top_chunks?: { document_name: string; score: number; rerank_score: number | null; passed: boolean }[];
  total_ms?: number | null;
  passed: boolean;
  reason: string | null;
}

export interface EvalRun {
  id: number;
  kb_id: number;
  kb_name: string;
  dataset: string;
  mode: "retrieval" | "full";
  config: RetrievalSettings & {
    top_k: number;
    embedding: string;
    llm: string;
    llm_model?: string | null;
    reranker: string | null;
    chunk_size: number;
    split?: "all" | "dev" | "test";
  };
  status: "running" | "done" | "failed";
  progress: number;
  total: number;
  metrics: Partial<EvalMetrics>;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  results?: EvalCaseResult[];
}

export interface EvalDataset {
  id: string;
  name: string;
  description: string;
  count: number;
  categories: Record<string, number>;
  splits?: Record<string, number> | null;
}

// ---------------- 请求封装 ----------------

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(`无法连接后端服务（${API_BASE}），请确认后端已启动`);
  }
  if (!res.ok) {
    let msg = `请求失败（${res.status}）`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = body.detail;
      else if (Array.isArray(body.detail)) msg = body.detail.map((d: { msg: string }) => d.msg).join("；");
    } catch {}
    throw new ApiError(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const fetcher = <T,>(path: string) => request<T>(path);

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  createKB: (body: { name: string; description: string; icon: string }) =>
    request<KnowledgeBase>("/api/knowledge-bases", json("POST", body)),
  deleteKB: (id: number) => request<void>(`/api/knowledge-bases/${id}`, { method: "DELETE" }),
  reparseKB: (id: number) => request<DocumentItem[]>(`/api/knowledge-bases/${id}/reparse`, json("POST")),
  uploadDocuments: (kbId: number, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return request<DocumentItem[]>(`/api/knowledge-bases/${kbId}/documents`, { method: "POST", body: form });
  },
  deleteDocument: (id: number) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),
  setLifecycle: (id: number, lifecycle: "active" | "deprecated") =>
    request<DocumentItem>(`/api/documents/${id}`, json("PATCH", { lifecycle })),
  reparseDocument: (id: number) => request<DocumentItem>(`/api/documents/${id}/reparse`, json("POST")),
  demoFiles: () => request<string[]>("/api/demo/files"),
  /** 取回示例文件并封装成 File，之后与用户手动选择的文件走同一个上传接口 */
  fetchDemoFile: async (name: string) => {
    const res = await fetch(`${API_BASE}/api/demo/files/${encodeURIComponent(name)}`);
    if (!res.ok) throw new ApiError(`获取示例文件失败：${name}`);
    return new File([await res.blob()], name);
  },
  seedDemo: () => request<{ kb_id: number; added: string[] }>("/api/demo/seed", json("POST")),
  createEval: (
    body: { kb_id: number; dataset: string; split?: string; mode: string; llm_model?: string | null } & RetrievalSettings & {
      top_k: number;
    },
  ) =>
    request<EvalRun>("/api/evals", json("POST", body)),
  deleteEval: (id: number) => request<void>(`/api/evals/${id}`, { method: "DELETE" }),
  setFeedback: (id: number, body: { rating: number; reasons?: string[]; comment?: string }) =>
    request<QueryLogSummary>(`/api/retrievals/${id}/feedback`, json("PUT", body)),
  toEvalCase: (
    id: number,
    body: { expected_docs: string[]; expected_keywords: string[]; should_refuse: boolean },
  ) => request<{ id: number }>(`/api/retrievals/${id}/to-eval`, json("POST", body)),
  knowledgeGaps: (kbId?: number | null) =>
    request<{ gaps: KnowledgeGap[]; generated_by: string | null; problem_count: number; generated_at?: string }>(
      `/api/insights/gaps${kbId ? `?kb_id=${kbId}` : ""}`,
      json("POST"),
    ),
  exportGaps: (kbId?: number | null) =>
    request<{ markdown: string }>(`/api/insights/gaps/export${kbId ? `?kb_id=${kbId}` : ""}`),
  testSystem: () =>
    request<{
      embedding: { ok: boolean; dim?: number; error?: string };
      llm: { ok: boolean; reply?: string; error?: string };
    }>("/api/system/test", json("POST")),
};

export const fileUrl = (docId: number, page?: number | null) =>
  `${API_BASE}/api/documents/${docId}/file${page ? `#page=${page}` : ""}`;

// ---------------- 流式问答（SSE over fetch） ----------------

export type ChatEvent =
  | {
      type: "retrieval";
      query_id: number;
      query: string;
      chunks: RetrievedChunk[];
      used_count: number;
      min_score: number;
      gate: "similarity" | "rerank";
      warning: string | null;
    }
  | { type: "thinking" }
  | { type: "token"; text: string }
  | {
      type: "done";
      query_id: number;
      answer: string;
      citations: Citation[];
      status: QueryStatus;
      timings: Timings;
      invalid_citations?: number[];
    }
  | { type: "error"; message: string; query_id?: number };

export async function streamChat(
  body: { kb_id: number; question: string; history: { role: string; content: string }[] } & Partial<RetrievalSettings>,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/chat`, { ...json("POST", { ...body, stream: true }), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw new ApiError(`无法连接后端服务（${API_BASE}）`);
  }
  if (!res.ok || !res.body) {
    let msg = `请求失败（${res.status}）`;
    try {
      msg = (await res.json()).detail ?? msg;
    } catch {}
    throw new ApiError(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = raw
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as ChatEvent);
    }
  }
}
