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
    llm: { provider: string; model: string; is_mock: boolean; configured_provider: string };
    embedding: {
      provider: string;
      model: string;
      is_mock: boolean;
      configured_provider: string;
      signature: string;
    };
  };
  rag: {
    chunk_size: number;
    chunk_overlap: number;
    top_k: number;
    min_score: number;
    history_turns: number;
    retriever: string;
    vector_db: string;
    metadata_db: string;
  };
  supported_types: string[];
  system_prompt: string;
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
  reparseDocument: (id: number) => request<DocumentItem>(`/api/documents/${id}/reparse`, json("POST")),
  demoFiles: () => request<string[]>("/api/demo/files"),
  /** 取回示例文件并封装成 File，之后与用户手动选择的文件走同一个上传接口 */
  fetchDemoFile: async (name: string) => {
    const res = await fetch(`${API_BASE}/api/demo/files/${encodeURIComponent(name)}`);
    if (!res.ok) throw new ApiError(`获取示例文件失败：${name}`);
    return new File([await res.blob()], name);
  },
  seedDemo: () => request<{ kb_id: number; added: string[] }>("/api/demo/seed", json("POST")),
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
  | { type: "retrieval"; query_id: number; chunks: RetrievedChunk[]; used_count: number; min_score: number; warning: string | null }
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
  body: { kb_id: number; question: string; history: { role: string; content: string }[] },
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
