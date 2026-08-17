import { useEffect, useRef, useState } from "react";
import { createFieldNote, getFieldNotes, updateFieldNote, deleteFieldNote } from "../api/client";
import type { FieldNote } from "../api/client";

const CATEGORIES = ["Action Item", "System Maintenance", "Performance", "Other"] as const;
type Category = typeof CATEGORIES[number];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    "Action Item": "var(--red-600)",
    "System Maintenance": "var(--accent)",
    "Performance": "var(--green-600)",
    "Other": "var(--text-secondary)",
  };
  const color = colors[category] || "var(--text-secondary)";
  return (
    <span className="fn-category-badge" style={{ borderColor: color, color }}>
      {category}
    </span>
  );
}

interface EditModalProps {
  note: FieldNote;
  onClose: () => void;
  onSaved: () => void;
}

function EditModal({ note, onClose, onSaved }: EditModalProps) {
  const [text, setText] = useState(note.raw_transcript);
  const [category, setCategory] = useState(note.activity_type);
  const [newPhoto, setNewPhoto] = useState<File | null>(null);
  const [newPhotoPreview, setNewPhotoPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const currentPhotoUrl = removePhoto ? null : (newPhotoPreview || note.audio_url);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setNewPhoto(file);
      setNewPhotoPreview(URL.createObjectURL(file));
      setRemovePhoto(false);
    }
  }

  async function handleSave() {
    if (!text.trim()) return;
    setSaving(true);
    setError("");
    try {
      await updateFieldNote(
        note.id,
        {
          note: text,
          category,
          remove_photo: removePhoto && !newPhoto,
        },
        newPhoto || undefined,
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
    setSaving(false);
  }

  async function handleDelete() {
    setDeleting(true);
    setError("");
    try {
      await deleteFieldNote(note.id);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
    setDeleting(false);
  }

  return (
    <div className="fn-modal-overlay" onClick={onClose}>
      <div className="fn-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fn-modal-header">
          <h3>Edit Note</h3>
          <button className="fn-modal-close" onClick={onClose}>&times;</button>
        </div>

        {error && <div className="wne-error">{error}</div>}

        <div className="fn-modal-body">
          <label className="fn-modal-label">Note</label>
          <textarea
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="field-notes-textarea"
          />

          <label className="fn-modal-label">Category</label>
          <div className="fn-category-picker">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                className={`fn-category-option${category === c ? " active" : ""}`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>

          <label className="fn-modal-label">Photo</label>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            onChange={handlePhotoChange}
            style={{ display: "none" }}
          />
          {currentPhotoUrl ? (
            <div className="field-notes-photo-preview">
              <img src={currentPhotoUrl} alt="Photo" className="field-notes-preview-img" />
              <div>
                <button
                  className="btn btn-secondary"
                  style={{ width: "auto", fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                  onClick={() => fileInput.current?.click()}
                >
                  Change
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ width: "auto", fontSize: "0.75rem", padding: "0.2rem 0.5rem", marginLeft: "0.25rem" }}
                  onClick={() => { setRemovePhoto(true); setNewPhoto(null); setNewPhotoPreview(null); }}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-secondary field-notes-photo-btn"
              onClick={() => fileInput.current?.click()}
            >
              + Attach Photo
            </button>
          )}
        </div>

        <div className="fn-modal-footer">
          {!confirmDelete ? (
            <button
              className="btn fn-delete-btn"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          ) : (
            <button
              className="btn fn-delete-btn fn-delete-confirm"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Confirm Delete"}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" style={{ width: "auto" }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleSave} disabled={saving || !text.trim()}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function VoiceNote({ engineer }: { engineer: string }) {
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<FieldNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [editNote, setEditNote] = useState<FieldNote | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  async function loadNotes() {
    try {
      const data = await getFieldNotes();
      setNotes(data);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadNotes().finally(() => setLoadingNotes(false));
  }, []);

  const queue = notes.filter((n) => n.activity_type === "Unprocessed" || n.activity_type === "Qualitative Observation");
  const processed = notes.filter((n) => n.activity_type !== "Unprocessed" && n.activity_type !== "Qualitative Observation");

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setPhoto(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  }

  function removePhoto() {
    setPhoto(null);
    setPhotoPreview(null);
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
  }

  async function handleSave() {
    if (!note.trim()) return;
    setSaving(true);
    setError("");
    try {
      await createFieldNote(note, engineer, photo || undefined);
      setSaved(true);
      setNote("");
      removePhoto();
      await loadNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
    setSaving(false);
  }

  function handleDiscard() {
    setNote("");
    removePhoto();
    setError("");
    setSaved(false);
  }

  async function handleCategorize(noteItem: FieldNote, category: Category) {
    try {
      await updateFieldNote(noteItem.id, { category });
      await loadNotes();
    } catch { /* ignore */ }
  }

  return (
    <div className="field-notes-page">
      <h2>Field Notes</h2>
      <p className="field-notes-subtitle">
        Log observations, notes, and photos from the field.
      </p>

      {error && <div className="wne-error">{error}</div>}
      {saved && (
        <div className="field-notes-success">
          Note saved successfully.
        </div>
      )}

      {/* New note input */}
      <div className="dash-card field-notes-input-card">
        <div className="dash-card-header">New Note</div>
        <div className="dash-card-body">
          <textarea
            rows={4}
            value={note}
            onChange={(e) => { setNote(e.target.value); setSaved(false); }}
            placeholder="Type your observation or note here..."
            className="field-notes-textarea"
          />
          <div className="field-notes-photo-section">
            <input ref={fileInput} type="file" accept="image/*" onChange={handlePhotoSelect} style={{ display: "none" }} />
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={handlePhotoSelect} style={{ display: "none" }} />
            {!photo ? (
              <div className="field-notes-photo-buttons">
                <button className="btn btn-secondary field-notes-photo-btn" onClick={() => cameraInput.current?.click()}>
                  Take Photo
                </button>
                <button className="btn btn-secondary field-notes-photo-btn" onClick={() => fileInput.current?.click()}>
                  Upload Photo
                </button>
              </div>
            ) : (
              <div className="field-notes-photo-preview">
                {photoPreview && <img src={photoPreview} alt="Preview" className="field-notes-preview-img" />}
                <div>
                  <div className="field-notes-photo-name">{photo.name}</div>
                  <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.75rem", marginTop: "0.25rem", padding: "0.2rem 0.5rem" }} onClick={removePhoto}>
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="field-notes-actions">
            <button className="btn btn-primary field-notes-save-btn" onClick={handleSave} disabled={saving || !note.trim()}>
              {saving ? "Saving..." : "Save Note"}
            </button>
            <button className="btn btn-secondary field-notes-discard-btn" onClick={handleDiscard} disabled={saving}>
              Discard
            </button>
          </div>
        </div>
      </div>

      {/* Note Queue */}
      <div className="dash-card field-notes-input-card">
        <div className="dash-card-header">Note Queue ({queue.length})</div>
        <div className="dash-card-body">
          {loadingNotes ? (
            <p className="field-notes-empty">Loading...</p>
          ) : queue.length === 0 ? (
            <p className="field-notes-empty">No unprocessed notes.</p>
          ) : (
            <div className="field-notes-log">
              {queue.map((n) => (
                <div key={n.id} className="field-notes-entry">
                  <div className="field-notes-entry-header">
                    <strong>{n.engineer}</strong>
                    <span className="field-notes-entry-time">{fmtTime(n.logged_at)}</span>
                  </div>
                  <p className="field-notes-entry-text">{n.raw_transcript}</p>
                  {n.audio_url && (
                    <img src={n.audio_url} alt="Photo" className="field-notes-entry-photo" onClick={() => window.open(n.audio_url!, "_blank")} />
                  )}
                  <div className="fn-queue-actions">
                    <span className="fn-queue-label">Sort into:</span>
                    {CATEGORIES.map((c) => (
                      <button key={c} className="btn btn-secondary fn-sort-btn" onClick={() => handleCategorize(n, c)}>
                        {c}
                      </button>
                    ))}
                    <button className="btn btn-secondary fn-edit-btn" onClick={() => setEditNote(n)}>Edit</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Processed Notes */}
      <div className="dash-card">
        <div className="dash-card-header">Processed Notes ({processed.length})</div>
        <div className="dash-card-body">
          {loadingNotes ? (
            <p className="field-notes-empty">Loading...</p>
          ) : processed.length === 0 ? (
            <p className="field-notes-empty">No processed notes yet. Sort notes from the queue above.</p>
          ) : (
            <div className="field-notes-log">
              {processed.map((n) => (
                <div key={n.id} className="field-notes-entry">
                  <div className="field-notes-entry-header">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <strong>{n.engineer}</strong>
                      <CategoryBadge category={n.activity_type} />
                    </div>
                    <span className="field-notes-entry-time">{fmtTime(n.logged_at)}</span>
                  </div>
                  <p className="field-notes-entry-text">{n.raw_transcript}</p>
                  {n.audio_url && (
                    <img src={n.audio_url} alt="Photo" className="field-notes-entry-photo" onClick={() => window.open(n.audio_url!, "_blank")} />
                  )}
                  <button className="btn btn-secondary fn-edit-btn" style={{ marginTop: "0.5rem" }} onClick={() => setEditNote(n)}>
                    Edit
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editNote && (
        <EditModal
          note={editNote}
          onClose={() => setEditNote(null)}
          onSaved={() => { setEditNote(null); loadNotes(); }}
        />
      )}
    </div>
  );
}
