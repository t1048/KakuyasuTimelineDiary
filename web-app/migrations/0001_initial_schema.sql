-- Kakuyasu Timeline Diary - D1 Database Schema
-- Migration: 0001_initial_schema
-- DynamoDB to D1 (SQL) migration

-- 日記/イベント記録（1日1レコード）
-- DynamoDB mapping: pk=USER#{userId}#YEAR#{year}, sk=DATE#{YYYY-MM-DD}
CREATE TABLE diary_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    year INTEGER NOT NULL,
    date TEXT NOT NULL,  -- YYYY-MM-DD format
    ordered_items TEXT NOT NULL,  -- JSON array (ActivityPub OrderedCollection format)
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date)
);

-- Indexes for efficient querying
CREATE INDEX idx_user_year_date ON diary_records(user_id, year, date);

-- 同意記録
-- DynamoDB mapping: pk=USER#{userId}, sk=CONSENT
CREATE TABLE user_consents (
    user_id TEXT PRIMARY KEY,
    agreed BOOLEAN NOT NULL DEFAULT 0,
    version TEXT NOT NULL,
    agreed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 月間アップロードカウンター
-- DynamoDB mapping: pk=USER#{userId}#UPLOADS, sk=MONTH#{YYYY-MM}
CREATE TABLE monthly_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    month TEXT NOT NULL,  -- YYYY-MM format
    image_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, month)
);

CREATE INDEX idx_uploads_user_month ON monthly_uploads(user_id, month);
