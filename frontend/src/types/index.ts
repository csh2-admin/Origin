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
}
