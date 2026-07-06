import { FormEvent, useEffect, useState } from "react";
import { getPartsCatalog, postChange } from "../api/client";
import type { PartCatalogEntry, PositionState } from "../types";

interface Props {
  position: PositionState;
  onSaved: () => void;
  onCancel: () => void;
}

function toLocalISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function ChangeForm({ position, onSaved, onCancel }: Props) {
  const [catalog, setCatalog] = useState<PartCatalogEntry[]>([]);
  const [selectedPart, setSelectedPart] = useState("");
  const [effectiveTime, setEffectiveTime] = useState(toLocalISO());
  const [installedNumber, setInstalledNumber] = useState("");
  const [installedRevision, setInstalledRevision] = useState("");
  const [installedSerial, setInstalledSerial] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPartsCatalog(position.position)
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [position.position]);

  function handlePartSelect(value: string) {
    setSelectedPart(value);
    if (value === "__custom__") {
      setInstalledNumber("");
    } else if (value) {
      setInstalledNumber(value);
    } else {
      setInstalledNumber("");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await postChange({
        position: position.position,
        effective_time: new Date(effectiveTime).toISOString(),
        removed_part_number: position.part_number || undefined,
        removed_part_revision: position.part_revision || undefined,
        removed_part_serial: position.part_serial || undefined,
        installed_part_number: installedNumber || undefined,
        installed_part_revision: installedRevision || undefined,
        installed_part_serial: installedSerial || undefined,
        note: note || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const isCustom = selectedPart === "__custom__";

  return (
    <form className="change-form" onSubmit={handleSubmit}>
      <h3>Log Component Change</h3>

      {position.part_number && (
        <div style={{ marginBottom: "1rem", fontSize: "0.82rem", color: "var(--gray-500)" }}>
          Removing: <strong style={{ color: "var(--gray-900)" }}>
            {position.part_number}
            {position.part_revision ? ` Rev ${position.part_revision}` : ""}
            {position.part_serial ? ` (S/N ${position.part_serial})` : ""}
          </strong>
        </div>
      )}

      <div className="field">
        <label>New Part</label>
        {catalog.length > 0 ? (
          <select
            className="part-select"
            value={selectedPart}
            onChange={(e) => handlePartSelect(e.target.value)}
          >
            <option value="">— Select a part —</option>
            {catalog.map((p) => (
              <option key={p.part_number} value={p.part_number}>
                {p.part_number}: {p.description || p.part_number}
              </option>
            ))}
            <option value="__custom__">Other (enter manually)</option>
          </select>
        ) : (
          <input
            type="text"
            value={installedNumber}
            onChange={(e) => setInstalledNumber(e.target.value)}
            placeholder="e.g. 20B102Z"
          />
        )}
      </div>

      {isCustom && (
        <div className="field">
          <label>Part Number</label>
          <input
            type="text"
            value={installedNumber}
            onChange={(e) => setInstalledNumber(e.target.value)}
            placeholder="e.g. 20B102Z"
          />
        </div>
      )}

      <div className="form-row">
        <div className="field">
          <label>Revision</label>
          <input
            type="text"
            value={installedRevision}
            onChange={(e) => setInstalledRevision(e.target.value)}
            placeholder="e.g. B"
          />
        </div>
        <div className="field">
          <label>Serial Number</label>
          <input
            type="text"
            value={installedSerial}
            onChange={(e) => setInstalledSerial(e.target.value)}
            placeholder="e.g. SN-00142"
          />
        </div>
      </div>

      <div className="field">
        <label>When did this happen?</label>
        <input
          type="datetime-local"
          value={effectiveTime}
          onChange={(e) => setEffectiveTime(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label>Note (optional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Replaced due to seal leak during run #47"
        />
      </div>

      <div className="form-buttons">
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Change"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <div className="error-msg">{error}</div>}
    </form>
  );
}
