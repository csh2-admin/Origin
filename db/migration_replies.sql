-- Field note replies and notification tracking
-- Run this on the live database before deploying

CREATE TABLE IF NOT EXISTS field_note_replies (
    id SERIAL PRIMARY KEY,
    memo_id INTEGER NOT NULL REFERENCES memo_log(id) ON DELETE CASCADE,
    author VARCHAR(100) NOT NULL,
    reply_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replies_memo_id ON field_note_replies(memo_id);
CREATE INDEX IF NOT EXISTS idx_replies_created_at ON field_note_replies(created_at);

CREATE TABLE IF NOT EXISTS notification_reads (
    username VARCHAR(100) PRIMARY KEY,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
