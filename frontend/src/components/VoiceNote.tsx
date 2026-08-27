import { useEffect, useRef, useState } from "react";
import { createFieldNote, getFieldNotes, updateFieldNote, deleteFieldNote, getReplies, createReply } from "../api/client";
import type { FieldNote, Reply } from "../api/client";
import { Lightbox } from "./Lightbox";
import { WeeboActions } from "./WeeboActions";

const CATEGORIES = ["Action Item", "Assembly Note", "System Maintenance", "Performance", "Other"] as const;
const TEAM_MEMBERS = ["jimmyli", "edwardyoun", "anthonyku", "pjcallahan", "tomtodaro"] as const;

function parsePhotos(audioUrl: string | null): string[] {
  if (!audioUrl) return [];
  try {
    const parsed = JSON.parse(audioUrl);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* not JSON, treat as single URL */ }
  return [audioUrl];
}

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) { resolve(file); return; }
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= MAX_DIMENSION && height <= MAX_DIMENSION && file.size < 500_000) {
        resolve(file);
        return;
      }
      if (width > height) {
        if (width > MAX_DIMENSION) { height = Math.round(height * MAX_DIMENSION / width); width = MAX_DIMENSION; }
      } else {
        if (height > MAX_DIMENSION) { width = Math.round(width * MAX_DIMENSION / height); height = MAX_DIMENSION; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const name = file.name.replace(/\.[^.]+$/, ".jpg");
            resolve(new File([blob], name, { type: "image/jpeg" }));
          } else {
            resolve(file);
          }
        },
        "image/jpeg",
        JPEG_QUALITY,
      );
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

async function compressImages(files: File[]): Promise<File[]> {
  return Promise.all(files.map(compressImage));
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    "Action Item": "var(--red-600)",
    "Assembly Note": "#b8860b",
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

function ReplyThread({ noteId, engineer, replyCount }: { noteId: number; engineer: string; replyCount: number }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setReplies(await getReplies(noteId));
    } catch { /* ignore */ }
    setLoading(false);
  }

  function toggle() {
    if (!open) load();
    setOpen(!open);
  }

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    try {
      const r = await createReply(noteId, text.trim(), engineer);
      setReplies((prev) => [...prev, r]);
      setText("");
    } catch { /* ignore */ }
    setSending(false);
  }

  return (
    <div className="reply-thread">
      <button className="reply-toggle" onClick={toggle}>
        {open ? "Hide replies" : replyCount > 0 ? `${replyCount} ${replyCount === 1 ? "reply" : "replies"}` : "Reply"}
      </button>
      {open && (
        <div className="reply-list">
          {loading ? (
            <p className="reply-empty">Loading...</p>
          ) : replies.length === 0 ? (
            <p className="reply-empty">No replies yet.</p>
          ) : (
            replies.map((r) => (
              <div key={r.id} className="reply-item">
                <div className="reply-header">
                  <strong>{r.author}</strong>
                  <span className="reply-time">{fmtTime(r.created_at)}</span>
                </div>
                <p className="reply-text">{r.reply_text}</p>
              </div>
            ))
          )}
          <div className="reply-input-row">
            <input
              type="text"
              className="reply-input"
              placeholder="Write a reply..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button className="btn btn-primary reply-send" onClick={send} disabled={sending || !text.trim()}>
              {sending ? "..." : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
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
  const [existingPhotos, setExistingPhotos] = useState<string[]>(parsePhotos(note.audio_url));
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [newPhotoPreviews, setNewPhotoPreviews] = useState<string[]>([]);
  const [responsible, setResponsible] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const totalPhotos = existingPhotos.length + newPhotos.length;

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remaining = 4 - totalPhotos;
    const toAdd = files.slice(0, remaining);
    const compressed = await compressImages(toAdd);
    setNewPhotos((prev) => [...prev, ...compressed]);
    setNewPhotoPreviews((prev) => [...prev, ...compressed.map((f) => URL.createObjectURL(f))]);
    if (e.target) e.target.value = "";
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
          responsible: category === "Action Item" ? (responsible.trim() || undefined) : undefined,
          existing_photos: existingPhotos,
        },
        newPhotos.length ? newPhotos : undefined,
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

          {category === "Action Item" && (
            <>
              <label className="fn-modal-label">Assign To</label>
              <select
                value={responsible}
                onChange={(e) => setResponsible(e.target.value)}
                style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", marginBottom: "0.75rem" }}
              >
                <option value="">Select...</option>
                {TEAM_MEMBERS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </>
          )}

          <label className="fn-modal-label">Photos ({totalPhotos}/4)</label>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            onChange={handlePhotoChange}
            style={{ display: "none" }}
          />
          {totalPhotos > 0 ? (
            <div>
              <div className="field-notes-photo-grid" style={{ marginBottom: "0.5rem" }}>
                {existingPhotos.map((url, i) => (
                  <div key={`e${i}`} className="field-notes-photo-thumb">
                    <img src={url} alt={`Photo ${i + 1}`} className="field-notes-thumb-img" />
                    <button className="field-notes-thumb-remove" onClick={() => setExistingPhotos((prev) => prev.filter((_, j) => j !== i))}>&times;</button>
                  </div>
                ))}
                {newPhotoPreviews.map((url, i) => (
                  <div key={`n${i}`} className="field-notes-photo-thumb">
                    <img src={url} alt={`New ${i + 1}`} className="field-notes-thumb-img" />
                    <button className="field-notes-thumb-remove" onClick={() => { setNewPhotos((prev) => prev.filter((_, j) => j !== i)); setNewPhotoPreviews((prev) => prev.filter((_, j) => j !== i)); }}>&times;</button>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {totalPhotos < 4 && (
                  <button
                    className="btn btn-secondary"
                    style={{ width: "auto", fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                    onClick={() => fileInput.current?.click()}
                  >
                    + Add Photo
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  style={{ width: "auto", fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                  onClick={() => { setExistingPhotos([]); setNewPhotos([]); setNewPhotoPreviews([]); }}
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

export function VoiceNote({ engineer, initialTab = "notes" }: { engineer: string; initialTab?: "notes" | "actions" | "log-feed" }) {
  const [activeTab, setActiveTab] = useState<"notes" | "actions" | "log-feed">(initialTab);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<FieldNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [editNote, setEditNote] = useState<FieldNote | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [feedFrom, setFeedFrom] = useState("2026-01-01");
  const [feedTo, setFeedTo] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [feedSearch, setFeedSearch] = useState("");
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

  // No longer split into queue/processed — all notes shown in one feed

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remaining = 4 - photos.length;
    const toAdd = files.slice(0, remaining);
    const compressed = await compressImages(toAdd);
    setPhotos((prev) => [...prev, ...compressed]);
    setPhotoPreviews((prev) => [...prev, ...compressed.map((f) => URL.createObjectURL(f))]);
    if (e.target) e.target.value = "";
  }

  function removePhotoAt(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== idx));
  }

  function clearPhotos() {
    setPhotos([]);
    setPhotoPreviews([]);
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
  }

  async function handleSave() {
    if (!note.trim()) return;
    setSaving(true);
    setError("");
    try {
      await createFieldNote(note, engineer, photos.length ? photos : undefined);
      setSaved(true);
      setNote("");
      clearPhotos();
      await loadNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
    setSaving(false);
  }

  function handleDiscard() {
    setNote("");
    clearPhotos();
    setError("");
    setSaved(false);
  }

  return (
    <div className="field-notes-page">
      <h2>Field Notes</h2>
      <div className="weebo-tabs" style={{ marginBottom: "1.25rem" }}>
        <button className={`weebo-tab${activeTab === "notes" ? " active" : ""}`} onClick={() => setActiveTab("notes")}>Log Note</button>
        <button className={`weebo-tab${activeTab === "log-feed" ? " active" : ""}`} onClick={() => setActiveTab("log-feed")}>Field Note Feed</button>
        <button className={`weebo-tab${activeTab === "actions" ? " active" : ""}`} onClick={() => setActiveTab("actions")}>Action Items</button>
      </div>

      {activeTab === "actions" ? (
        <WeeboActions />
      ) : activeTab === "log-feed" ? (
      <>
      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <label style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>From</label>
        <input type="date" value={feedFrom} onChange={(e) => setFeedFrom(e.target.value)}
          style={{ padding: "0.3rem 0.5rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "0.85rem" }} />
        <label style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>To</label>
        <input type="date" value={feedTo} onChange={(e) => setFeedTo(e.target.value)}
          style={{ padding: "0.3rem 0.5rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "0.85rem" }} />
      </div>
      <div style={{ marginBottom: "1rem" }}>
        <input type="text" placeholder="Search notes..." value={feedSearch} onChange={(e) => setFeedSearch(e.target.value)}
          style={{ width: "100%", maxWidth: "400px", padding: "0.4rem 0.6rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "0.85rem" }} />
      </div>
      {/* Field Note Feed */}
      <div className="dash-card">
        <div className="dash-card-header">Field Note Feed ({notes.filter((n) => {
          const d = n.logged_at.slice(0, 10);
          if (d < feedFrom || d > feedTo) return false;
          if (feedSearch.trim()) {
            const q = feedSearch.trim().toLowerCase();
            return (n.raw_transcript?.toLowerCase().includes(q)) || (n.engineer?.toLowerCase().includes(q)) || (n.summary?.toLowerCase().includes(q));
          }
          return true;
        }).length})</div>
        <div className="dash-card-body">
          {loadingNotes ? (
            <p className="field-notes-empty">Loading...</p>
          ) : notes.filter((n) => {
            const d = n.logged_at.slice(0, 10);
            if (d < feedFrom || d > feedTo) return false;
            if (feedSearch.trim()) {
              const q = feedSearch.trim().toLowerCase();
              return (n.raw_transcript?.toLowerCase().includes(q)) || (n.engineer?.toLowerCase().includes(q)) || (n.summary?.toLowerCase().includes(q));
            }
            return true;
          }).length === 0 ? (
            <p className="field-notes-empty">No notes match your filters.</p>
          ) : (
            <div className="field-notes-log">
              {notes.filter((n) => {
                const d = n.logged_at.slice(0, 10);
                if (d < feedFrom || d > feedTo) return false;
                if (feedSearch.trim()) {
                  const q = feedSearch.trim().toLowerCase();
                  return (n.raw_transcript?.toLowerCase().includes(q)) || (n.engineer?.toLowerCase().includes(q)) || (n.summary?.toLowerCase().includes(q));
                }
                return true;
              }).map((n) => (
                <div key={n.id} className="field-notes-entry">
                  <div className="field-notes-entry-header">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <strong>{n.engineer}</strong>
                      {n.activity_type && n.activity_type !== "Unprocessed" && n.activity_type !== "Qualitative Observation" && (
                        <CategoryBadge category={n.activity_type} />
                      )}
                    </div>
                    <span className="field-notes-entry-time">{fmtTime(n.logged_at)}</span>
                  </div>
                  <p className="field-notes-entry-text">{n.raw_transcript}</p>
                  {n.audio_url && (
                    <div className="field-notes-photo-grid">
                      {parsePhotos(n.audio_url).map((url, i) => (
                        <img key={i} src={url} alt={`Photo ${i + 1}`} className="field-notes-entry-photo" onClick={() => setLightboxSrc(url)} />
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
                    <button className="btn btn-secondary fn-edit-btn" onClick={() => setEditNote(n)}>Edit</button>
                  </div>
                  <ReplyThread noteId={n.id} engineer={engineer} replyCount={n.reply_count} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </>
      ) : (
      <>
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
            <input ref={fileInput} type="file" accept="image/*" multiple onChange={handlePhotoSelect} style={{ display: "none" }} />
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={handlePhotoSelect} style={{ display: "none" }} />
            {photos.length > 0 && (
              <div className="field-notes-photo-grid">
                {photoPreviews.map((url, i) => (
                  <div key={i} className="field-notes-photo-thumb">
                    <img src={url} alt={`Photo ${i + 1}`} className="field-notes-thumb-img" onClick={() => setLightboxSrc(url)} />
                    <button className="field-notes-thumb-remove" onClick={() => removePhotoAt(i)}>&times;</button>
                  </div>
                ))}
              </div>
            )}
            {photos.length < 4 && (
              <div className="field-notes-photo-buttons">
                <button className="btn btn-secondary field-notes-photo-btn" onClick={() => cameraInput.current?.click()}>
                  Take Photo
                </button>
                <button className="btn btn-secondary field-notes-photo-btn" onClick={() => fileInput.current?.click()}>
                  Upload Photo{photos.length > 0 ? "s" : ""}
                </button>
                {photos.length > 0 && (
                  <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{photos.length}/4</span>
                )}
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

      {editNote && (
        <EditModal
          note={editNote}
          onClose={() => setEditNote(null)}
          onSaved={() => { setEditNote(null); loadNotes(); }}
        />
      )}
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      </>
      )}
    </div>
  );
}
