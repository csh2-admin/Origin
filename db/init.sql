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
    ('retaining_ring', 'Retainer Ring',        'Retainer ring'),
    ('head_block',     'Cylinder Head Block', 'Cylinder head block assembly'),
    ('inline_dcv',     'In-Line DCV',    'In-line discharge check valve (optional)')
ON CONFLICT (name) DO NOTHING;

-- 2. Parts catalog — reference table of valid part numbers per position
CREATE TABLE IF NOT EXISTS parts_catalog (
    part_number  TEXT NOT NULL,
    position     TEXT NOT NULL REFERENCES positions(name),
    description  TEXT,
    PRIMARY KEY (part_number, position)
);

INSERT INTO parts_catalog (part_number, position, description) VALUES
    ('20B102Z',    'pump_housing',  'Machined, original'),
    ('20B129Z',    'pump_housing',  'Machined w/ M90 threads'),
    ('20B105Z',    'piston',        'Piston, original'),
    ('20B131Z',    'piston',        'Modified / Rework Piston 38mm'),
    ('20B132Z',    'piston',        'Piston Configuration with tapered/rework shank, AND 2X rider ring config'),
    ('20C115Z',    'dcv_spring',    'DCV Spring'),
    ('20B103Z-1',  'dcv_poppet',    'SS316L'),
    ('20B103Z-3',  'dcv_poppet',    'AL Bronze Alloy C95200'),
    ('20B108Z',    'icv_flapper',   'Original design'),
    ('20C100Z',    'icv_spring',    'ICV Spring'),
    ('20B116Z',    'head_block',    'Original design'),
    ('20B128Z',    'head_block',    'Updated head block -144 seal size'),
    ('20B136Z',    'head_block',    'Updated head block (5.5mm on 30mm pattern dia)'),
    ('20B120Z',    'retaining_ring','Original design'),
    ('20B135Z',    'retaining_ring','M90 Retainer Ring (Original Thickness, No counterbores)'),
    ('20S108Z-5',  'hp_seal_group', 'Modified for new energizers'),
    ('20A110Z',    'lp_seal_group', 'Advanced EMC, v1'),
    ('20A112Z',    'lp_seal_group', 'Advanced EMC, v2'),
    ('20A113Z',    'lp_seal_group', 'Polymer Concepts'),
    ('20A111Z',    'lp_seal_group', 'Saint Gobain'),
    ('20A114Z',    'lp_seal_group', 'SKF re-design')
ON CONFLICT (part_number, position) DO NOTHING;

-- 3. Append-only change event log
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
GRANT SELECT, INSERT ON TABLE positions, change_events, parts_catalog TO engineer1;
GRANT USAGE, SELECT ON SEQUENCE change_events_id_seq TO engineer1;

-- 4. Read-only role for downstream apps (simulator, etc.)
-- CREATE ROLE app_readonly LOGIN PASSWORD 'changeme';
GRANT CONNECT ON DATABASE "csh2-database" TO app_readonly;
GRANT USAGE ON SCHEMA public TO app_readonly;
GRANT SELECT ON TABLE positions, change_events, parts_catalog TO app_readonly;
