-- Asset Model Tracker — TimescaleDB schema
-- Run once against your cloud TimescaleDB instance as a superuser.

-- 1. Positions reference table
CREATE TABLE IF NOT EXISTS positions (
    name         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description  TEXT
);

INSERT INTO positions (name, display_name, description) VALUES
    ('pump_housing',  'Pump Housing',  'Main pump body assembly'),
    ('icv_flapper',   'ICV Flapper',   'Inlet check valve flapper'),
    ('icv_spring',    'ICV Spring',    'Inlet check valve spring'),
    ('dcv_poppet',    'DCV Poppet',    'Discharge check valve poppet'),
    ('dcv_spring',    'DCV Spring',    'Discharge check valve spring'),
    ('lp_seal_group', 'LP Seal Group', 'Low-pressure seal group'),
    ('hp_seal_group',  'HP Seal Group',  'High-pressure seal group'),
    ('piston',         'Piston',         'Pump piston assembly'),
    ('retaining_ring', 'Retaining Ring', 'Retaining ring'),
    ('head_block',     'Head Block',     'Head block assembly')
ON CONFLICT (name) DO NOTHING;

-- 2. Append-only change event log
CREATE TABLE IF NOT EXISTS change_events (
    id                      BIGSERIAL    NOT NULL,
    effective_time          TIMESTAMPTZ  NOT NULL,
    recorded_time           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    position                TEXT         NOT NULL REFERENCES positions(name),
    removed_part_number     TEXT,
    removed_part_revision   TEXT,
    removed_part_serial     TEXT,
    installed_part_number   TEXT,
    installed_part_revision TEXT,
    installed_part_serial   TEXT,
    changed_by              TEXT         NOT NULL DEFAULT session_user,
    note                    TEXT,
    PRIMARY KEY (id, effective_time)
);

-- Convert to hypertable (TimescaleDB), partitioned by effective_time
SELECT create_hypertable(
    'change_events', 'effective_time',
    if_not_exists => TRUE,
    migrate_data  => TRUE
);

CREATE INDEX IF NOT EXISTS idx_change_events_position
    ON change_events (position, effective_time DESC, recorded_time DESC);

-- 3. Engineer role (SELECT + INSERT only — no UPDATE/DELETE)
--    Add more roles here as needed by copying the block below.
-- CREATE ROLE engineer1 LOGIN PASSWORD 'changeme';
GRANT CONNECT ON DATABASE "csh2-database" TO engineer1;
GRANT USAGE ON SCHEMA public TO engineer1;
GRANT SELECT, INSERT ON TABLE positions, change_events TO engineer1;
GRANT USAGE, SELECT ON SEQUENCE change_events_id_seq TO engineer1;

-- 4. Read-only role for downstream apps (simulator, etc.)
-- CREATE ROLE app_readonly LOGIN PASSWORD 'changeme';
GRANT CONNECT ON DATABASE "csh2-database" TO app_readonly;
GRANT USAGE ON SCHEMA public TO app_readonly;
GRANT SELECT ON TABLE positions, change_events TO app_readonly;
