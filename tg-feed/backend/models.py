import aiosqlite
import os
from typing import Optional

DATABASE_PATH = os.getenv("DATABASE_PATH", "../data/posts.db")


async def init_db():
    os.makedirs(os.path.dirname(os.path.abspath(DATABASE_PATH)), exist_ok=True)
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY,
                message_id INTEGER UNIQUE NOT NULL,
                text TEXT,
                date TEXT NOT NULL,
                views INTEGER DEFAULT 0,
                forwards INTEGER DEFAULT 0,
                has_media INTEGER DEFAULT 0,
                media_type TEXT,
                media_path TEXT,
                media_url TEXT,
                grouped_id INTEGER,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS post_media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                media_type TEXT NOT NULL,
                media_path TEXT,
                media_url TEXT,
                width INTEGER,
                height INTEGER,
                FOREIGN KEY (post_id) REFERENCES posts(id)
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_posts_date ON posts(date DESC)
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_posts_message_id ON posts(message_id)
        """)
        await db.commit()


async def upsert_post(post: dict):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            INSERT INTO posts (message_id, text, date, views, forwards,
                               has_media, media_type, media_path, media_url, grouped_id)
            VALUES (:message_id, :text, :date, :views, :forwards,
                    :has_media, :media_type, :media_path, :media_url, :grouped_id)
            ON CONFLICT(message_id) DO UPDATE SET
                text = excluded.text,
                views = excluded.views,
                forwards = excluded.forwards,
                has_media = excluded.has_media,
                media_type = excluded.media_type,
                media_path = excluded.media_path,
                media_url = excluded.media_url
        """, post)
        await db.commit()


async def upsert_post_media(post_message_id: int, media_list: list):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        row = await db.execute(
            "SELECT id FROM posts WHERE message_id = ?", (post_message_id,)
        )
        row = await row.fetchone()
        if not row:
            return
        post_id = row[0]
        await db.execute("DELETE FROM post_media WHERE post_id = ?", (post_id,))
        for media in media_list:
            await db.execute("""
                INSERT INTO post_media (post_id, media_type, media_path, media_url, width, height)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (post_id, media.get("media_type"), media.get("media_path"),
                  media.get("media_url"), media.get("width"), media.get("height")))
        await db.commit()


async def get_posts(limit: int = 20, offset: int = 0) -> list:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT p.*, GROUP_CONCAT(
                pm.media_type || '|' || COALESCE(pm.media_path, '') || '|' ||
                COALESCE(pm.media_url, '') || '|' || COALESCE(pm.width, 0) || '|' ||
                COALESCE(pm.height, 0),
                ';;'
            ) as extra_media
            FROM posts p
            LEFT JOIN post_media pm ON pm.post_id = p.id
            WHERE p.text IS NOT NULL OR p.has_media = 1
            GROUP BY p.id
            ORDER BY p.date DESC
            LIMIT ? OFFSET ?
        """, (limit, offset))
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_post_by_id(post_id: int) -> Optional[dict]:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT p.*, GROUP_CONCAT(
                pm.media_type || '|' || COALESCE(pm.media_path, '') || '|' ||
                COALESCE(pm.media_url, '') || '|' || COALESCE(pm.width, 0) || '|' ||
                COALESCE(pm.height, 0),
                ';;'
            ) as extra_media
            FROM posts p
            LEFT JOIN post_media pm ON pm.post_id = p.id
            WHERE p.id = ?
            GROUP BY p.id
        """, (post_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_total_count() -> int:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM posts WHERE text IS NOT NULL OR has_media = 1"
        )
        row = await cursor.fetchone()
        return row[0] if row else 0
