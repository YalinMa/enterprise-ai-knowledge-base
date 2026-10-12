"""RAG 评测接口。"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import EvalRun, KnowledgeBase, get_db
from app.eval.runner import list_datasets, load_dataset, start_run
from app.providers import describe_providers, get_reranker
from app.schemas import ORM, UTCDateTime

router = APIRouter(prefix="/api/evals", tags=["eval"])


class EvalCreate(BaseModel):
    kb_id: int
    dataset: str = "demo"
    mode: str = Field(default="retrieval", pattern="^(retrieval|full)$")
    retrieval_mode: str = Field(default="hybrid", pattern="^(vector|hybrid)$")
    rerank: bool = True
    query_rewrite: bool = True
    top_k: int = Field(default=5, ge=1, le=20)
    llm_model: str | None = Field(default=None, max_length=100)  # 覆盖生成模型，用于模型选型对比


class EvalSummary(ORM):
    id: int
    kb_id: int
    kb_name: str
    dataset: str
    mode: str
    config: dict
    status: str
    progress: int
    total: int
    metrics: dict
    error: str | None
    created_at: UTCDateTime
    finished_at: UTCDateTime | None


class EvalDetail(EvalSummary):
    results: list


@router.get("/datasets")
def datasets():
    return list_datasets()


@router.get("", response_model=list[EvalSummary])
def list_runs(db: Session = Depends(get_db)):
    return db.scalars(select(EvalRun).order_by(EvalRun.id.desc()).limit(100)).all()


@router.post("", response_model=EvalSummary, status_code=201)
def create_run(body: EvalCreate, db: Session = Depends(get_db)):
    kb = db.get(KnowledgeBase, body.kb_id)
    if kb is None:
        raise HTTPException(404, "知识库不存在")
    try:
        cases = load_dataset(body.dataset)["cases"]
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    s, prov = get_settings(), describe_providers()
    config = {
        "retrieval_mode": body.retrieval_mode,
        "rerank": body.rerank and get_reranker() is not None,
        "query_rewrite": body.query_rewrite,
        "top_k": body.top_k,
        "embedding": prov["embedding"]["signature"],
        "llm": f'{prov["llm"]["provider"]}:{body.llm_model or prov["llm"]["model"]}',
        "llm_model": body.llm_model,
        "rewrite_llm": prov["llm"]["rewrite_model"],
        "reranker": prov["rerank"]["model"],
        "chunk_size": s.chunk_size,
    }
    run = EvalRun(kb_id=kb.id, kb_name=kb.name, dataset=body.dataset, mode=body.mode,
                  config=config, total=len(cases))
    db.add(run)
    db.commit()
    start_run(run.id)
    return run


@router.get("/{run_id}", response_model=EvalDetail)
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(EvalRun, run_id)
    if run is None:
        raise HTTPException(404, "评测记录不存在")
    return run


@router.delete("/{run_id}", status_code=204)
def delete_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(EvalRun, run_id)
    if run is None:
        raise HTTPException(404, "评测记录不存在")
    db.delete(run)
    db.commit()
