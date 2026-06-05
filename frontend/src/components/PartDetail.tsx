import { useEffect, useState } from "react";
import { getHistory, postChange } from "../api/client";
import type { ChangeEvent, PositionState } from "../types";
import { ChangeForm } from "./ChangeForm";

interface Props {
  position: PositionState;
  onRefresh: () => void;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function partStr(num: string | null, rev: string | null, serial: string | null): string {
  if (!num) return "-";
  let s = num;
  if (rev) s += ` Rev ${rev}`;
  if (serial) s += ` (${serial})`;
  return s;
}

export function PartDetail({ position, onRefresh }: Props) {
  const [history, setHistory] = useState<ChangeEvent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [reverting, setReverting] = useState<number | null>(null);

  useEffect(() => {
    loadHistory();
  }, [position.position]);

  async function loadHistory() {
    try {
      const h = await getHistory(position.position);
      setHistory(h);
    } catch { /* handled by auth wrapper */ }
  }

  function handleSaved() {
    setShowForm(false);
    loadHistory();
    onRefresh();
  }

  async function handleRevert(evt: ChangeEvent) {
    if (!confirm(`Revert this change? A new correction entry will be created.`)) return;
    setReverting(evt.id);
    try {
      await postChange({
        position: evt.position,
        effective_time: evt.effective_time,
        removed_part_number: evt.installed_part_number || undefined,
        removed_part_revision: evt.installed_part_revision || undefined,
        removed_part_serial: evt.installed_part_serial || undefined,
        installed_part_number: evt.removed_part_number || undefined,
        installed_part_revision: evt.removed_part_revision || undefined,
        installed_part_serial: evt.removed_part_serial || undefined,
        note: `Correction: reverted change #${evt.id}`,
      });
      loadHistory();
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to revert");
    } finally {
      setReverting(null);
    }
  }

  return (
    <div className="part-detail">
      <h2>{position.display_name}</h2>
      <div className="position-id">{position.position}</div>

      <div className="current-part">
        <div className="label">Currently Installed</div>
        {position.part_number ? (
          <div className="part-id">
            {position.part_number}
            {position.part_revision ? ` Rev ${position.part_revision}` : ""}
            {position.part_serial ? (
              <span style={{ fontWeight: 400, fontSize: "0.85em", color: "var(--gray-500)" }}>
                {" "}S/N {position.part_serial}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="part-id empty">No part installed</div>
        )}
        {position.last_changed && (
          <div style={{ fontSize: "0.75rem", color: "var(--gray-500)", marginTop: "0.25rem" }}>
            Since {fmtTime(position.last_changed)} by {position.changed_by}
          </div>
        )}
      </div>

      <div className="actions-bar">
        <button
          className="btn btn-primary"
          style={{ width: "auto" }}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "Cancel" : "Log Change"}
        </button>
      </div>

      {showForm && (
        <ChangeForm
          position={position}
          onSaved={handleSaved}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="history-section">
        <h3>Change History ({history.length})</h3>
        {history.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "var(--gray-500)" }}>
            No changes recorded yet.
          </p>
        ) : (
          <table className="history-table">
            <thead>
              <tr>
                <th>Effective</th>
                <th>Removed</th>
                <th>Installed</th>
                <th>By</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {history.map((evt) => (
                <tr key={evt.id}>
                  <td className="mono">{fmtTime(evt.effective_time)}</td>
                  <td className="mono">
                    {partStr(evt.removed_part_number, evt.removed_part_revision, evt.removed_part_serial)}
                  </td>
                  <td className="mono">
                    {partStr(evt.installed_part_number, evt.installed_part_revision, evt.installed_part_serial)}
                  </td>
                  <td>{evt.changed_by}</td>
                  <td className="note-cell" title={evt.note ?? ""}>{evt.note ?? ""}</td>
                  <td>
                    <button
                      className="btn-revert"
                      title="Revert this change"
                      disabled={reverting === evt.id}
                      onClick={() => handleRevert(evt)}
                    >
                      {reverting === evt.id ? "..." : "Revert"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
