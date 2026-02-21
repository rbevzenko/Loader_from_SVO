"""
Run this script ONCE locally to generate a Telethon StringSession.
Copy the printed string and add it as a GitHub Secret named TELEGRAM_SESSION_STR.

Usage:
  pip install telethon python-dotenv
  python scripts/generate_session.py
"""

import asyncio
import os
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.sessions import StringSession

load_dotenv("backend/.env")

API_ID   = int(os.environ.get("TELEGRAM_API_ID", input("Enter API_ID: ")))
API_HASH = os.environ.get("TELEGRAM_API_HASH") or input("Enter API_HASH: ")


async def main():
    print("\nStarting Telegram authorization...")
    print("You will be asked for your phone number and the confirmation code.\n")

    client = TelegramClient(StringSession(), API_ID, API_HASH)
    await client.start()

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
