"""
Scraper: parses the public Telegram channel page t.me/s/{channel}
No API keys, no session, no authentication needed — works for any public channel.

Environment variables (optional GitHub Secrets):
  TELEGRAM_CHANNEL  – channel username without @ (default: loaderfromSVO)
  MESSAGES_LIMIT    – how many latest messages to keep (default: 100)
"""

import html as html_mod
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from html.parser import HTMLParser

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

CHANNEL = os.getenv("TELEGRAM_CHANNEL", "loaderfromSVO")
LIMIT   = int(os.getenv("MESSAGES_LIMIT", "100"))

REPO_ROOT = Path(__file__).parent.parent
DATA_FILE = REPO_ROOT / "docs" / "data" / "posts.json"
DATA_FILE.parent.mkdir(parents=True, exist_ok=True)

BASE_URL    = f"https://t.me/s/{CHANNEL}"
HEADERS     = {
    "User-Agent": "Mozilla/5.0 (compatible; TelegramFeedBot/1.0)",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
}


# ── Minimal HTML parser ────────────────────────────────────────────────────────
class ChannelParser(HTMLParser):
    """Extracts posts from t.me/s/{channel} HTML."""

    def __init__(self):
        super().__init__()
        self.posts: list[dict] = []
        self._cur: dict | None = None   # post being built
        self._stack: list[str] = []     # tag stack for context
        self._attrs_stack: list[dict] = []
        self._capture_text = False
        self._text_buf: list[str] = []
        self._depth_at_text_start = 0

    # ── helpers ────────────────────────────────────────────────────────────
    @staticmethod
    def _attrs(attrs):
        return dict(attrs)

    def _cls(self, a):
        return a.get("class", "")

    # ── traversal ─────────────────────────────────────────────────────────
    def handle_starttag(self, tag, attrs):
        a = self._attrs(attrs)
        cls = self._cls(a)
        self._stack.append(tag)
        self._attrs_stack.append(a)

        # ── New message ──────────────────────────────────────────────────
        if "tgme_widget_message_wrap" in cls:
            self._cur = {
                "id": None, "text": None, "date": None,
                "views": 0, "photos": [], "video_path": None,
                "gif_path": None, "has_video": False,
            }

        if self._cur is None:
            return

        # ── Message permalink → extract id ───────────────────────────────
        if tag == "a" and "tgme_widget_message_date" in cls:
            href = a.get("href", "")
            m = re.search(r"/(\d+)$", href)
            if m:
                self._cur["id"] = int(m.group(1))

        # ── Date ─────────────────────────────────────────────────────────
        if tag == "time" and a.get("datetime"):
            self._cur["date"] = a["datetime"]

        # ── Views ─────────────────────────────────────────────────────────
        if "tgme_widget_message_views" in cls:
            self._capture_text = True
            self._text_buf = []
            self._depth_at_text_start = len(self._stack)

        # ── Photo (background-image in style) ─────────────────────────────
        if "tgme_widget_message_photo_wrap" in cls:
            style = a.get("style", "")
            m = re.search(r"url\('([^']+)'\)", style)
            if m:
                self._cur["photos"].append(m.group(1))

        # ── Video ─────────────────────────────────────────────────────────
        if tag == "video":
            src = a.get("src", "")
            if src:
                self._cur["has_video"] = True
                # Don't store video src — just mark it, frontend shows TG link

        # ── Text ──────────────────────────────────────────────────────────
        if "tgme_widget_message_text" in cls:
            self._capture_text = True
            self._text_buf = []
            self._depth_at_text_start = len(self._stack)
            self._capturing_main_text = True
        else:
            self._capturing_main_text = False

    def handle_endtag(self, tag):
        if self._stack:
            self._stack.pop()
        if self._attrs_stack:
            top_attrs = self._attrs_stack.pop()
        else:
            top_attrs = {}

        cls = self._cls(top_attrs)

        # Flush text capture
        if self._capture_text and len(self._stack) < self._depth_at_text_start:
            text = "".join(self._text_buf).strip()
            if "tgme_widget_message_views" in cls or \
               any("tgme_widget_message_views" in self._cls(a) for a in self._attrs_stack):
                # handled in data
                pass
            if text:
                if self._cur and self._cur["text"] is None:
                    self._cur["text"] = text
                elif self._cur and "K" in text or text.isdigit():
                    # likely views
                    self._cur["views"] = _parse_views(text)
            self._capture_text = False
            self._text_buf = []

        # Close message
        if "tgme_widget_message_wrap" in cls and self._cur is not None:
            if self._cur["id"] is not None:
                self.posts.append(self._cur)
            self._cur = None

    def handle_data(self, data):
        if self._capture_text:
            self._text_buf.append(data)

    def handle_entityref(self, name):
        entities = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "nbsp": " "}
        if self._capture_text:
            self._text_buf.append(entities.get(name, ""))

    def handle_charref(self, name):
        if self._capture_text:
            try:
                ch = chr(int(name[1:], 16) if name.startswith("x") else int(name))
                self._text_buf.append(ch)
            except Exception:
                pass


def _parse_views(s: str) -> int:
    s = s.strip().upper().replace("\xa0", "")
    try:
        if "K" in s:
            return int(float(s.replace("K", "")) * 1000)
        if "M" in s:
            return int(float(s.replace("M", "")) * 1_000_000)
        return int(s)
    except Exception:
        return 0


# ── Fetch page ────────────────────────────────────────────────────────────────
def fetch_page(url: str) -> str:
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


# ── Regex-based fallback (more reliable than HTMLParser for this page) ────────
def parse_posts_regex(html: str) -> list[dict]:
    """Extract posts using regex — more robust than a custom HTML parser."""
    posts = []

    # Split into individual message blocks
    blocks = re.split(r'(?=<div class="tgme_widget_message_wrap)', html)

    for block in blocks:
        # ID from permalink
        id_m = re.search(r'tgme_widget_message_date[^>]*href="[^"]+/(\d+)"', block)
        if not id_m:
            continue
        msg_id = int(id_m.group(1))

        # Date
        date_m = re.search(r'<time[^>]+datetime="([^"]+)"', block)
        date = date_m.group(1) if date_m else None

        # Views
        views_m = re.search(r'tgme_widget_message_views[^>]*>([\d.,KMk\s]+)<', block)
        views = _parse_views(views_m.group(1)) if views_m else 0

        # Text
        text_m = re.search(
            r'tgme_widget_message_text[^>]*>(.*?)</div>',
            block, re.DOTALL
        )
        text = None
        text_html = None
        if text_m:
            raw = text_m.group(1)
            raw_br = re.sub(r'<br\s*/?>', '\n', raw)

            # Build text_html: keep <a> tags with proper attributes
            # Use a placeholder to protect rebuilt <a> tags from the tag-strip step
            _anchors: list[str] = []

            def _make_anchor(m):
                href = html_mod.unescape(m.group(1))
                inner_text = html_mod.unescape(
                    re.sub(r'<[^>]+>', '', m.group(2))
                ).strip()
                label = inner_text if (inner_text and not inner_text.startswith('http')) else href
                tag = f'<a href="{html_mod.escape(href)}" target="_blank" rel="noopener noreferrer">{html_mod.escape(label)}</a>'
                idx = len(_anchors)
                _anchors.append(tag)
                return f'\x00ANCHOR{idx}\x00'

            html_ver = re.sub(
                r'<a[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>',
                _make_anchor, raw_br, flags=re.DOTALL
            )
            # Strip remaining (non-anchor) HTML tags
            html_ver = re.sub(r'<[^>]+>', '', html_ver)
            html_ver = html_mod.unescape(html_ver)
            # Linkify bare URLs that weren't wrapped in <a>
            html_ver = re.sub(
                r'(https?://[^\s<>"]+)',
                r'<a href="\1" target="_blank" rel="noopener noreferrer">\1</a>',
                html_ver
            )
            # Restore protected anchor tags
            for idx, tag in enumerate(_anchors):
                html_ver = html_ver.replace(f'\x00ANCHOR{idx}\x00', tag)
            html_ver = html_ver.replace('\n', '<br>')
            text_html = html_ver.strip() or None

            # Build plain text: use display label for anchored links
            def _keep_href(m):
                href = html_mod.unescape(m.group(1))
                inner = html_mod.unescape(
                    re.sub(r'<[^>]+>', '', m.group(2))
                ).strip()
                if not inner or inner == href or inner.startswith('http'):
                    return href
                return inner  # just the display label, no URL
            plain = re.sub(
                r'<a[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>',
                _keep_href, raw_br, flags=re.DOTALL
            )
            plain = re.sub(r'<[^>]+>', '', plain)
            plain = html_mod.unescape(plain)
            text = plain.strip() or None

        # Photos
        photos = re.findall(
            r'tgme_widget_message_photo_wrap[^>]+style="[^"]*url\(\'([^\']+)\'\)', block
        )

        # Video
        has_video = bool(re.search(r'tgme_widget_message_video', block))

        # Comments URL (from linked discussion group)
        comments_m = re.search(
            r'<a[^>]+href="(https://t\.me/[^"]+)"[^>]*>[^<]*'
            r'<span[^>]*tgme_widget_message_replies_count[^>]*>',
            block, re.DOTALL
        )
        if not comments_m:
            comments_m = re.search(
                r'tgme_widget_message_replies[^>]*href="([^"]+)"', block
            )
        if not comments_m:
            comments_m = re.search(
                r'<a[^>]+href="([^"]+)"[^>]*class="[^"]*tgme_widget_message_replies[^"]*"',
                block
            )
        comments_url = comments_m.group(1) if comments_m else None

        if not text and not photos and not has_video:
            continue  # skip empty / service messages

        posts.append({
            "id":           msg_id,
            "text":         text,
            "text_html":    text_html,
            "date":         date,
            "views":        views,
            "forwards":     0,
            "photos":       photos,
            "video_path":   None,
            "gif_path":     None,
            "has_video":    has_video,
            "comments_url": comments_url,
        })

    return posts


# ── Load / save ───────────────────────────────────────────────────────────────
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
    log.info(f"Saved {len(data['posts'])} posts → {DATA_FILE}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    data   = load_existing()
    merged = {p["id"]: p for p in data["posts"]}

    # Paginate: fetch pages until we reach LIMIT or run out of posts
    before_id = None
    total_fetched = 0
    fetched_ids: set[int] = set()

    while total_fetched < LIMIT:
        url = BASE_URL if before_id is None else f"{BASE_URL}?before={before_id}"
        log.info(f"Fetching {url}")
        try:
            html = fetch_page(url)
        except Exception as e:
            log.error(f"Failed to fetch page: {e}")
            break

        page_posts = parse_posts_regex(html)
        log.info(f"Parsed {len(page_posts)} posts from page")

        if not page_posts:
            log.info("No posts found on page, stopping.")
            break

        for p in page_posts:
            merged[p["id"]] = p
            fetched_ids.add(p["id"])

        total_fetched += len(page_posts)
        before_id = min(p["id"] for p in page_posts)

        if len(page_posts) < 5:
            # Likely reached the beginning of the channel
            log.info("Too few posts on page, stopping pagination.")
            break

        time.sleep(1)  # be polite to Telegram servers

    # Remove posts that were deleted from the channel:
    # Any post whose ID falls within the scraped range but wasn't found → deleted.
    if fetched_ids:
        min_fetched = min(fetched_ids)
        deleted = [pid for pid in list(merged) if pid >= min_fetched and pid not in fetched_ids]
        for pid in deleted:
            log.info(f"Removing deleted post {pid}")
            del merged[pid]

    all_sorted = sorted(merged.values(), key=lambda p: p.get("date") or "", reverse=True)
    data["posts"] = all_sorted[:LIMIT]
    log.info(f"Total unique posts collected: {len(merged)}, saving top {len(data['posts'])}")
    save(data)


if __name__ == "__main__":
    main()
