-- Tera Live initial schema.
-- Privacy: no user location, no IP address and no raw device id is ever stored.
-- device_hash and rate-limit keys are salted SHA-256 digests (see src/hash.ts).

-- Raw rider reports. Pruned after 30 days by the scheduled handler; the
-- long-term signal lives in hourly_stats.
CREATE TABLE reports (
  id          INTEGER PRIMARY KEY,
  station_id  TEXT    NOT NULL,
  direction   TEXT    NOT NULL,
  queue       INTEGER NOT NULL CHECK (queue BETWEEN 0 AND 3),  -- none, short, long, very_long
  taxis       INTEGER NOT NULL CHECK (taxis BETWEEN 0 AND 2),  -- waiting, arriving, none
  created_at  INTEGER NOT NULL,                                -- epoch ms
  device_hash TEXT    NOT NULL,
  source      TEXT    NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'telegram'))
);
CREATE INDEX idx_reports_time            ON reports (created_at);
CREATE INDEX idx_reports_station_time    ON reports (station_id, created_at);
CREATE INDEX idx_reports_device_time     ON reports (device_hash, created_at);

-- Running totals per station x direction x Addis weekday x hour, used for the
-- "usually at this hour" estimate. Anonymous by construction.
CREATE TABLE hourly_stats (
  station_id    TEXT    NOT NULL,
  direction     TEXT    NOT NULL,
  weekday       INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  hour          INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  n             INTEGER NOT NULL DEFAULT 0,
  queue_sum     INTEGER NOT NULL DEFAULT 0,
  taxis_waiting INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (station_id, direction, weekday, hour)
) WITHOUT ROWID;

-- Fixed-window counters for rate limiting. key = '<scope>:<hash>'.
CREATE TABLE rate_limits (
  key          TEXT    NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
) WITHOUT ROWID;
