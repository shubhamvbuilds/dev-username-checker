-- Cache v2: WITHOUT ROWID (one B-tree, so one row written per upsert instead of
-- two) and a checker `version` so a checker fix can invalidate old rows by
-- bumping CHECKER_VERSION. Cached rows are disposable, so the table is rebuilt.
DROP TABLE IF EXISTS results;

CREATE TABLE results (
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  method TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY (platform, name)
) WITHOUT ROWID;

-- A platform that answered 403/429 is left alone until `until` (epoch ms).
CREATE TABLE IF NOT EXISTS blocks (
  platform TEXT PRIMARY KEY,
  until INTEGER NOT NULL
) WITHOUT ROWID;
