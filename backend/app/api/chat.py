"""问答（SSE 流式）、检索记录、系统配置、Demo 数据导入。"""

import json
import shutil
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import PROJECT_DIR, get_settings
from app.db import Document, KnowledgeBase, QueryLog, get_db
from app.providers import describe_providers, get_embedder, get_llm
from app.rag.ingest import ingest_document
from app.rag.parsers import SUPPORTED_TYPES, detect_type
from app.rag.pipeline import answer_stream
from app.rag.prompts import SYSTEM_PROMPT
from app.schemas import ChatRequest, QueryLogOut, QueryLogSummary

router = APIRouter(prefix="/api", tags=["chat"])

DEMO_DIR = PROJECT_DIR / "demo-data"
DEMO_KB_NAME = "Demo 企业知识库"


@router.post("/chat")
def chat(body: ChatRequest, db: Session = Depends(get_db)):
    if db.get(KnowledgeBase, body.kb_id) is None:
        raise HTTPException(404, "知识库不存在")
    events = answer_stream(body.kb_id, body.question.strip(),
                           [m.model_dump() for m in body.history], body.top_k)
    if not body.stream:
        result = {}
        for ev in events:
            if ev["type"] == "retrieval":
                result["retrieved"] = ev["chunks"]
            elif ev["type"] in ("done", "error"):
                result.update(ev)
        return result

    def sse():
        for ev in events:
            yield f"data: {json.dumps(ev, ensure_ascii=False, default=str)}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/retrievals", response_model=list[QueryLogSummary])
def list_retrievals(kb_id: int | None = None, limit: int = 100, db: Session = Depends(get_db)):
    q = select(QueryLog).order_by(QueryLog.id.desc()).limit(min(limit, 500))
    if kb_id:
        q = q.where(QueryLog.kb_id == kb_id)
    return db.scalars(q).all()


@router.get("/retrievals/{log_id}", response_model=QueryLogOut)
def get_retrieval(log_id: int, db: Session = Depends(get_db)):
    log = db.get(QueryLog, log_id)
    if log is None:
        raise HTTPException(404, "检索记录不存在")
    return log


@router.get("/system/config")
def system_config():
    s, emb = get_settings(), get_embedder()
    return {
        "providers": describe_providers(),
        "rag": {"chunk_size": s.chunk_size, "chunk_overlap": s.chunk_overlap, "top_k": s.top_k,
                "min_score": s.min_score if s.min_score is not None else emb.default_min_score,
                "history_turns": s.history_turns, "retriever": "vector (cosine)",
                "vector_db": "Chroma (local persistent)", "metadata_db": "SQLite"},
        "supported_types": SUPPORTED_TYPES,
        "system_prompt": SYSTEM_PROMPT,
    }


@router.post("/system/test")
def system_test():
    """连通性自检：分别调用一次 Embedding 和 LLM。"""
    out = {}
    try:
        v = get_embedder().embed_query("连通性测试")
        out["embedding"] = {"ok": True, "dim": len(v)}
    except Exception as e:  # noqa: BLE001
        out["embedding"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    try:
        text = get_llm().complete([{"role": "user", "content": "请只回复：OK"}],
                                  context=[{"index": 1, "content": "OK，连通正常。"}])
        out["llm"] = {"ok": True, "reply": text[:100]}
    except Exception as e:  # noqa: BLE001
        out["llm"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    return out


@router.get("/demo/files")
def demo_files():
    return [p.name for p in sorted(DEMO_DIR.iterdir())
            if p.is_file() and detect_type(p.name) in SUPPORTED_TYPES] if DEMO_DIR.exists() else []


@router.get("/demo/files/{name}")
def demo_file(name: str):
    """下载单个示例文件，前端拿到后走正常的上传流程。"""
    if name not in demo_files():  # 白名单校验，防止路径穿越
        raise HTTPException(404, "示例文件不存在")
    return FileResponse(DEMO_DIR / name, filename=name)


@router.post("/demo/seed")
def seed_demo(background: BackgroundTasks, db: Session = Depends(get_db)):
    """一键创建「Demo 企业知识库」并导入 demo-data/ 下的全部示例资料（面试演示用）。"""
    settings = get_settings()
    kb = db.scalar(select(KnowledgeBase).where(KnowledgeBase.name == DEMO_KB_NAME))
    if kb is None:
        kb = KnowledgeBase(name=DEMO_KB_NAME, icon="building",
                           description="示例企业「星河科技」的人事、财务、售后与渠道制度")
        db.add(kb)
        db.commit()
    existing = {d.filename for d in kb.documents}
    added = []
    for name in demo_files():
        if name in existing:
            continue
        src = DEMO_DIR / name
        dest_dir = settings.upload_dir / str(kb.id)
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{uuid.uuid4().hex[:12]}_{name}"
        shutil.copy(src, dest)
        doc = Document(kb_id=kb.id, filename=name, file_type=detect_type(name),
                       file_size=dest.stat().st_size, storage_path=str(dest), source="demo")
        db.add(doc)
        added.append(doc)
    db.commit()
    for d in added:
        background.add_task(ingest_document, d.id)
    return {"kb_id": kb.id, "added": [d.filename for d in added]}
