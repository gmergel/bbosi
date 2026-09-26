CREATE TABLE telegram_chat (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  chat_id TEXT NOT NULL
);

CREATE TABLE telegram_link (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE telegram_alert_state (
  position_id TEXT PRIMARY KEY,
  sell_price REAL NOT NULL,
  level TEXT NOT NULL,
  quote_time TEXT NOT NULL,
  claimed_until TEXT
);