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
    <div style={{ padding: "1.5rem", maxWidth: 800, margin: "0 auto" }}>
      <h2>Field Notes</h2>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        Log observations, notes, and photos from the field.
      </p>

      {error && <div className="wne-error">{error}</div>}
      {saved && (
        <div style={{ background: "color-mix(in srgb, var(--green-600) 10%, transparent)", border: "1px solid var(--green-600)", borderRadius: "var(--radius)", padding: "0.75rem 1rem", marginBottom: "1rem", fontSize: "0.85rem", color: "var(--green-600)" }}>
          Note saved successfully.
        </div>
      )}

      <div className="dash-card" style={{ marginBottom: "1.5rem" }}>
        <div className="dash-card-header">New Note</div>
        <div className="dash-card-body">
          <textarea
            rows={5}
            value={note}
            onChange={(e) => { setNote(e.target.value); setSaved(false); }}
            placeholder="Type your observation or note here..."
            style={{ width: "100%", fontFamily: "inherit", fontSize: "0.85rem", padding: "0.5rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", resize: "vertical" }}
          />

          <div style={{ marginTop: "0.75rem" }}>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              onChange={handlePhotoSelect}
              style={{ display: "none" }}
            />
            {!photo ? (
              <button
                className="btn btn-secondary"
                style={{ width: "auto", fontSize: "0.8rem" }}
                onClick={() => fileInput.current?.click()}
              >
                + Attach Photo
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
                {photoPreview && (
                  <img
                    src={photoPreview}
                    alt="Preview"
                    style={{ width: 120, height: 90, objectFit: "cover", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
                  />
                )}
                <div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{photo.name}</div>
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

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleSave} disabled={saving || !note.trim()}>
              {saving ? "Saving..." : "Save Note"}
            </button>
            <button className="btn btn-secondary" style={{ width: "auto" }} onClick={handleDiscard} disabled={saving}>
              Discard
            </button>
          </div>
        </div>
      </div>

      <div className="dash-card">
        <div className="dash-card-header">Note Log</div>
        <div className="dash-card-body">
          {loadingNotes ? (
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Loading...</p>
          ) : notes.length === 0 ? (
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No notes recorded yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {notes.map((n) => (
                <div key={n.id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: "0.75rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.25rem" }}>
                    <strong style={{ fontSize: "0.85rem" }}>{n.engineer}</strong>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{fmtTime(n.logged_at)}</span>
                  </div>
                  <p style={{ fontSize: "0.85rem", color: "var(--text)", margin: "0.25rem 0", whiteSpace: "pre-wrap" }}>{n.raw_transcript}</p>
                  {n.audio_url && (
                    <img
                      src={n.audio_url}
                      alt="Attached photo"
                      style={{ maxWidth: 300, maxHeight: 200, objectFit: "contain", borderRadius: "var(--radius)", border: "1px solid var(--border)", marginTop: "0.25rem", cursor: "pointer" }}
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
