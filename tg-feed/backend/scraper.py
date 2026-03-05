import os
import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from telethon import TelegramClient
from telethon.tl.types import (
    MessageMediaPhoto,
    MessageMediaDocument,
    DocumentAttributeVideo,
    DocumentAttributeAnimated,
    MessageEntityTextUrl,
)
from dotenv import load_dotenv

from models import upsert_post, upsert_post_media

load_dotenv()

def _text_with_links(message):
    """Return message text with Telegram hyperlinks as [display](url) markdown."""
    text = message.message or message.text or ""
    if not text or not message.entities:
        return text or None
    entities = [e for e in message.entities if isinstance(e, MessageEntityTextUrl)]
    if not entities:
        return text or None
    result, last = [], 0
    for e in sorted(entities, key=lambda x: x.offset):
        result.append(text[last:e.offset])
        display = text[e.offset:e.offset + e.length]
        result.append(f'[{display}]({e.url})')
        last = e.offset + e.length
    result.append(text[last:])
    return ''.join(result) or None


logger = logging.getLogger(__name__)

API_ID = int(os.getenv("TELEGRAM_API_ID", "0"))
API_HASH = os.getenv("TELEGRAM_API_HASH", "")
CHANNEL = os.getenv("TELEGRAM_CHANNEL", "loaderfromSVO")
SESSION_NAME = os.getenv("SESSION_NAME", "tg_session")
MEDIA_PATH = os.getenv("MEDIA_PATH", "../media")
MESSAGES_LIMIT = int(os.getenv("MESSAGES_LIMIT", "5000"))

Path(MEDIA_PATH).mkdir(parents=True, exist_ok=True)


def _media_filename(message_id: int, ext: str) -> str:
    return os.path.join(MEDIA_PATH, f"{message_id}{ext}")


async def _download_photo(client: TelegramClient, message) -> dict:
    ext = ".jpg"
    path = _media_filename(message.id, ext)
    if not os.path.exists(path):
        try:
            await client.download_media(message.media, file=path)
        except Exception as e:
            logger.warning(f"Failed to download photo for msg {message.id}: {e}")
            path = None
    size = message.media.photo.sizes[-1] if message.media.photo.sizes else None
    return {
        "media_type": "photo",
        "media_path": path,
        "media_url": f"/media/{os.path.basename(path)}" if path else None,
        "width": size.w if size and hasattr(size, "w") else None,
        "height": size.h if size and hasattr(size, "h") else None,
    }


async def _download_video(client: TelegramClient, message, is_gif: bool = False) -> dict:
    doc = message.media.document
    ext = ".mp4"
    path = _media_filename(message.id, ext)
    media_type = "gif" if is_gif else "video"
    if not os.path.exists(path):
        try:
            await client.download_media(message.media, file=path)
        except Exception as e:
            logger.warning(f"Failed to download video for msg {message.id}: {e}")
            path = None
    width, height = None, None
    for attr in doc.attributes:
        if isinstance(attr, DocumentAttributeVideo):
            width, height = attr.w, attr.h
            break
    return {
        "media_type": media_type,
        "media_path": path,
        "media_url": f"/media/{os.path.basename(path)}" if path else None,
        "width": width,
        "height": height,
    }


async def _process_media(client: TelegramClient, message) -> dict:
    if isinstance(message.media, MessageMediaPhoto):
        return await _download_photo(client, message)
    elif isinstance(message.media, MessageMediaDocument):
        doc = message.media.document
        is_gif = any(isinstance(a, DocumentAttributeAnimated) for a in doc.attributes)
        is_video = any(isinstance(a, DocumentAttributeVideo) for a in doc.attributes)
        if is_video or is_gif:
            return await _download_video(client, message, is_gif)
    return {}


async def scrape_channel(client: TelegramClient, limit: int = MESSAGES_LIMIT):
    logger.info(f"Scraping channel @{CHANNEL}, limit={limit}")
    try:
        entity = await client.get_entity(CHANNEL)
    except Exception as e:
        logger.error(f"Cannot get channel entity: {e}")
        return

    grouped: dict[int, list] = {}
    messages_to_process = []

    async for message in client.iter_messages(entity, limit=limit):
        if message.grouped_id:
            if message.grouped_id not in grouped:
                grouped[message.grouped_id] = []
            grouped[message.grouped_id].append(message)
        else:
            messages_to_process.append(message)

    # Process ungrouped messages
    for message in messages_to_process:
        media_info = {}
        if message.media:
            media_info = await _process_media(client, message)

        post = {
            "message_id": message.id,
            "text": _text_with_links(message),
            "date": message.date.isoformat() if message.date else datetime.now(timezone.utc).isoformat(),
            "views": message.views or 0,
            "forwards": message.forwards or 0,
            "has_media": 1 if message.media else 0,
            "media_type": media_info.get("media_type"),
            "media_path": media_info.get("media_path"),
            "media_url": media_info.get("media_url"),
            "grouped_id": None,
        }
        await upsert_post(post)
        if media_info.get("media_path"):
            await upsert_post_media(message.id, [media_info])

    # Process grouped messages (albums)
    for group_id, msgs in grouped.items():
        msgs.sort(key=lambda m: m.id)
        lead = msgs[0]
        text = next((m.text or m.message for m in msgs if m.text or m.message), None)

        # Use the message with text as lead, or first
        lead_msg = next((m for m in msgs if m.text or m.message), lead)

        first_media = {}
        if lead.media:
            first_media = await _process_media(client, lead)

        post = {
            "message_id": lead_msg.id,
            "text": _text_with_links(lead_msg),
            "date": lead_msg.date.isoformat() if lead_msg.date else datetime.now(timezone.utc).isoformat(),
            "views": lead_msg.views or 0,
            "forwards": lead_msg.forwards or 0,
            "has_media": 1,
            "media_type": first_media.get("media_type"),
            "media_path": first_media.get("media_path"),
            "media_url": first_media.get("media_url"),
            "grouped_id": group_id,
        }
        await upsert_post(post)

        # Download all media in the album
        all_media = []
        for msg in msgs:
            if msg.media:
                info = await _process_media(client, msg)
                if info:
                    all_media.append(info)
        if all_media:
            await upsert_post_media(lead_msg.id, all_media)

    logger.info(f"Scraping complete. Processed {len(messages_to_process)} messages + {len(grouped)} groups.")


async def run_scraper():
    client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
    await client.start()
    await scrape_channel(client)
    await client.disconnect()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_scraper())
