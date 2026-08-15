"""
Hub.OS Telegram Bot — DuckMail Automation
==========================================
- Auth guard: /login <secret_token> saves chat_id → authorized_chats.json
- /add: auto-generate a DuckMail account → sync to Firestore admin_mail_vault

Dependencies: pyTelegramBotAPI, requests, firebase-admin
"""

import os
import json
import random
import string
import secrets
import requests
import telebot
from telebot import types
from datetime import timezone
import firebase_admin
from firebase_admin import credentials, firestore

# ──────────────────────────────────────────────────────────────
# CONFIGURATION
# ──────────────────────────────────────────────────────────────

BOT_TOKEN = "8872135307:AAEjRKSoZbpT4s6aNdnphlREwFWci_R4n1k"
SECRET_LOGIN_TOKEN = "hub-os-admin-2026"  # Change this to your actual secret
DUCKMAIL_BASE_URL = "https://api.duckmail.sbs"
AUTHORIZED_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "authorized_chats.json")

# ──────────────────────────────────────────────────────────────
# FIREBASE ADMIN SDK — INITIALIZATION
# ──────────────────────────────────────────────────────────────

FIREBASE_SERVICE_ACCOUNT_KEY = {
    "type": "service_account",
    "project_id": "hubos-6b7ac",
    "private_key_id": "YOUR_PRIVATE_KEY_ID",  # ← Replace with real service-account key
    "private_key": "-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n",
    "client_email": "firebase-adminsdk-xxxxx@hubos-6b7ac.iam.gserviceaccount.com",
    "client_id": "YOUR_CLIENT_ID",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xxxxx%40hubos-6b7ac.iam.gserviceaccount.com"
}

# ── Override service account from env var JSON file path if provided ──
SERVICE_ACCOUNT_PATH = os.environ.get("FIREBASE_KEY_PATH", None)
USE_EMULATOR = os.environ.get("FIRESTORE_EMULATOR_HOST", None)

_fb_app = None
_fb_db = None


def _init_firebase():
    """Initialize Firebase Admin SDK. Tries env var path first, falls back to embedded dict."""
    global _fb_app, _fb_db

    try:
        if SERVICE_ACCOUNT_PATH and os.path.exists(SERVICE_ACCOUNT_PATH):
            cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        else:
            cred = credentials.Certificate(FIREBASE_SERVICE_ACCOUNT_KEY)

        _fb_app = firebase_admin.initialize_app(cred)
        _fb_db = firestore.client()
        print("[Bot] Firebase Admin SDK initialized successfully.")
    except Exception as e:
        print(f"[Bot] Firebase Admin SDK init FAILED: {e}")
        _fb_db = None


_init_firebase()

# ──────────────────────────────────────────────────────────────
# AUTHORIZATION MANAGEMENT
# ──────────────────────────────────────────────────────────────


def _load_authorized_chats():
    """Read authorized_chats.json → set of int chat_id."""
    try:
        with open(AUTHORIZED_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return {int(entry) for entry in data}
            return set()
    except (FileNotFoundError, json.JSONDecodeError):
        return set()


def _save_authorized_chats(chat_ids):
    """Persist the set of authorized chat IDs to disk."""
    try:
        with open(AUTHORIZED_FILE, "w", encoding="utf-8") as f:
            json.dump(sorted(list(chat_ids)), f, indent=2)
    except Exception as e:
        print(f"[Bot] Failed to write authorized_chats.json: {e}")


def _is_authorized(chat_id):
    """Check if a chat_id is in the authorized set."""
    return int(chat_id) in _load_authorized_chats()


# ──────────────────────────────────────────────────────────────
# DUCKMAIL API HELPERS
# ──────────────────────────────────────────────────────────────


def _random_username(length=10):
    """Generate a random lowercase alphanumeric username."""
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choices(chars, k=length))


def _random_password(length=16):
    """Generate a strong random password (≥6 chars)."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    # Ensure at least one uppercase, one digit, one symbol
    pwd = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.digits),
        secrets.choice("!@#$%^&*"),
    ]
    pwd += [secrets.choice(alphabet) for _ in range(length - 3)]
    random.shuffle(pwd)
    return ''.join(pwd)


def _pick_random_domain():
    """Fetch verified DuckMail domains and pick one at random."""
    try:
        resp = requests.get(f"{DUCKMAIL_BASE_URL}/domains", timeout=10)
        if resp.status_code == 200:
            body = resp.json()
            members = body.get("hydra:member", [])
            if members:
                domain_objs = [d for d in members if d.get("isVerified")]
                if domain_objs:
                    chosen = random.choice(domain_objs)
                    return chosen["domain"]
        # Fallback: use a well-known public DuckMail domain
        return "duckmail.sbs"
    except Exception as e:
        print(f"[Bot] Domain fetch failed, using fallback: {e}")
        return "duckmail.sbs"


def _create_duckmail_account(address, password):
    """POST /accounts to create the DuckMail inbox. Returns (ok, detail_or_error)."""
    try:
        payload = {
            "address": address,
            "password": password,
            "expiresIn": 0  # Never expires
        }
        resp = requests.post(
            f"{DUCKMAIL_BASE_URL}/accounts",
            json=payload,
            timeout=10
        )
        if resp.status_code == 201:
            return True, resp.json()
        else:
            error_msg = resp.json().get("message", resp.text) if resp.text else "Unknown error"
            return False, f"HTTP {resp.status_code}: {error_msg}"
    except requests.exceptions.RequestException as e:
        return False, f"Network error: {e}"


def _get_jwt_token(address, password):
    """POST /token to obtain the Bearer JWT. Returns (ok, token_or_error)."""
    try:
        payload = {"address": address, "password": password}
        resp = requests.post(
            f"{DUCKMAIL_BASE_URL}/token",
            json=payload,
            timeout=10
        )
        if resp.status_code == 200:
            body = resp.json()
            return True, body.get("token", "")
        else:
            error_msg = resp.json().get("message", resp.text) if resp.text else "Unknown error"
            return False, f"HTTP {resp.status_code}: {error_msg}"
    except requests.exceptions.RequestException as e:
        return False, f"Network error: {e}"


def _save_to_firestore(email, password, jwt_token, mail_type="DuckMail"):
    """Save a new document to the admin_mail_vault Firestore collection."""
    if _fb_db is None:
        print("[Bot] Firestore not initialized — skipping cloud save.")
        return False

    try:
        doc_ref = _fb_db.collection("admin_mail_vault").document()
        doc_ref.set({
            "email": email,
            "password": password,
            "jwt_token": jwt_token,
            "type": mail_type,
            "created_at": firestore.SERVER_TIMESTAMP
        })
        print(f"[Bot] Saved to Firestore admin_mail_vault → {email}")
        return True
    except Exception as e:
        print(f"[Bot] Firestore save failed: {e}")
        return False


# ──────────────────────────────────────────────────────────────
# TELEGRAM BOT SETUP
# ──────────────────────────────────────────────────────────────

bot = telebot.TeleBot(BOT_TOKEN, parse_mode="HTML")


# ── Auth Guard Message Handler (checks BEFORE every command) ──


def _auth_required(func):
    """Decorator: blocks command if chat_id is not in authorized_chats.json."""

    def wrapper(message):
        chat_id = message.chat.id
        if _is_authorized(chat_id):
            return func(message)
        else:
            bot.reply_to(
                message,
                (
                    "🚫 <b>Access Denied</b>\n\n"
                    "You are not authorized to use this bot.\n"
                    "Use <code>/login &lt;secret_token&gt;</code> to authenticate."
                ),
                parse_mode="HTML"
            )
    return wrapper


# ──────────────────────────────────────────────────────────────
# /start — Friendly intro
# ──────────────────────────────────────────────────────────────


@bot.message_handler(commands=["start"])
def cmd_start(message):
    chat_id = message.chat.id
    authorized = _is_authorized(chat_id)

    if authorized:
        intro = (
            "🦆 <b>Hub.OS DuckMail Bot — Active</b>\n\n"
            "You are <b>authorized</b>. Available commands:\n"
            "  /add — Generate a new DuckMail account\n"
            "  /status — Show your authorization status\n"
        )
    else:
        intro = (
            "🦆 <b>Hub.OS DuckMail Bot</b>\n\n"
            "Welcome! You are <b>not authorized</b> yet.\n"
            "Use <code>/login &lt;secret_token&gt;</code> to gain access."
        )

    bot.reply_to(message, intro, parse_mode="HTML")


# ──────────────────────────────────────────────────────────────
# /login <secret_token> — Authorize this chat
# ──────────────────────────────────────────────────────────────


@bot.message_handler(commands=["login"])
def cmd_login(message):
    chat_id = message.chat.id
    parts = message.text.strip().split(maxsplit=1)
    token = parts[1].strip() if len(parts) > 1 else ""

    if not token:
        bot.reply_to(
            message,
            "⚠️ Usage: <code>/login &lt;secret_token&gt;</code>",
            parse_mode="HTML"
        )
        return

    if _is_authorized(chat_id):
        bot.reply_to(
            message,
            "✅ You are <b>already authorized</b>. No need to log in again.",
            parse_mode="HTML"
        )
        return

    if token == SECRET_LOGIN_TOKEN:
        authorized = _load_authorized_chats()
        authorized.add(int(chat_id))
        _save_authorized_chats(authorized)
        bot.reply_to(
            message,
            (
                "🔓 <b>Authorization Granted</b>\n\n"
                "Your chat ID has been added to the authorized list.\n"
                "You can now use <code>/add</code> to generate DuckMail accounts.\n"
                "Use <code>/status</code> to verify."
            ),
            parse_mode="HTML"
        )
        print(f"[Bot] Chat {chat_id} authorized via /login.")
    else:
        bot.reply_to(
            message,
            "❌ <b>Invalid Token</b>\n\nAccess denied. Please check your secret token and try again.",
            parse_mode="HTML"
        )


# ──────────────────────────────────────────────────────────────
# /add — Auto-generate a DuckMail account
# ──────────────────────────────────────────────────────────────


@bot.message_handler(commands=["add"])
@_auth_required
def cmd_add(message):
    chat_id = message.chat.id

    # ── Step 1: Tell user we're working ──
    status_msg = bot.reply_to(
        message,
        "⏳ <b>Generating DuckMail account...</b>\n\n"
        "▸ Picking a verified domain...\n"
        "▸ Creating account...\n"
        "▸ Fetching JWT token...\n"
        "▸ Syncing to Firestore...",
        parse_mode="HTML"
    )

    # ── Step 2: Pick a domain ──
    domain = _pick_random_domain()

    # ── Step 3: Generate credentials ──
    username = _random_username()
    password = _random_password()
    address = f"{username}@{domain}"

    # ── Step 4: Create the account via DuckMail API ──
    ok, result = _create_duckmail_account(address, password)
    if not ok:
        bot.edit_message_text(
            f"❌ <b>Account Creation Failed</b>\n\n"
            f"<b>Address:</b> <code>{address}</code>\n"
            f"<b>Error:</b> {result}\n\n"
            f"The domain '{domain}' may be unavailable. Try /add again.",
            chat_id=chat_id,
            message_id=status_msg.message_id,
            parse_mode="HTML"
        )
        return

    # ── Step 5: Get the JWT token ──
    jwt_ok, jwt_result = _get_jwt_token(address, password)
    jwt_token = jwt_result if jwt_ok else "FAILED_TO_OBTAIN"

    # ── Step 6: Save to Firestore ──
    fire_ok = _save_to_firestore(address, password, jwt_token, "DuckMail")

    # ── Step 7: Report back to user ──
    fire_status = "✅ Synced to Firestore" if fire_ok else "⚠️ Firestore save failed (check server logs)"

    success_text = (
        f"🦆 <b>DuckMail Account Ready</b>\n\n"
        f"📧 <b>Email:</b> <code>{address}</code>\n"
        f"🔑 <b>Password:</b> <code>{password}</code>\n"
        f"🎫 <b>JWT:</b> <code>{jwt_token[:40]}...</code>\n\n"
        f"<i>{fire_status}</i>\n\n"
        f"Use /add to generate another."
    )

    bot.edit_message_text(
        success_text,
        chat_id=chat_id,
        message_id=status_msg.message_id,
        parse_mode="HTML"
    )


# ──────────────────────────────────────────────────────────────
# /status — Check authorization status
# ──────────────────────────────────────────────────────────────


@bot.message_handler(commands=["status"])
def cmd_status(message):
    chat_id = message.chat.id
    authorized = _is_authorized(chat_id)

    if authorized:
        bot.reply_to(
            message,
            (
                "✅ <b>Status: Authorized</b>\n\n"
                f"Chat ID: <code>{chat_id}</code>\n"
                "You can use /add to generate DuckMail accounts."
            ),
            parse_mode="HTML"
        )
    else:
        bot.reply_to(
            message,
            (
                "🔒 <b>Status: Not Authorized</b>\n\n"
                f"Chat ID: <code>{chat_id}</code>\n"
                "Use <code>/login &lt;secret_token&gt;</code> to authenticate."
            ),
            parse_mode="HTML"
        )


# ──────────────────────────────────────────────────────────────
# FALLBACK — Block all non-command text from unauthorized users
# ──────────────────────────────────────────────────────────────


@bot.message_handler(func=lambda m: True)
def fallback_handler(message):
    chat_id = message.chat.id
    if _is_authorized(chat_id):
        bot.reply_to(
            message,
            (
                "🤖 Use these commands:\n"
                "  /add — Generate a DuckMail account\n"
                "  /status — Check your authorization status\n"
                "  /start — Show intro message"
            ),
            parse_mode="HTML"
        )
    else:
        bot.reply_to(
            message,
            (
                "🚫 <b>Unauthorized</b>\n\n"
                "You must log in first.\n"
                "Use <code>/login &lt;secret_token&gt;</code>"
            ),
            parse_mode="HTML"
        )


# ──────────────────────────────────────────────────────────────
# MAIN — START POLLING
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    authorized = _load_authorized_chats()
    print(f"[Bot] Loaded {len(authorized)} authorized chat(s): {authorized}")
    print("[Bot] Starting polling...")
    bot.infinity_polling(timeout=30, long_polling_timeout=15)