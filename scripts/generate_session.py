"""
Run this script ONCE locally to generate a Telethon StringSession using a Bot Token.
No SMS code required — only a bot token from @BotFather.

Steps:
  1. Go to @BotFather in Telegram → /newbot → copy the token
  2. Run: pip install telethon python-dotenv
  3. Run: python scripts/generate_session.py
  4. Copy the printed session string → add as GitHub Secret TELEGRAM_SESSION_STR
"""

import asyncio
import os
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.sessions import StringSession

load_dotenv("tg-feed/backend/.env")

API_ID   = int(os.environ.get("TELEGRAM_API_ID") or input("Enter API_ID: "))
API_HASH = os.environ.get("TELEGRAM_API_HASH") or input("Enter API_HASH: ")
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN") or input("Enter Bot Token (from @BotFather): ")


async def main():
    print("\nConnecting with bot token...")

    client = TelegramClient(StringSession(), API_ID, API_HASH)
    await client.start(bot_token=BOT_TOKEN)

    session_string = client.session.save()
    await client.disconnect()

    print("\n" + "=" * 60)
    print("SUCCESS! Your session string (add as GitHub Secret):")
    print("=" * 60)
    print(session_string)
    print("=" * 60)
    print("\nSecret name: TELEGRAM_SESSION_STR")
    print("Go to: GitHub repo → Settings → Secrets and variables → Actions → New repository secret")


asyncio.run(main())
