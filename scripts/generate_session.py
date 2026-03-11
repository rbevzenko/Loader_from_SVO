"""
Run this script ONCE locally to generate a Telethon StringSession
using your personal Telegram account (phone number + SMS code).

A USER session (not bot) is required because GetDiscussionMessageRequest
and GetRepliesRequest are only available to user accounts.

Steps:
  1. Get API credentials: https://my.telegram.org → Apps → create app
  2. Run: pip install telethon
  3. Run: python scripts/generate_session.py
  4. Enter your phone number, then the code from Telegram
  5. Copy the printed session string → add as GitHub Secret TELEGRAM_SESSION_STR

Note: The account must be a member of the comments group (loaderfromSVOchat)
to be able to read comments.
"""

import asyncio
import os
from telethon import TelegramClient
from telethon.sessions import StringSession

API_ID   = int(os.environ.get("TELEGRAM_API_ID") or input("Enter API_ID: "))
API_HASH = os.environ.get("TELEGRAM_API_HASH") or input("Enter API_HASH: ")


async def main():
    print("\nConnecting with user account...")
    print("You will receive a login code in Telegram.\n")

    client = TelegramClient(StringSession(), API_ID, API_HASH)
    await client.start()  # prompts phone number + SMS/app code interactively

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
