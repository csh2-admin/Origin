import { useEffect, useRef, useState } from "react";
import { createVoiceNote, getVoiceNotes, transcribeAudio } from "../api/client";

interface VoiceNoteEntry {
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
  const [recording, setRecording] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<VoiceNoteEntry[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  useEffect(() => {
    getVoiceNotes()
      .then(setNotes)
      .catch(() => {})
      .finally(() => setLoadingNotes(false));
  }, []);

  async function startRecording() {
    setError("");
    setSaved(false);
    setTranscript("");
    setAudioFile(null);
    setAudioUrl(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunks.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunks.current, { type: "audio/webm" });
        const file = new File([blob], "voice-note.webm", { type: "audio/webm" });
        setAudioFile(file);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
        handleTranscribe(file);
      };
      mediaRecorder.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError("Microphone access denied. Check your browser permissions.");
    }
  }

  function stopRecording() {
    if (mediaRecorder.current && mediaRecorder.current.state !== "inactive") {
      mediaRecorder.current.stop();
    }
    setRecording(false);
  }

  async function handleTranscribe(file: File) {
    setTranscribing(true);
    setError("");
    try {
      const result = await transcribeAudio(file);
      setTranscript(result.transcript);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed");
    }
    setTranscribing(false);
  }

  async function handleSave() {
    if (!audioFile || !transcript.trim()) return;
    setSaving(true);
    setError("");
    try {
      await createVoiceNote(audioFile, transcript, engineer);
      setSaved(true);
      setAudioFile(null);
      setAudioUrl(null);
      setTranscript("");
      const updated = await getVoiceNotes();
      setNotes(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
    setSaving(false);
  }

  function handleDiscard() {
    setAudioFile(null);
    setAudioUrl(null);
    setTranscript("");
    setError("");
    setSaved(false);
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 800, margin: "0 auto" }}>
      <h2>Log Voice Note</h2>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        Record a voice note, review the AI transcription, and save.
      </p>

      {error && <div className="wne-error">{error}</div>}
      {saved && (
        <div style={{ background: "color-mix(in srgb, var(--green-600) 10%, transparent)", border: "1px solid var(--green-600)", borderRadius: "var(--radius)", padding: "0.75rem 1rem", marginBottom: "1rem", fontSize: "0.85rem", color: "var(--green-600)" }}>
          Voice note saved successfully.
        </div>
      )}

      {/* Recording controls */}
      <div className="dash-card" style={{ marginBottom: "1.5rem" }}>
        <div className="dash-card-header">Record</div>
        <div className="dash-card-body">
          {!audioFile && !recording && (
            <button className="btn wne-record-btn" style={{ width: "auto" }} onClick={startRecording}>
              <span className="wne-record-dot" /> Start Recording
            </button>
          )}
          {recording && (
            <button className="btn wne-record-btn recording" style={{ width: "auto" }} onClick={stopRecording}>
              <span className="wne-record-dot" /> Stop Recording
            </button>
          )}
          {audioUrl && !recording && (
            <div style={{ marginTop: "0.75rem" }}>
              <audio controls src={audioUrl} style={{ width: "100%", maxWidth: 400 }} />
            </div>
          )}
          {transcribing && (
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.75rem" }}>Transcribing audio...</p>
          )}
        </div>
      </div>

      {/* Transcript review */}
      {(transcript || transcribing) && !recording && (
        <div className="dash-card" style={{ marginBottom: "1.5rem" }}>
          <div className="dash-card-header">Transcript</div>
          <div className="dash-card-body">
            <textarea
              rows={6}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              disabled={transcribing}
              placeholder="Transcription will appear here..."
              style={{ width: "100%", fontFamily: "inherit", fontSize: "0.85rem", padding: "0.5rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
              <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleSave} disabled={saving || transcribing || !transcript.trim()}>
                {saving ? "Saving..." : "Save Voice Note"}
              </button>
              <button className="btn btn-secondary" style={{ width: "auto" }} onClick={handleDiscard} disabled={saving}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voice note log */}
      <div className="dash-card">
        <div className="dash-card-header">Voice Note Log</div>
        <div className="dash-card-body">
          {loadingNotes ? (
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Loading...</p>
          ) : notes.length === 0 ? (
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No voice notes recorded yet.</p>
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
                    <audio controls src={n.audio_url} style={{ width: "100%", maxWidth: 350, marginTop: "0.25rem" }} />
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
