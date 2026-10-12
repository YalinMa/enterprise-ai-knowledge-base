import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api import chat, evals, insights, knowledge
from app.config import get_settings
from app.db import EvalRun, SessionLocal, init_db
from app.providers import describe_providers
from app.rag.ingest import reset_stuck_documents

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")


def _fail_interrupted_evals() -> None:
    """服务重启时，把上次没跑完的评测标记为中断。"""
    db = SessionLocal()
    try:
        for run in db.scalars(select(EvalRun).where(EvalRun.status == "running")):
            run.status, run.error = "failed", "服务重启，评测被中断"
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    logging.getLogger("app").info("providers: %s", describe_providers())
    threading.Thread(target=reset_stuck_documents, daemon=True).start()
    _fail_interrupted_evals()
    yield


app = FastAPI(title="Enterprise AI Knowledge Base", version="0.3.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_methods=["*"], allow_headers=["*"],
)
app.include_router(knowledge.router)
app.include_router(chat.router)
app.include_router(evals.router)
app.include_router(insights.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
