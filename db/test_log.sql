-- test_log: engineer-entered test windows with time boundaries
-- Plain table (NOT a hypertable) — expected volume is a few hundred rows/year.
-- Times stored as UTC; the entry form converts local ET → UTC explicitly.

CREATE TABLE IF NOT EXISTS test_log (
    test_id      text          PRIMARY KEY,
    test_name    text          NOT NULL,
    start_utc    timestamptz   NOT NULL,
    end_utc      timestamptz   NULL,
    summary      text          NULL,
    objective    text          NULL,
    known_issues text          NULL,
    operator     text          NULL      DEFAULT current_user,
    created_at   timestamptz   NOT NULL  DEFAULT now(),
    updated_at   timestamptz   NOT NULL  DEFAULT now(),

    CONSTRAINT end_after_start CHECK (end_utc IS NULL OR end_utc > start_utc)
);

CREATE INDEX IF NOT EXISTS idx_test_log_start ON test_log (start_utc);
CREATE INDEX IF NOT EXISTS idx_test_log_window ON test_log (start_utc, end_utc);

-- Trigger: keep updated_at current on every UPDATE
CREATE OR REPLACE FUNCTION update_test_log_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_test_log_updated_at ON test_log;
CREATE TRIGGER trg_test_log_updated_at
    BEFORE UPDATE ON test_log
    FOR EACH ROW
    EXECUTE FUNCTION update_test_log_updated_at();

-- NOTE: GRANT SELECT ON test_log TO agent_ro should be run on the
-- forked read-only database only, not on the primary.

-- Column comments
COMMENT ON TABLE test_log IS 'Engineer-entered test windows. Supplies time boundaries that the historian (procdatafloattable) cannot provide.';
COMMENT ON COLUMN test_log.test_id IS 'Human convention, e.g. 2026-09-04_A. Tolerates multiple tests per date.';
COMMENT ON COLUMN test_log.test_name IS 'Short human label, e.g. AOV step-down.';
COMMENT ON COLUMN test_log.start_utc IS 'Test window start in UTC. Entry form converts local ET → UTC explicitly.';
COMMENT ON COLUMN test_log.end_utc IS 'Test window end in UTC. NULL means in progress or not yet recorded.';
COMMENT ON COLUMN test_log.summary IS 'Free prose: what happened, in the engineer''s own words.';
COMMENT ON COLUMN test_log.objective IS 'Free prose: what the test was trying to learn.';
COMMENT ON COLUMN test_log.known_issues IS 'Free prose: data defects specific to THIS test.';
COMMENT ON COLUMN test_log.operator IS 'Who entered/ran the test. Defaults to current_user.';
COMMENT ON COLUMN test_log.updated_at IS 'Maintained by trigger — changes on every UPDATE.';
