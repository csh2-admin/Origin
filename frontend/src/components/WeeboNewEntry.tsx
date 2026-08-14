import { useRef, useState } from "react";
import { createMemo, extractInsights } from "../api/client";

const ACTIVITY_TYPES = [
  "Action Item",
  "Qualitative Observation",
  "System Maintenance",
  "Performance - Quantitative",
  "Hypothesis",
  "Other",
];

const SEVERITIES = ["Critical", "High", "Medium", "Low", "None"];

const AUDIO_ACCEPT = ".wav,.mp3,.m4a,.ogg,.flac,.webm,.mp4,.aac";

interface Fields {
  activity_type: string;
  summary: string;
  system_performance: string;
  maintenance_done: string;
  issues_found: string;
  action_items: string;
  components_affected: string;
  duration_hours: string;
  severity: string;
  additional_notes: string;
  trigger_sim_update: boolean;
}

const EMPTY_FIELDS: Fields = {
  activity_type: "Other",
  summary: "",
  system_performance: "",
  maintenance_done: "",
  issues_found: "",
  action_items: "",
  components_affected: "",
  duration_hours: "",
  severity: "None",
  additional_notes: "",
  trigger_sim_update: false,
};

export function WeeboNewEntry({ engineer, onSaved }: { engineer: string; onSaved: () => void }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [fields, setFields] = useState<Fields>({ ...EMPTY_FIELDS });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  function updateField<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function startRecording() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunks.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunks.current, { type: "audio/webm" });
        const recordedFile = new File([blob], "recording.webm", { type: "audio/webm" });
        setFile(recordedFile);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
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

  function handleTranscribe() {
    if (!file) return;
    setStep(2);
  }

  async function handleExtract() {
    if (!transcript.trim()) return;
    setProcessing(true);
    setError("");
    try {
      const data = await extractInsights(transcript);
      setFields({
        activity_type: (data.activity_type as string) || "Other",
        summary: (data.summary as string) || "",
        system_performance: (data.system_performance as string) || "",
        maintenance_done: (data.maintenance_done as string) || "",
        issues_found: (data.issues_found as string) || "",
        action_items: (data.action_items as string) || "",
        components_affected: (data.components_affected as string) || "",
        duration_hours: (data.duration_hours as string) || "",
        severity: (data.severity as string) || "None",
        additional_notes: (data.additional_notes as string) || "",
        trigger_sim_update: !!data.trigger_sim_update,
      });
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    }
    setProcessing(false);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await createMemo({
        ...fields,
        engineer,
        source_file: file?.name === "recording.webm" ? "Voice Recording" : file?.name || "Manual Entry",
        raw_transcript: transcript,
        raw_insights: fields,
      });
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
    setSaving(false);
  }

  function handleReset() {
    setStep(1);
    setFile(null);
    setTranscript("");
    setFields({ ...EMPTY_FIELDS });
    setError("");
  }

  const stepLabels = ["Audio", "Transcript", "Review", "Done"];

  return (
    <div className="weebo-new-entry">
      <h2>New Entry</h2>

      {/* Stepper */}
      <div className="stepper" style={{ marginBottom: "1.5rem" }}>
        {stepLabels.map((label, i) => (
          <div key={label} className={`stepper-step${i + 1 === step ? " active" : ""}${i + 1 < step ? " done" : ""}`}>
            <div className="stepper-dot">{i + 1 < step ? "✓" : i + 1}</div>
            <div className="stepper-label">{label}</div>
            {i < stepLabels.length - 1 && <div className="stepper-line" />}
          </div>
        ))}
      </div>

      {error && <div className="wne-error">{error}</div>}

      {/* Step 1: Audio */}
      <div className="wne-card" style={{ display: step === 1 ? undefined : "none" }}>
        <h3>Record or Upload Audio</h3>
        <p>Record a voice log directly, or upload an existing audio file. Transcribe externally, then paste in the next step.</p>

        <div className="wne-record-section">
          {recording ? (
            <button className="btn wne-record-btn recording" style={{ width: "auto" }} onClick={stopRecording}>
              <span className="wne-record-dot" /> Stop Recording
            </button>
          ) : (
            <button className="btn wne-record-btn" style={{ width: "auto" }} onClick={startRecording} disabled={processing}>
              <span className="wne-record-dot" /> Record Voice Log
            </button>
          )}
          {audioUrl && !recording && (
            <audio controls src={audioUrl} className="wne-audio-player" />
          )}
        </div>

        <div className="wne-divider">
          <span>or upload a file</span>
        </div>

        <input
          type="file"
          accept={AUDIO_ACCEPT}
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            setFile(f);
            setAudioUrl(null);
          }}
          className="wne-file-input"
        />
        {file && !audioUrl && (
          <div className="wne-file-info">
            {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
          </div>
        )}
        <div className="wne-actions">
          <button
            className="btn btn-primary"
            style={{ width: "auto" }}
            onClick={handleTranscribe}
            disabled={!file || recording}
          >
            Continue
          </button>
          <button
            className="btn btn-secondary"
            style={{ width: "auto" }}
            onClick={() => setStep(2)}
          >
            Skip — Enter Manually
          </button>
        </div>
      </div>

      {/* Step 2: Transcript */}
      <div className="wne-card" style={{ display: step === 2 ? undefined : "none" }}>
        <h3>Transcript</h3>
        <p>Review and edit the transcript, then extract structured fields.</p>
        <textarea
          className="wne-transcript"
          rows={10}
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Paste or type transcript here..."
        />
        <div className="wne-actions">
          <button className="btn btn-secondary" style={{ width: "auto" }} onClick={() => setStep(1)}>
            Back
          </button>
          <button
            className="btn btn-primary"
            style={{ width: "auto" }}
            onClick={handleExtract}
            disabled={!transcript.trim() || processing}
          >
            {processing ? "Extracting..." : "Extract with AI"}
          </button>
          <button
            className="btn btn-secondary"
            style={{ width: "auto" }}
            onClick={() => setStep(3)}
          >
            Skip — Fill Manually
          </button>
        </div>
      </div>

      {/* Step 3: Review & Save */}
      <div className="wne-card" style={{ display: step === 3 ? undefined : "none" }}>
          <h3>Review & Save</h3>
          <p>Edit extracted fields before saving.</p>
          <div className="wne-form-grid">
            <div className="wne-form-field">
              <label>Activity Type</label>
              <select value={fields.activity_type} onChange={(e) => updateField("activity_type", e.target.value)}>
                {ACTIVITY_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="wne-form-field">
              <label>Severity</label>
              <select value={fields.severity} onChange={(e) => updateField("severity", e.target.value)}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="wne-form-field">
              <label>Duration (hrs)</label>
              <input type="text" value={fields.duration_hours} onChange={(e) => updateField("duration_hours", e.target.value)} />
            </div>
            <div className="wne-form-field">
              <label>Components Affected</label>
              <input type="text" value={fields.components_affected} onChange={(e) => updateField("components_affected", e.target.value)} />
            </div>
            <div className="wne-form-field full">
              <label>Summary</label>
              <textarea rows={2} value={fields.summary} onChange={(e) => updateField("summary", e.target.value)} />
            </div>
            <div className="wne-form-field full">
              <label>System Performance</label>
              <textarea rows={2} value={fields.system_performance} onChange={(e) => updateField("system_performance", e.target.value)} />
            </div>
            <div className="wne-form-field full">
              <label>Maintenance Done</label>
              <textarea rows={2} value={fields.maintenance_done} onChange={(e) => updateField("maintenance_done", e.target.value)} />
            </div>
            <div className="wne-form-field full">
              <label>Issues Found</label>
              <textarea rows={2} value={fields.issues_found} onChange={(e) => updateField("issues_found", e.target.value)} />
            </div>
            <div className="wne-form-field full">
              <label>Action Items</label>
              <textarea rows={2} value={fields.action_items} onChange={(e) => updateField("action_items", e.target.value)} />
            </div>
            <div className="wne-form-field full">
              <label>Additional Notes</label>
              <textarea rows={2} value={fields.additional_notes} onChange={(e) => updateField("additional_notes", e.target.value)} />
            </div>
            <div className="wne-form-field">
              <label className="wne-checkbox-label">
                <input
                  type="checkbox"
                  checked={fields.trigger_sim_update}
                  onChange={(e) => updateField("trigger_sim_update", e.target.checked)}
                />
                Trigger simulation update
              </label>
            </div>
          </div>
          <div className="wne-actions">
            <button className="btn btn-secondary" style={{ width: "auto" }} onClick={() => setStep(2)}>
              Back
            </button>
            <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Entry"}
            </button>
          </div>
      </div>

      {/* Step 4: Done */}
      {step === 4 && (
        <div className="wne-card" style={{ textAlign: "center" }}>
          <h3>Entry Saved</h3>
          <p>Your memo has been logged successfully.</p>
          <div className="wne-actions" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleReset}>
              New Entry
            </button>
            <button className="btn btn-secondary" style={{ width: "auto" }} onClick={onSaved}>
              View Records
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
