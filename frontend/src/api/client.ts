import type { ActionItem, AskResponse, AssemblyInstruction, AssemblyRun, AssemblyStepLog, AssemblyVerification, ChangeEvent, ChangePayload, ComponentPhoto, DashboardData, MemoEntry, PartCatalogEntry, PositionLimit, PositionState, TestReport, TestRun, UsageStats } from "../types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    signal: controller.signal,
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  clearTimeout(timeout);
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

export async function login(username: string, password: string) {
  return request<{ status: string; user: string }>("/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function logout() {
  return request<{ status: string }>("/logout", { method: "POST" });
}

export async function getMe() {
  return request<{ user: string }>("/me");
}

export async function getState(at?: string) {
  const qs = at ? `?at=${encodeURIComponent(at)}` : "";
  return request<PositionState[]>(`/state${qs}`);
}

export async function getHistory(position: string) {
  return request<ChangeEvent[]>(`/component/${encodeURIComponent(position)}/history`);
}

const _catalogCache = new Map<string, PartCatalogEntry[]>();

export async function getPartsCatalog(position?: string) {
  const key = position ?? "__all__";
  const cached = _catalogCache.get(key);
  if (cached) return cached;
  const qs = position ? `?position=${encodeURIComponent(position)}` : "";
  const data = await request<PartCatalogEntry[]>(`/parts-catalog${qs}`);
  _catalogCache.set(key, data);
  return data;
}

export async function getAllUsage() {
  return request<Record<string, { est_cycles: number; runtime_hours: number; installed_since: string | null }>>("/usage", undefined, 120000);
}

export async function getUsage(position: string) {
  return request<UsageStats>(`/component/${encodeURIComponent(position)}/usage`);
}

export async function postChange(payload: ChangePayload) {
  return request<ChangeEvent>("/change", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getPhotos(position: string) {
  return request<ComponentPhoto[]>(`/component/${encodeURIComponent(position)}/photos`);
}

export async function uploadPhoto(
  position: string,
  file: File,
  photoType: string,
  caption: string,
  changeEventId?: number,
) {
  const form = new FormData();
  form.append("file", file);
  form.append("photo_type", photoType);
  form.append("caption", caption);
  if (changeEventId != null) form.append("change_event_id", String(changeEventId));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const res = await fetch(`${BASE}/component/${encodeURIComponent(position)}/photos`, {
    method: "POST",
    credentials: "include",
    signal: controller.signal,
    body: form,
  });
  clearTimeout(timeout);
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<ComponentPhoto>;
}

export async function deletePhoto(photoId: number) {
  return request<{ status: string }>(`/photo/${photoId}`, { method: "DELETE" });
}

export async function getActiveTestRun() {
  return request<TestRun | null>("/test-run/active");
}

export async function getTestRunHistory() {
  return request<TestRun[]>("/test-run/history");
}

export async function startTestRun(testType: "simplex" | "triplex") {
  return request<TestRun>("/test-run/start", {
    method: "POST",
    body: JSON.stringify({ test_type: testType }),
  });
}

export async function advanceTestRun(runId: number, checklistState?: Record<string, string>) {
  return request<TestRun>(`/test-run/${runId}/advance`, {
    method: "POST",
    body: JSON.stringify({ checklist_state: JSON.stringify(checklistState ?? {}) }),
  });
}

export async function cancelTestRun(runId: number) {
  return request<{ cancelled: boolean; id: number }>(`/test-run/${runId}/cancel`, {
    method: "POST",
  });
}

export async function updateChecklist(runId: number, checklistState: Record<string, string>) {
  return request<TestRun>(`/test-run/${runId}/checklist`, {
    method: "PUT",
    body: JSON.stringify({ checklist_state: JSON.stringify(checklistState) }),
  });
}

export async function updateNotes(runId: number, notes: string) {
  return request<TestRun>(`/test-run/${runId}/notes`, {
    method: "PUT",
    body: JSON.stringify({ notes }),
  });
}

export async function verifyAssembly() {
  return request<AssemblyVerification>("/test-run/verify-assembly");
}

export async function getMemos(filters: Record<string, string> = {}) {
  const qs = new URLSearchParams(filters).toString();
  return request<MemoEntry[]>(`/memos${qs ? `?${qs}` : ""}`);
}

export async function updateMemo(id: number, fields: Record<string, unknown>) {
  return request<MemoEntry>(`/memos/${id}`, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}

export async function deleteMemo(id: number) {
  return request<{ status: string }>(`/memos/${id}`, { method: "DELETE" });
}

export async function getEngineers() {
  return request<string[]>("/memos/engineers");
}

export async function transcribeAudio(file: File) {
  const form = new FormData();
  form.append("file", file);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  const res = await fetch(`${BASE}/memos/transcribe`, {
    method: "POST",
    credentials: "include",
    signal: controller.signal,
    body: form,
  });
  clearTimeout(timeout);
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<{ transcript: string }>;
}

export async function extractInsights(transcript: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const res = await fetch(`${BASE}/memos/extract`, {
    method: "POST",
    credentials: "include",
    signal: controller.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });
  clearTimeout(timeout);
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

export async function createMemo(fields: Record<string, unknown>) {
  return request<MemoEntry>("/memos", {
    method: "POST",
    body: JSON.stringify(fields),
  });
}

export async function getActions(filters: Record<string, string> = {}) {
  const qs = new URLSearchParams(filters).toString();
  return request<ActionItem[]>(`/actions${qs ? `?${qs}` : ""}`);
}

export async function createAction(fields: Record<string, unknown>) {
  return request<ActionItem>("/actions", {
    method: "POST",
    body: JSON.stringify(fields),
  });
}

export async function updateAction(id: number, fields: Record<string, unknown>) {
  return request<ActionItem>(`/actions/${id}`, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}

export async function deleteAction(id: number) {
  return request<{ status: string }>(`/actions/${id}`, { method: "DELETE" });
}

export async function askWeebo(question: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const res = await fetch(`${BASE}/ask`, {
    method: "POST",
    credentials: "include",
    signal: controller.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  clearTimeout(timeout);
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<AskResponse>;
}

// ── Assembly Instructions ──

export async function getInstructions(subPage: string) {
  return request<AssemblyInstruction[]>(`/assembly/instructions/${subPage}`);
}

export async function addInstruction(subPage: string, fields: Record<string, unknown>) {
  return request<AssemblyInstruction>(`/assembly/instructions/${subPage}`, {
    method: "POST",
    body: JSON.stringify(fields),
  });
}

export async function updateInstruction(subPage: string, id: number, fields: Record<string, unknown>) {
  return request<AssemblyInstruction>(`/assembly/instructions/${subPage}/${id}`, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}

export async function deleteInstruction(subPage: string, id: number) {
  return request<{ status: string }>(`/assembly/instructions/${subPage}/${id}`, { method: "DELETE" });
}

export async function reorderInstructions(subPage: string, order: number[]) {
  return request<{ status: string }>(`/assembly/instructions/${subPage}/reorder`, {
    method: "PUT",
    body: JSON.stringify({ order }),
  });
}

// ── Assembly Runs ──

export async function getAssemblyRuns(subPage: string) {
  return request<AssemblyRun[]>(`/assembly/runs/${subPage}`);
}

export async function startAssemblyRun(subPage: string, pumpHead: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const res = await fetch(`${BASE}/assembly/runs/${subPage}/start`, {
    method: "POST",
    credentials: "include",
    signal: controller.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pump_head: pumpHead }),
  });
  clearTimeout(timeout);
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<AssemblyRun>;
}

export async function getAssemblyRun(runId: number) {
  return request<AssemblyRun>(`/assembly/runs/${runId}`);
}

export async function updateAssemblyStep(runId: number, stepId: number, fields: Record<string, unknown>) {
  return request<AssemblyStepLog>(`/assembly/runs/${runId}/step/${stepId}`, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}

export async function deleteAssemblyRun(runId: number) {
  return request<{ status: string }>(`/assembly/runs/${runId}`, { method: "DELETE" });
}

export async function completeAssemblyRun(runId: number) {
  return request<AssemblyRun>(`/assembly/runs/${runId}/complete`, { method: "POST" });
}

export async function getFeedback(category?: string) {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  return request<{ id: number; category: string; message: string; submitted_by: string; created_at: string }[]>(`/feedback${qs}`);
}

export async function resolveFeedback(feedbackId: number) {
  return request<{ status: string }>(`/feedback/${feedbackId}/resolve`, { method: "POST" });
}

// ── Dashboard & Limits ──

export async function getDashboard() {
  return request<DashboardData>("/dashboard");
}

export async function getPositionLimits() {
  return request<PositionLimit[]>("/position-limits");
}

export async function upsertPositionLimit(position: string, limitType: string, limitValue: number) {
  return request<PositionLimit>("/position-limits", {
    method: "POST",
    body: JSON.stringify({ position, limit_type: limitType, limit_value: limitValue }),
  });
}

export async function deletePositionLimit(position: string) {
  return request<{ deleted: boolean }>(`/position-limits/${encodeURIComponent(position)}`, {
    method: "DELETE",
  });
}

export async function getTestReport(runId: number) {
  return request<TestReport>(`/test-run/${runId}/report`);
}

export async function submitFeedback(category: string, message: string) {
  return request<{ id: number }>("/feedback", {
    method: "POST",
    body: JSON.stringify({ category, message }),
  });
}
