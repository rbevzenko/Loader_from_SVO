import os
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv
from telethon import TelegramClient

from models import init_db, get_posts, get_post_by_id, get_total_count
from scraper import scrape_channel, API_ID, API_HASH, SESSION_NAME

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

MEDIA_PATH = os.getenv("MEDIA_PATH", "../media")
UPDATE_INTERVAL = int(os.getenv("UPDATE_INTERVAL", "300"))

Path(MEDIA_PATH).mkdir(parents=True, exist_ok=True)

scheduler = AsyncIOScheduler()
tg_client: Optional[TelegramClient] = None


async def scheduled_scrape():
    global tg_client
    if tg_client and tg_client.is_connected():
        logger.info("Running scheduled scrape...")
        try:
            await scrape_channel(tg_client)
        except Exception as e:
            logger.error(f"Scheduled scrape failed: {e}")
    else:
        logger.warning("Telegram client not connected, skipping scheduled scrape.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global tg_client
    await init_db()
    logger.info("Database initialized.")

    if API_ID and API_HASH:
        try:
            tg_client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
            await tg_client.start()
            logger.info("Telegram client connected. Running initial scrape...")
            await scrape_channel(tg_client)
        except Exception as e:
            logger.error(f"Could not start Telegram client: {e}")
            tg_client = None

        if tg_client:
            scheduler.add_job(
                scheduled_scrape,
                "interval",
                seconds=UPDATE_INTERVAL,
                id="scrape_job",
            )
            scheduler.start()
            logger.info(f"Scheduler started, update interval: {UPDATE_INTERVAL}s")
    else:
        logger.warning(
            "TELEGRAM_API_ID / TELEGRAM_API_HASH not set. Scraper disabled. "
            "Set them in .env to enable live data."
        )

    yield

    scheduler.shutdown(wait=False)
    if tg_client:
        await tg_client.disconnect()
    logger.info("Shutdown complete.")


app = FastAPI(
    title="Telegram Feed API",
    description="API for @loaderfromSVO Telegram channel posts",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _serialize_post(row: dict) -> dict:
    extra_media = []
    if row.get("extra_media"):
        for item in row["extra_media"].split(";;"):
            parts = item.split("|")
            if len(parts) >= 5:
                extra_media.append({
                    "media_type": parts[0] or None,
                    "media_path": parts[1] or None,
                    "media_url": parts[2] or None,
                    "width": int(parts[3]) if parts[3] and parts[3] != "0" else None,
                    "height": int(parts[4]) if parts[4] and parts[4] != "0" else None,
                })

    return {
        "id": row["id"],
        "message_id": row["message_id"],
        "text": row["text"],
        "text_html": row.get("text_html"),
        "date": row["date"],
        "views": row["views"],
        "forwards": row["forwards"],
        "has_media": bool(row["has_media"]),
        "media_type": row["media_type"],
        "media_url": row["media_url"],
        "grouped_id": row["grouped_id"],
        "media_gallery": extra_media,
    }


@app.get("/api/posts")
async def list_posts(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    rows = await get_posts(limit=limit, offset=offset)
    total = await get_total_count()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + limit < total,
        "posts": [_serialize_post(r) for r in rows],
    }


@app.get("/api/posts/{post_id}")
async def get_post(post_id: int):
    row = await get_post_by_id(post_id)
    if not row:
        raise HTTPException(status_code=404, detail="Post not found")
    return _serialize_post(row)


@app.post("/api/refresh")
async def trigger_refresh():
    global tg_client
    if not tg_client or not tg_client.is_connected():
        raise HTTPException(status_code=503, detail="Telegram client not available")
    asyncio.create_task(scrape_channel(tg_client))
    return {"status": "refresh started"}


@app.get("/api/status")
async def status():
    global tg_client
    total = await get_total_count()
    return {
        "status": "ok",
        "telegram_connected": bool(tg_client and tg_client.is_connected()),
        "total_posts": total,
        "update_interval_seconds": UPDATE_INTERVAL,
    }


# Serve downloaded media files
app.mount("/media", StaticFiles(directory=MEDIA_PATH), name="media")

# Serve frontend static files
FRONTEND_PATH = Path(__file__).parent.parent / "frontend"
if FRONTEND_PATH.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_PATH)), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(str(FRONTEND_PATH / "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
