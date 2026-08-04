import { useState } from "react";
import { submitFeedback } from "../api/client";

interface Props {
  onClose: () => void;
}

const CATEGORIES = [
  { value: "bug", label: "Bug Report" },
  { value: "feature", label: "Feature Request" },
  { value: "general", label: "General Feedback" },
];

export function FeedbackModal({ onClose }: Props) {
  const [category, setCategory] = useState("general");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      await submitFeedback(category, message.trim());
      setSubmitted(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to submit feedback");
    }
    setSubmitting(false);
  }

  return (
    <div className="feedback-overlay" onClick={onClose}>
      <div className="feedback-modal" onClick={(e) => e.stopPropagation()}>
        {submitted ? (
          <>
            <h2>Thanks for your feedback!</h2>
            <p style={{ color: "var(--gray-500)", marginBottom: "1.5rem" }}>
              Your {CATEGORIES.find((c) => c.value === category)?.label.toLowerCase()} has been recorded.
            </p>
            <button className="btn btn-primary" style={{ width: "auto" }} onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2>Send Feedback</h2>
            <p style={{ color: "var(--gray-500)", marginBottom: "1rem", fontSize: "0.9rem" }}>
              Help us improve — report a bug, request a feature, or share your thoughts.
            </p>
            <label className="feedback-label">Category</label>
            <div className="feedback-categories">
              {CATEGORIES.map((c) => (
                <label key={c.value} className="feedback-cat-option">
                  <input
                    type="radio"
                    name="category"
                    value={c.value}
                    checked={category === c.value}
                    onChange={() => setCategory(c.value)}
                  />
                  <span className="feedback-cat-chip">{c.label}</span>
                </label>
              ))}
            </div>
            <label className="feedback-label">Message</label>
            <textarea
              className="feedback-textarea"
              placeholder="Describe the issue or suggestion..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              autoFocus
            />
            <div className="feedback-actions">
              <button type="button" className="btn btn-secondary" style={{ width: "auto" }} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" style={{ width: "auto" }} disabled={submitting || !message.trim()}>
                {submitting ? "Submitting..." : "Submit"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
