import { useEffect, useRef, useState } from "react";
import { deletePhoto, getHistory, getPhotos, getUsage, postChange, uploadPhoto } from "../api/client";
import type { ChangeEvent, ComponentPhoto, PositionState, UsageStats } from "../types";
import { ChangeForm } from "./ChangeForm";

interface Props {
  position: PositionState;
  onRefresh: () => void;
  readOnly?: boolean;
}

const TZ_ABBR = Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
  .formatToParts(new Date())
  .find((p) => p.type === "timeZoneName")?.value ?? "";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtNum(val: number | string | null | undefined, decimals = 1): string {
  if (val == null) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  return n.toFixed(decimals);
}

function partStr(num: string | null, rev: string | null, serial: string | null): string {
  if (!num) return "-";
  let s = num;
  if (rev) s += ` Rev ${rev}`;
  if (serial) s += ` (${serial})`;
  return s;
}

const PHOTO_TYPE_LABELS: Record<string, string> = {
  before: "Before",
  after: "After",
  inspection: "Inspection",
};

export function PartDetail({ position, onRefresh, readOnly }: Props) {
  const [history, setHistory] = useState<ChangeEvent[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [reverting, setReverting] = useState<number | null>(null);
  const [photos, setPhotos] = useState<ComponentPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [photoType, setPhotoType] = useState("inspection");
  const [caption, setCaption] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadHistory();
    loadUsage();
    loadPhotos();
  }, [position.position]);

  async function loadHistory() {
    try {
      const h = await getHistory(position.position);
      setHistory(h);
    } catch { /* handled by auth wrapper */ }
  }

  async function loadUsage() {
    try {
      const u = await getUsage(position.position);
      setUsage(u);
    } catch {
      setUsage(null);
    }
  }

  async function loadPhotos() {
    try {
      const p = await getPhotos(position.position);
      setPhotos(p);
    } catch {
      setPhotos([]);
    }
  }

  function handleSaved() {
    setShowForm(false);
    loadHistory();
    loadUsage();
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
      loadUsage();
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to revert");
    } finally {
      setReverting(null);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadPhoto(position.position, file, photoType, caption);
      setCaption("");
      loadPhotos();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDeletePhoto(id: number) {
    if (!confirm("Delete this photo?")) return;
    try {
      await deletePhoto(id);
      loadPhotos();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
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

      {usage && usage.installed_since && (
        <div className="usage-stats">
          <div className="label">Usage Since Install</div>
          <div className="usage-grid">
            <div className="usage-item">
              <span className="usage-value">{fmtNum(usage.est_cycles, 0)}</span>
              <span className="usage-label">Est. Cycles</span>
            </div>
            <div className="usage-item">
              <span className="usage-value">{fmtNum(usage.runtime_hours, 2)}</span>
              <span className="usage-label">Runtime (hrs)</span>
            </div>
            <div className="usage-item">
              <span className="usage-value">{fmtNum(usage.idle_hours, 2)}</span>
              <span className="usage-label">Idle (hrs)</span>
            </div>
            <div className="usage-item">
              <span className="usage-value">{fmtNum(usage.avg_cpm)}</span>
              <span className="usage-label">Avg CPM</span>
            </div>
          </div>
          {position.position === "hp_seal_group" && usage.est_cycles != null && usage.est_cycles > 0 && (
            <div className="usage-item" style={{ marginTop: "0.5rem" }}>
              <span className="usage-value">{fmtNum(usage.est_cycles * 0.12, 2)}</span>
              <span className="usage-label">Distance (m)</span>
            </div>
          )}
          {usage.data_points === 0 && (
            <div style={{ fontSize: "0.75rem", color: "var(--gray-500)", marginTop: "0.35rem", fontStyle: "italic" }}>
              No motor speed data available for this time window
            </div>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="actions-bar">
          <button
            className="btn btn-primary"
            style={{ width: "auto" }}
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? "Cancel" : "Log Change"}
          </button>
        </div>
      )}

      {showForm && !readOnly && (
        <ChangeForm
          position={position}
          onSaved={handleSaved}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* ---- Photos ---- */}
      <div className="photos-section">
        <h3>Photos ({photos.length})</h3>

        {!readOnly && (
          <div className="photo-upload">
            <div className="photo-upload-row">
              <select value={photoType} onChange={(e) => setPhotoType(e.target.value)}>
                <option value="before">Before</option>
                <option value="after">After</option>
                <option value="inspection">Inspection</option>
              </select>
              <input
                type="text"
                placeholder="Caption (optional)"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
            </div>
            <label className="btn btn-secondary photo-upload-btn">
              {uploading ? "Uploading..." : "Upload Photo"}
              <input
                ref={fileRef}
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp,.heic"
                onChange={handleFileChange}
                disabled={uploading}
                hidden
              />
            </label>
            <div className="photo-filetypes">Accepts JPG, PNG, GIF, WebP, HEIC</div>
          </div>
        )}

        {photos.length > 0 && (
          <div className="photo-grid">
            {photos.map((p) => (
              <div key={p.id} className="photo-card">
                <img
                  src={p.photo_url}
                  alt={p.caption || "Component photo"}
                  onClick={() => setLightbox(p.photo_url)}
                />
                <div className="photo-meta">
                  <span className={`photo-type-badge ${p.photo_type}`}>
                    {PHOTO_TYPE_LABELS[p.photo_type] || p.photo_type}
                  </span>
                  <span className="photo-date">{fmtTime(p.taken_at)}</span>
                </div>
                {p.caption && <div className="photo-caption">{p.caption}</div>}
                {!readOnly && (
                  <button
                    className="btn-revert photo-delete"
                    onClick={() => handleDeletePhoto(p.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Lightbox ---- */}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Full size" />
        </div>
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
                <th>Effective ({TZ_ABBR})</th>
                <th>Removed</th>
                <th>Installed</th>
                <th>By</th>
                <th>Note</th>
                {!readOnly && <th></th>}
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
                  {!readOnly && (
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
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
