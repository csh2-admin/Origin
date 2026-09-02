import { useEffect, useRef, useState } from "react";
import { createHypothesis, getHypotheses, updateFieldNote, deleteFieldNote, getReplies, createReply } from "../api/client";
import type { FieldNote, Reply } from "../api/client";
import { Lightbox } from "./Lightbox";

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) { resolve(file); return; }
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= MAX_DIMENSION && height <= MAX_DIMENSION && file.size < 500_000) { resolve(file); return; }
      if (width > height) {
        if (width > MAX_DIMENSION) { height = Math.round(height * MAX_DIMENSION / width); width = MAX_DIMENSION; }
      } else {
        if (height > MAX_DIMENSION) { width = Math.round(width * MAX_DIMENSION / height); height = MAX_DIMENSION; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        else resolve(file);
      }, "image/jpeg", JPEG_QUALITY);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

async function compressImages(files: File[]): Promise<File[]> {
  return Promise.all(files.map(compressImage));
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function parsePhotos(audioUrl: string | null): string[] {
  if (!audioUrl) return [];
  try { const parsed = JSON.parse(audioUrl); if (Array.isArray(parsed)) return parsed; } catch { /* */ }
  return [audioUrl];
}

function ReplyThread({ noteId, engineer, replyCount }: { noteId: number; engineer: string; replyCount: number }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function load() { setLoading(true); try { setReplies(await getReplies(noteId)); } catch { /* */ } setLoading(false); }
  function toggle() { if (!open) load(); setOpen(!open); }
  async function send() {
    if (!text.trim()) return;
    setSending(true);
    try { const r = await createReply(noteId, text.trim(), engineer); setReplies((prev) => [...prev, r]); setText(""); } catch { /* */ }
    setSending(false);
  }

  return (
    <div className="reply-thread">
      <button className="reply-toggle" onClick={toggle}>
        {open ? "Hide replies" : replyCount > 0 ? `${replyCount} ${replyCount === 1 ? "reply" : "replies"}` : "Reply"}
      </button>
      {open && (
        <div className="reply-list">
          {loading ? <p className="reply-empty">Loading...</p> : replies.length === 0 ? <p className="reply-empty">No replies yet.</p> : (
            replies.map((r) => (
              <div key={r.id} className="reply-item">
                <div className="reply-header"><strong>{r.author}</strong><span className="reply-time">{fmtTime(r.created_at)}</span></div>
                <p className="reply-text">{r.reply_text}</p>
              </div>
            ))
          )}
          <div className="reply-input-row">
            <input type="text" className="reply-input" placeholder="Write a reply..." value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="btn btn-primary reply-send" onClick={send} disabled={sending || !text.trim()}>{sending ? "..." : "Send"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function HypothesisLog({ engineer }: { engineer: string }) {
  const [activeTab, setActiveTab] = useState<"log" | "feed">("log");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<FieldNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [editNote, setEditNote] = useState<FieldNote | null>(null);
  const [editText, setEditText] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [feedSearch, setFeedSearch] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  async function loadNotes() {
    try { setNotes(await getHypotheses()); } catch { /* */ }
  }

  useEffect(() => { loadNotes().finally(() => setLoadingNotes(false)); }, []);

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const toAdd = files.slice(0, 4 - photos.length);
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
    setPhotos([]); setPhotoPreviews([]);
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
  }

  async function handleSave() {
    if (!note.trim()) return;
    setSaving(true); setError("");
    try {
      await createHypothesis(note, engineer, photos.length ? photos : undefined);
      setSaved(true); setNote(""); clearPhotos(); await loadNotes();
    } catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
    setSaving(false);
  }

  async function handleEditSave() {
    if (!editNote || !editText.trim()) return;
    setEditSaving(true);
    try { await updateFieldNote(editNote.id, { note: editText }); await loadNotes(); } catch { /* */ }
    setEditSaving(false); setEditNote(null);
  }

  async function handleDelete(id: number) {
    try { await deleteFieldNote(id); await loadNotes(); } catch { /* */ }
    setConfirmDeleteId(null);
  }

  const filtered = notes.filter((n) => {
    if (!feedSearch.trim()) return true;
    const q = feedSearch.trim().toLowerCase();
    return n.raw_transcript?.toLowerCase().includes(q) || n.engineer?.toLowerCase().includes(q);
  });

  return (
    <div className="field-notes-page">
      <h2>Hypotheses</h2>
      <div className="weebo-tabs" style={{ marginBottom: "1.25rem" }}>
        <button className={`weebo-tab${activeTab === "log" ? " active" : ""}`} onClick={() => setActiveTab("log")}>Log Hypothesis</button>
        <button className={`weebo-tab${activeTab === "feed" ? " active" : ""}`} onClick={() => setActiveTab("feed")}>Hypothesis Feed</button>
      </div>

      {activeTab === "feed" ? (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <input type="text" placeholder="Search hypotheses..." value={feedSearch} onChange={(e) => setFeedSearch(e.target.value)}
              style={{ width: "100%", maxWidth: "400px", padding: "0.4rem 0.6rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "0.85rem" }} />
          </div>
          <div className="dash-card">
            <div className="dash-card-header">Hypothesis Feed ({filtered.length})</div>
            <div className="dash-card-body">
              {loadingNotes ? (
                <p className="field-notes-empty">Loading...</p>
              ) : filtered.length === 0 ? (
                <p className="field-notes-empty">No hypotheses found.</p>
              ) : (
                <div className="field-notes-log">
                  {filtered.map((n) => (
                    <div key={n.id} className="field-notes-entry">
                      <div className="field-notes-entry-header">
                        <strong>{n.engineer}</strong>
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
                      <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.4rem" }}>
                        <button className="btn btn-secondary fn-edit-btn" onClick={() => { setEditNote(n); setEditText(n.raw_transcript); }}>Edit</button>
                        {confirmDeleteId === n.id ? (
                          <>
                            <button className="btn btn-secondary fn-edit-btn" style={{ color: "var(--red-600)" }} onClick={() => handleDelete(n.id)}>Confirm Delete</button>
                            <button className="btn btn-secondary fn-edit-btn" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                          </>
                        ) : (
                          <button className="btn btn-secondary fn-edit-btn" onClick={() => setConfirmDeleteId(n.id)}>Delete</button>
                        )}
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
            Log hypotheses and predictions about system behavior.
          </p>

          {error && <div className="wne-error">{error}</div>}
          {saved && <div className="field-notes-success">Hypothesis saved successfully.</div>}

          <div className="dash-card field-notes-input-card">
            <div className="dash-card-header">New Hypothesis</div>
            <div className="dash-card-body">
              <textarea
                rows={4}
                value={note}
                onChange={(e) => { setNote(e.target.value); setSaved(false); }}
                placeholder="Type your hypothesis or prediction here..."
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
                    <button className="btn btn-secondary field-notes-photo-btn" onClick={() => cameraInput.current?.click()}>Take Photo</button>
                    <button className="btn btn-secondary field-notes-photo-btn" onClick={() => fileInput.current?.click()}>Upload Photo{photos.length > 0 ? "s" : ""}</button>
                    {photos.length > 0 && <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{photos.length}/4</span>}
                  </div>
                )}
              </div>
              <div className="field-notes-actions">
                <button className="btn btn-primary field-notes-save-btn" onClick={handleSave} disabled={saving || !note.trim()}>
                  {saving ? "Saving..." : "Save Hypothesis"}
                </button>
                <button className="btn btn-secondary field-notes-discard-btn" onClick={() => { setNote(""); clearPhotos(); setError(""); setSaved(false); }} disabled={saving}>
                  Discard
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {editNote && (
        <div className="fn-modal-overlay" onClick={() => setEditNote(null)}>
          <div className="fn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fn-modal-header">
              <h3>Edit Hypothesis</h3>
              <button className="fn-modal-close" onClick={() => setEditNote(null)}>&times;</button>
            </div>
            <div className="fn-modal-body">
              <label className="fn-modal-label">Hypothesis</label>
              <textarea rows={5} value={editText} onChange={(e) => setEditText(e.target.value)} className="field-notes-textarea" />
            </div>
            <div className="fn-modal-footer">
              <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleEditSave} disabled={editSaving || !editText.trim()}>
                {editSaving ? "Saving..." : "Save"}
              </button>
              <button className="btn btn-secondary" style={{ width: "auto" }} onClick={() => setEditNote(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}
