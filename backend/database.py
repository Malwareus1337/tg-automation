import sqlite3
import os
import time
from contextlib import contextmanager

DB_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(DB_DIR, "data.db")

def init_db():
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        
        # Accounts table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS accounts (
            phone TEXT PRIMARY KEY,
            api_id INTEGER,
            api_hash TEXT,
            session_name TEXT,
            status TEXT,
            flood_until INTEGER DEFAULT 0
        )
        """)
        
        # Scraped members table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS scraped_members (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            source_group TEXT,
            last_active TEXT,
            scraped_at INTEGER,
            status TEXT DEFAULT 'pending'
        )
        """)
        
        # Settings table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
        """)
        
        # Insert default settings
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('min_delay', '30')")
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('max_delay', '90')")
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('daily_limit_per_account', '30')")
        
        conn.commit()
    finally:
        conn.close()

class Database:
    def __init__(self):
        init_db()
        
    @contextmanager
    def _get_connection(self):
        conn = sqlite3.connect(DB_PATH, timeout=30.0)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        try:
            yield conn
        finally:
            conn.close()
        
    # Account Management
    def add_or_update_account(self, phone, api_id, api_hash, session_name, status="need_login", flood_until=0):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            INSERT OR REPLACE INTO accounts (phone, api_id, api_hash, session_name, status, flood_until)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (phone, api_id, api_hash, session_name, status, flood_until))
            conn.commit()
            
    def get_accounts(self):
        now = int(time.time())
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE accounts SET status = 'active', flood_until = 0 WHERE status = 'flood_wait' AND flood_until <= ?", (now,))
            conn.commit()
            
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM accounts")
            return [dict(row) for row in cursor.fetchall()]
            
    def get_active_accounts(self):
        now = int(time.time())
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM accounts WHERE status = 'active' AND flood_until <= ?", (now,))
            return [dict(row) for row in cursor.fetchall()]
            
    def update_account_status(self, phone, status, flood_until=0):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE accounts SET status = ?, flood_until = ? WHERE phone = ?", (status, flood_until, phone))
            conn.commit()
            
    def delete_account(self, phone):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM accounts WHERE phone = ?", (phone,))
            conn.commit()

    # Scraped Members Management
    def save_scraped_members(self, members):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            for m in members:
                cursor.execute("""
                INSERT OR REPLACE INTO scraped_members (user_id, username, first_name, last_name, source_group, last_active, scraped_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
                """, (m['user_id'], m.get('username'), m.get('first_name'), m.get('last_name'), m['source_group'], m.get('last_active'), m['scraped_at']))
            conn.commit()
            
    def get_scraped_members(self, status=None, limit=1000):
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            if status:
                cursor.execute("SELECT * FROM scraped_members WHERE status = ? LIMIT ?", (status, limit))
            else:
                cursor.execute("SELECT * FROM scraped_members LIMIT ?", (limit,))
            return [dict(row) for row in cursor.fetchall()]
            
    def update_member_status(self, user_id, status):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE scraped_members SET status = ? WHERE user_id = ?", (status, user_id))
            conn.commit()
            
    def clear_scraped_members(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM scraped_members")
            conn.commit()

    # Settings Management
    def get_settings(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT key, value FROM settings")
            return {row[0]: row[1] for row in cursor.fetchall()}
            
    def update_setting(self, key, value):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, str(value)))
            conn.commit()

