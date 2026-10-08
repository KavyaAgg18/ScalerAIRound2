import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import auth, cidr_collections, errors, health_checks, migrate, records, zone_files, zones
from .db import Base, SessionLocal, engine
from .seed import seed

STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).parents[2] / "frontend" / "out"))


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    migrate.upgrade(engine)
    with SessionLocal() as db:
        seed(db)
    yield


app = FastAPI(title="Route 53 Console Clone API", lifespan=lifespan)
errors.install(app)
app.include_router(auth.router)
app.include_router(zones.router)
app.include_router(records.router)
app.include_router(zone_files.router)
app.include_router(health_checks.router)
app.include_router(cidr_collections.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Production: serve the static Next.js export from the same origin (no CORS, first-party cookie).
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
