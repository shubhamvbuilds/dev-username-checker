CREATE TABLE IF NOT EXISTS results (
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  method TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (platform, name)
);
