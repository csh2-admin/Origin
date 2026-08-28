export interface PositionState {
  position: string;
  display_name: string;
  part_number: string | null;
  part_revision: string | null;
  part_serial: string | null;
  last_changed: string | null;
  changed_by: string | null;
}

export interface ChangeEvent {
  id: number;
  effective_time: string;
  recorded_time: string;
  position: string;
  removed_part_number: string | null;
  removed_part_revision: string | null;
  removed_part_serial: string | null;
  installed_part_number: string | null;
  installed_part_revision: string | null;
  installed_part_serial: string | null;
  changed_by: string;
  note: string | null;
}

export interface PartCatalogEntry {
  part_number: string;
  position: string;
  description: string | null;
}

export interface UsageStats {
  installed_since: string | null;
  runtime_hours: number | null;
  idle_hours: number | null;
  est_cycles: number | null;
  avg_cpm: number | null;
  data_points: number;
}

export interface ComponentPhoto {
  id: number;
  position: string;
  change_event_id: number | null;
  photo_url: string;
  caption: string | null;
  photo_type: "before" | "after" | "inspection";
  taken_at: string;
  uploaded_by: string;
}

export interface TestRun {
  id: number;
  test_type: "simplex" | "triplex";
  test_name: string | null;
  current_step: string;
  checklist_state: string;
  notes: string | null;
  started_at: string;
  started_by: string;
  completed_at: string | null;
  asset_snapshot?: string | null;
}

export interface TestReport {
  run: TestRun;
  asset_snapshot: { position: string; display_name: string; part_number: string | null; part_serial: string | null; part_revision: string | null }[];
  assembly_notes: { run_id: number; step_order: number; notes: string; action: string; sub_page: string }[];
  procedure_steps: { run_id: number; step_order: number; notes: string | null; checked_at: string | null; torque_actual: string | null; action: string; torque_spec: string | null; sub_page: string; pump_head: number }[];
  memos: MemoEntry[];
  actions: { id: number; action_text: string; status: string | null; responsible: string | null; due_date: string | null; notes: string | null; created_at: string }[];
  timeline: { event_type: string; effective_time?: string; taken_at?: string; logged_at?: string; created_at?: string; display_name?: string; position?: string; installed_part_number?: string; removed_part_number?: string; changed_by?: string; note?: string; caption?: string; photo_type?: string; uploaded_by?: string; engineer?: string; summary?: string; severity?: string; action_text?: string; responsible?: string; status?: string; activity_type?: string; raw_transcript?: string; audio_url?: string }[];
}

export interface DailyLog {
  date: string;
  field_notes: { id: number; logged_at: string; engineer: string; activity_type: string; summary: string | null; raw_transcript: string; audio_url: string | null; source_file: string | null; reply_count?: number }[];
  test_runs: TestRun[];
  asset_config: { position: string; display_name: string; part_number: string | null; part_revision: string | null; part_serial: string | null; last_changed: string | null; changed_by: string | null }[];
  change_events: { id: number; position: string; display_name: string; effective_time: string; installed_part_number: string | null; installed_part_revision: string | null; installed_part_serial: string | null; removed_part_number: string | null; removed_part_revision: string | null; removed_part_serial: string | null; changed_by: string; note: string | null }[];
  action_items: { id: number; action_text: string; status: string | null; responsible: string | null; due_date: string | null; notes: string | null; created_at: string }[];
}

export interface AssemblyVerification {
  complete: boolean;
  missing: { name: string; display_name: string }[];
  total: number;
  installed: number;
}

export interface MemoEntry {
  id: number;
  logged_at: string;
  engineer: string;
  source_file: string | null;
  activity_type: string | null;
  summary: string | null;
  system_performance: string | null;
  maintenance_done: string | null;
  issues_found: string | null;
  action_items: string | null;
  components_affected: string | null;
  duration_hours: number | null;
  severity: string | null;
  additional_notes: string | null;
  raw_transcript: string | null;
  audio_url: string | null;
  trigger_sim_update: boolean;
}

export interface ActionItem {
  id: number;
  created_at: string;
  updated_at: string;
  memo_id: number | null;
  engineer: string;
  action_text: string;
  status: "Not Started" | "In Progress" | "Complete";
  responsible: string | null;
  due_date: string | null;
  notes: string | null;
  completed_by: string | null;
  completed_at: string | null;
}

export interface AskResponse {
  answer: string;
  sql: string;
  row_count: number;
  results: Record<string, unknown>[];
}

export interface AssemblyInstruction {
  id: number;
  sub_page: string;
  step_order: number;
  action: string;
  pns_tags: string;
  tools: string;
  torque_spec: string;
  created_by: string;
  updated_at: string;
}

export interface AssemblyStepLog {
  id: number;
  run_id: number;
  instruction_id: number;
  step_order: number;
  checked_at: string | null;
  torque_actual: string | null;
  notes: string | null;
}

export interface AssemblyRun {
  id: number;
  sub_page: string;
  pump_head: number;
  started_at: string;
  completed_at: string | null;
  started_by: string;
  completed_by: string | null;
  steps?: AssemblyStepLog[];
  instructions?: AssemblyInstruction[];
}

export interface ChangePayload {
  position: string;
  effective_time: string;
  removed_part_number?: string;
  removed_part_revision?: string;
  removed_part_serial?: string;
  installed_part_number?: string;
  installed_part_revision?: string;
  installed_part_serial?: string;
  note?: string;
  removed_cycles?: number;
  removed_hours?: number;
}

export interface PositionLimit {
  position: string;
  display_name: string;
  limit_type: "cycles" | "hours";
  limit_value: number;
  updated_by?: string;
  updated_at?: string;
}

export interface DashboardData {
  active_run: {
    id: number;
    test_type: string;
    test_name: string | null;
    current_step: string;
    started_at: string;
    started_by: string;
  } | null;
  recent_changes: {
    id: number;
    position: string;
    display_name: string;
    effective_time: string;
    installed_part_number: string | null;
    removed_part_number: string | null;
    changed_by: string;
  }[];
  limits: PositionLimit[];
}
