import { useEffect, useRef, useState } from "react";
import { createFieldNote, getFieldNotes } from "../api/client";

interface FieldNoteEntry {
  id: number;
  logged_at: string;
  engineer: string;
  summary: string;
  raw_transcript: string;
  audio_url: string | null;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function VoiceNote({ engineer }: { engineer: string }) {
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<FieldNoteEntry[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getFieldNotes()
      .then(setNotes)
      .catch(() => {})
      .finally(() => setLoadingNotes(false));
  }, []);

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
      const updated = await getFieldNotes();
      setNotes(updated);
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
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              onChange={handlePhotoSelect}
              style={{ display: "none" }}
            />
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoSelect}
              style={{ display: "none" }}
            />
            {!photo ? (
              <div className="field-notes-photo-buttons">
                <button
                  className="btn btn-secondary field-notes-photo-btn"
                  onClick={() => cameraInput.current?.click()}
                >
                  Take Photo
                </button>
                <button
                  className="btn btn-secondary field-notes-photo-btn"
                  onClick={() => fileInput.current?.click()}
                >
                  Upload Photo
                </button>
              </div>
            ) : (
              <div className="field-notes-photo-preview">
                {photoPreview && (
                  <img src={photoPreview} alt="Preview" className="field-notes-preview-img" />
                )}
                <div>
                  <div className="field-notes-photo-name">{photo.name}</div>
                  <button
                    className="btn btn-secondary"
                    style={{ width: "auto", fontSize: "0.75rem", marginTop: "0.25rem", padding: "0.2rem 0.5rem" }}
                    onClick={removePhoto}
                  >
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

      <div className="dash-card">
        <div className="dash-card-header">Note Log</div>
        <div className="dash-card-body">
          {loadingNotes ? (
            <p className="field-notes-empty">Loading...</p>
          ) : notes.length === 0 ? (
            <p className="field-notes-empty">No notes recorded yet.</p>
          ) : (
            <div className="field-notes-log">
              {notes.map((n) => (
                <div key={n.id} className="field-notes-entry">
                  <div className="field-notes-entry-header">
                    <strong>{n.engineer}</strong>
                    <span className="field-notes-entry-time">{fmtTime(n.logged_at)}</span>
                  </div>
                  <p className="field-notes-entry-text">{n.raw_transcript}</p>
                  {n.audio_url && (
                    <img
                      src={n.audio_url}
                      alt="Attached photo"
                      className="field-notes-entry-photo"
                      onClick={() => window.open(n.audio_url!, "_blank")}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
