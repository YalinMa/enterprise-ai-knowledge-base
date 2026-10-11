import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, knowledge
from app.config import get_settings
from app.db import init_db
from app.providers import describe_providers
from app.rag.ingest import reset_stuck_documents

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    logging.getLogger("app").info("providers: %s", describe_providers())
    threading.Thread(target=reset_stuck_documents, daemon=True).start()
    yield


app = FastAPI(title="Enterprise AI Knowledge Base", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_methods=["*"], allow_headers=["*"],
)
app.include_router(knowledge.router)
app.include_router(chat.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
