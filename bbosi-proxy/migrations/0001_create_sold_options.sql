CREATE TABLE IF NOT EXISTS sold_options (
  id TEXT PRIMARY KEY,
  option_ticker TEXT NOT NULL,
  stock_ticker TEXT NOT NULL,
  strike REAL NOT NULL,
  sell_price REAL NOT NULL,
  sell_date TEXT NOT NULL,
  expiration TEXT NOT NULL,
  trading_days INTEGER NOT NULL,
  nv REAL NOT NULL,
  ve REAL NOT NULL,
  vdxx REAL NOT NULL,
  lastro_percent REAL NOT NULL,
  bbosi REAL NOT NULL,
  stock_price REAL NOT NULL,
  option_price REAL NOT NULL,
  last_refresh TEXT,
  updated_at TEXT NOT NULL
);