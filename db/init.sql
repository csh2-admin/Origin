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
    ('retaining_ring', 'Cyl Head Retainer Ring', 'Cylinder head retainer ring'),
    ('head_block',     'Cylinder Head Block', 'Cylinder head block assembly'),
    ('inline_dcv',     'In-Line DCV',    'In-line discharge check valve (optional)'),
    ('motor',          'Motor',          'Drive motor'),
    ('crank_drive',    'Crank Drive',    'Crank drive mechanism connecting motor to pump heads'),
    ('press_plate',    'Cyl Head Press Plate', 'Cylinder head press plate between head block and retainer ring')
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

-- 5. Assembly instructions (editable step lists per sub-page)
CREATE TABLE IF NOT EXISTS assembly_instructions (
    id          BIGSERIAL PRIMARY KEY,
    sub_page    TEXT NOT NULL,  -- 'seal_installation', 'pump_assembly', 'pump_installation'
    step_order  INT NOT NULL,
    action      TEXT NOT NULL DEFAULT '',
    pns_tags    TEXT NOT NULL DEFAULT '',
    tools       TEXT NOT NULL DEFAULT '',
    torque_spec TEXT NOT NULL DEFAULT '',
    created_by  TEXT NOT NULL DEFAULT session_user,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assembly_instructions_page
    ON assembly_instructions (sub_page, step_order);

-- 6. Assembly runs — one per sub-page per pump head
CREATE TABLE IF NOT EXISTS assembly_runs (
    id          BIGSERIAL PRIMARY KEY,
    sub_page    TEXT NOT NULL,
    pump_head   INT NOT NULL,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    started_by  TEXT NOT NULL DEFAULT session_user,
    completed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_assembly_runs_active
    ON assembly_runs (sub_page, pump_head, completed_at);

-- 7. Assembly step logs — per-step completion within a run
CREATE TABLE IF NOT EXISTS assembly_step_logs (
    id              BIGSERIAL PRIMARY KEY,
    run_id          BIGINT NOT NULL REFERENCES assembly_runs(id) ON DELETE CASCADE,
    instruction_id  BIGINT NOT NULL REFERENCES assembly_instructions(id) ON DELETE CASCADE,
    step_order      INT NOT NULL,
    checked_at      TIMESTAMPTZ,
    torque_actual   TEXT,
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_assembly_step_logs_run
    ON assembly_step_logs (run_id, step_order);

INSERT INTO assembly_instructions (sub_page, step_order, action) VALUES
    ('startup_procedure', 1,  'Check Weather Conditions'),
    ('startup_procedure', 2,  'PPE: Hard Hat, Steel-toed Boots, FR clothing, Safety Glasses'),
    ('startup_procedure', 3,  'Inspect Container for damage or any leaks'),
    ('startup_procedure', 4,  'Check Electrical Grounding'),
    ('startup_procedure', 5,  'Clear area of hazards'),
    ('startup_procedure', 6,  'Note Process Fluid Supply Level (H20, LN2, H2)'),
    ('startup_procedure', 7,  'Confirm Emergency Response Plan Posted on-site'),
    ('startup_procedure', 8,  'Review Test Plan & Record Hazards & mitigations'),
    ('startup_procedure', 9,  'Power On - (If needed: Turn on Genset & note fuel level)'),
    ('startup_procedure', 10, 'Turn on UPS & lockout MCC panel'),
    ('startup_procedure', 11, 'Connect Air Supply & Verify Pressure - (if needed: Open N2 bottle & note level)'),
    ('startup_procedure', 12, 'Check ESD Functionality'),
    ('startup_procedure', 13, 'Clear all system alarms'),
    ('startup_procedure', 14, 'Enable GH2 & Flame Detector Alarms (Config/Analog&Manual/AnalogAlarmEnable)'),
    ('startup_procedure', 15, 'Confirm Grafana/SQL logging'),
    ('startup_procedure', 16, 'Verify control of the system through HMI'),
    ('startup_procedure', 17, 'System Purge (if required)'),
    ('startup_procedure', 18, 'Confirm Monitoring Camera operation')
ON CONFLICT DO NOTHING;

INSERT INTO assembly_instructions (sub_page, step_order, action) VALUES
    ('shutdown_procedure', 1, 'Data integrity check'),
    ('shutdown_procedure', 2, 'System Purge or Ensure Valve positions'),
    ('shutdown_procedure', 3, 'Shutoff Air Supply'),
    ('shutdown_procedure', 4, 'Put air compressor away in container/building'),
    ('shutdown_procedure', 5, 'Turn off container lights'),
    ('shutdown_procedure', 6, 'Power off & lockout genset (note fuel level)'),
    ('shutdown_procedure', 7, 'Turn off UPS & lockout MCC'),
    ('shutdown_procedure', 8, 'Lock up all doors - 4 padlocks on container, 2 on MCC, main container swinging door, generator HMI panel, fencing')
ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE assembly_instructions TO engineer1;
GRANT USAGE, SELECT ON SEQUENCE assembly_instructions_id_seq TO engineer1;
GRANT SELECT, INSERT, UPDATE ON TABLE assembly_runs TO engineer1;
GRANT USAGE, SELECT ON SEQUENCE assembly_runs_id_seq TO engineer1;
GRANT SELECT, INSERT, UPDATE ON TABLE assembly_step_logs TO engineer1;
GRANT USAGE, SELECT ON SEQUENCE assembly_step_logs_id_seq TO engineer1;

-- 8. Position usage limits — cycle or hour limits per position
CREATE TABLE IF NOT EXISTS position_limits (
    position    TEXT PRIMARY KEY REFERENCES positions(name),
    limit_type  TEXT NOT NULL CHECK (limit_type IN ('cycles', 'hours')),
    limit_value NUMERIC NOT NULL,
    updated_by  TEXT NOT NULL DEFAULT session_user,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE position_limits TO engineer1;

-- 9. Add usage-at-removal columns to change_events
ALTER TABLE change_events ADD COLUMN IF NOT EXISTS removed_cycles NUMERIC;
ALTER TABLE change_events ADD COLUMN IF NOT EXISTS removed_hours NUMERIC;
