"""
Scraper: fetches posts from @loaderfromSVO and saves to docs/data/posts.json.
Photos are saved to docs/media/ and referenced by relative path.
Videos are NOT downloaded (too large) — a link to Telegram is shown instead.

Environment variables (set as GitHub Secrets):
  TELEGRAM_API_ID       – from https://my.telegram.org
  TELEGRAM_API_HASH     – from https://my.telegram.org
  TELEGRAM_SESSION_STR  – StringSession (run generate_session.py once to get it)
  TELEGRAM_CHANNEL      – channel username without @ (default: loaderfromSVO)
  MESSAGES_LIMIT        – how many latest messages to fetch per run (default: 50)
"""

import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import (
    MessageMediaPhoto,
    MessageMediaDocument,
    DocumentAttributeAnimated,
    DocumentAttributeVideo,
)

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
API_ID      = int(os.environ["TELEGRAM_API_ID"])
API_HASH    = os.environ["TELEGRAM_API_HASH"]
SESSION_STR = os.environ["TELEGRAM_SESSION_STR"]
CHANNEL     = os.getenv("TELEGRAM_CHANNEL", "loaderfromSVO")
LIMIT       = int(os.getenv("MESSAGES_LIMIT", "50"))

REPO_ROOT  = Path(__file__).parent.parent
MEDIA_DIR  = REPO_ROOT / "docs" / "media"
DATA_FILE  = REPO_ROOT / "docs" / "data" / "posts.json"

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
DATA_FILE.parent.mkdir(parents=True, exist_ok=True)


# ── Helpers ───────────────────────────────────────────────────────────────────
def load_existing() -> dict:
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text("utf-8"))
        except Exception:
            pass
    return {"posts": [], "updated_at": None, "channel": CHANNEL}


def save(data: dict):
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    log.info(f"Saved {len(data['posts'])} posts to {DATA_FILE}")


def existing_ids(data: dict) -> set:
    return {p["id"] for p in data["posts"]}


async def download_photo(client: TelegramClient, message) -> str | None:
    """Download photo, return relative URL for frontend (e.g. 'media/12345.jpg')."""
    path = MEDIA_DIR / f"{message.id}.jpg"
    if not path.exists():
        try:
            await client.download_media(message.media, file=str(path))
        except Exception as e:
            log.warning(f"Photo download failed for msg {message.id}: {e}")
            return None
    return f"media/{path.name}"


def is_gif(doc) -> bool:
    return any(isinstance(a, DocumentAttributeAnimated) for a in doc.attributes)


def is_video(doc) -> bool:
    return any(isinstance(a, DocumentAttributeVideo) for a in doc.attributes)


async def process_message(client: TelegramClient, msg) -> dict | None:
    """Turn a Telethon message into a dict for the JSON file."""
    text = msg.text or msg.message or None

    photos   = []
    video_path = None
    gif_path   = None

    if msg.media:
        if isinstance(msg.media, MessageMediaPhoto):
            rel = await download_photo(client, msg)
            if rel:
                photos.append(rel)

        elif isinstance(msg.media, MessageMediaDocument):
            doc = msg.media.document
            if is_gif(doc):
                # GIFs are small — download them
                path = MEDIA_DIR / f"{msg.id}.mp4"
                if not path.exists():
                    try:
                        await client.download_media(msg.media, file=str(path))
                    except Exception as e:
                        log.warning(f"GIF download failed for msg {msg.id}: {e}")
                gif_path = f"media/{path.name}" if path.exists() else None
            elif is_video(doc):
                # Skip heavy video files; show Telegram link instead
                video_path = None   # frontend will show "Open on Telegram" link

    if not text and not photos and video_path is None and gif_path is None:
        return None   # service messages / stickers / polls — skip

    return {
        "id":         msg.id,
        "text":       text,
        "date":       msg.date.isoformat() if msg.date else None,
        "views":      msg.views or 0,
        "forwards":   msg.forwards or 0,
        "photos":     photos,       # list of relative paths, may be empty
        "video_path": video_path,   # None or relative path
        "gif_path":   gif_path,     # None or relative path
        "has_video":  bool(msg.media and isinstance(msg.media, MessageMediaDocument)
                           and is_video(msg.media.document) and not is_gif(msg.media.document)),
    }


async def handle_album(client: TelegramClient, msgs: list) -> dict | None:
    """Merge an album (grouped messages) into a single post."""
    msgs = sorted(msgs, key=lambda m: m.id)
    lead = msgs[0]
    text = next((m.text or m.message for m in msgs if (m.text or m.message)), None)

    photos = []
    for msg in msgs:
        if isinstance(msg.media, MessageMediaPhoto):
            rel = await download_photo(client, msg)
            if rel:
                photos.append(rel)

    if not text and not photos:
        return None

    return {
        "id":         lead.id,
        "text":       text,
        "date":       lead.date.isoformat() if lead.date else None,
        "views":      lead.views or 0,
        "forwards":   lead.forwards or 0,
        "photos":     photos,
        "video_path": None,
        "gif_path":   None,
        "has_video":  False,
    }


# ── Main ──────────────────────────────────────────────────────────────────────
async def main():
    data   = load_existing()
    seen   = existing_ids(data)
    new_posts: list[dict] = []

    client = TelegramClient(StringSession(SESSION_STR), API_ID, API_HASH)
    await client.start()

    try:
        entity = await client.get_entity(CHANNEL)
    except Exception as e:
        log.error(f"Cannot resolve channel @{CHANNEL}: {e}")
        await client.disconnect()
        sys.exit(1)

    albums: dict[int, list] = {}
    singles: list = []

    async for msg in client.iter_messages(entity, limit=LIMIT):
        if msg.id in seen:
            continue   # already have it
        if msg.grouped_id:
            albums.setdefault(msg.grouped_id, []).append(msg)
        else:
            singles.append(msg)

    # Process singles
    for msg in singles:
        post = await process_message(client, msg)
        if post:
            new_posts.append(post)

    # Process albums
    for msgs in albums.values():
        post = await handle_album(client, msgs)
        if post:
            new_posts.append(post)

    await client.disconnect()

    if not new_posts:
        log.info("No new posts found.")
        # Still update the timestamp so the badge refreshes
        save(data)
        return

    log.info(f"Found {len(new_posts)} new posts.")

    # Merge: new posts first, then existing, deduplicate by id
    merged_map: dict[int, dict] = {p["id"]: p for p in data["posts"]}
    for p in new_posts:
        merged_map[p["id"]] = p

    # Sort newest first, keep last 500
    all_sorted = sorted(merged_map.values(), key=lambda p: p["date"] or "", reverse=True)
    data["posts"] = all_sorted[:500]
    save(data)


if __name__ == "__main__":
    asyncio.run(main())
