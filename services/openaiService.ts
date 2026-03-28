import { Flashcard } from "../types.ts";

const AUTH_TOKEN_KEY = "eduboost_auth_token";
const AUTH_ROLE_KEY = "eduboost_auth_role";

export type UserRole = "student" | "professor";
export type EvernoteNote = {
  id: string;
  courseId: string;
  title: string;
  content: string;
  link?: string;
  createdAt: string;
};
export type LearningContentItem = {
  id: string;
  courseId: string;
  type: "PDF" | "LIEN";
  title: string;
  url: string;
  createdAt: string;
};
export type AccessMetrics = {
  total: number;
  student: number;
  professor: number;
  firstAccessAt: string | null;
  lastAccessAt: string | null;
};
export type AnalyticsSummary = {
  pageViews: { section: string; count: number }[];
  courseViews: { courseId: string; count: number }[];
  podcastOpens: number;
  externalClicks: {
    blog: number;
    contact: number;
    zoom: number;
  };
};
export type ContactRequest = {
  id: string;
  name: string;
  email: string;
  university: string;
  courseGroup?: string;
  message?: string;
  selections: string[];
  createdAt: string;
};
export type OrderEntityType = "notes" | "resources";
export type AuthStatus = {
  authenticated: boolean;
  role: UserRole;
  unlockedCourseIds: string[];
  lockedCourseIds: string[];
};

type ApiErrorShape = {
  error?: {
    code?: string;
    message?: string;
  } | string;
};

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function buildHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function postJson<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as ApiErrorShape & T;
  if (!response.ok) {
    if (typeof data?.error === "string") throw new Error(data.error);
    throw new Error(data?.error?.message || "Request failed");
  }
  return data as T;
}

async function putJson<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as ApiErrorShape & T;
  if (!response.ok) {
    if (typeof data?.error === "string") throw new Error(data.error);
    throw new Error(data?.error?.message || "Request failed");
  }
  return data as T;
}

async function getJson<T>(endpoint: string): Promise<T> {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: buildHeaders(),
  });
  const data = (await response.json()) as ApiErrorShape & T;
  if (!response.ok) {
    if (typeof data?.error === "string") throw new Error(data.error);
    throw new Error(data?.error?.message || "Request failed");
  }
  return data as T;
}

async function deleteJson<T>(endpoint: string): Promise<T> {
  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: buildHeaders(),
  });
  const data = (await response.json()) as ApiErrorShape & T;
  if (!response.ok) {
    if (typeof data?.error === "string") throw new Error(data.error);
    throw new Error(data?.error?.message || "Request failed");
  }
  return data as T;
}

function readLocal<T>(key: string): T[] {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeLocal<T>(key: string, value: T[]) {
  localStorage.setItem(key, JSON.stringify(value));
}

function fallbackSummary(content: string) {
  const clean = content.replace(/\s+/g, " ").trim();
  const slices = clean.split(".").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  if (!slices.length) return "Résumé indisponible.";
  return slices.map((line) => `• ${line}.`).join("\n");
}

function fallbackFlashcards(content: string): Flashcard[] {
  const sentences = content
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!sentences.length) return [];
  return sentences.map((sentence, index) => ({
    id: `local-${index + 1}`,
    question: `Point clé ${index + 1} du cours ?`,
    answer: sentence,
  }));
}

export async function loginWithPassword(password: string, role: UserRole = "student"): Promise<UserRole> {
  if (!password.trim()) throw new Error("Mot de passe requis.");
  const endpoint = role === "professor" ? "/api/auth/prof-login" : "/api/auth/login";
  const response = await postJson<{ token?: string; role?: UserRole }>(endpoint, { password });
  if (!response.token) throw new Error("Invalid response");
  localStorage.setItem(AUTH_TOKEN_KEY, response.token);
  localStorage.setItem(AUTH_ROLE_KEY, response.role || role);
  return response.role || role;
}

export async function checkAuthStatus(): Promise<AuthStatus> {
  const response = await getJson<{
    authenticated?: boolean;
    role?: UserRole;
    unlockedCourseIds?: string[];
    lockedCourseIds?: string[];
  }>("/api/auth/status");
  return {
    authenticated: Boolean(response?.authenticated),
    role: response?.role || "student",
    unlockedCourseIds: Array.isArray(response?.unlockedCourseIds) ? response.unlockedCourseIds : [],
    lockedCourseIds: Array.isArray(response?.lockedCourseIds) ? response.lockedCourseIds : [],
  };
}

export async function unlockCourseWithPassword(courseId: string, password: string): Promise<string[]> {
  if (!courseId.trim()) throw new Error("Cours introuvable.");
  if (!password.trim()) throw new Error("Mot de passe du cours requis.");
  const response = await postJson<{ unlockedCourseIds?: string[] }>("/api/auth/course-login", { courseId, password });
  return Array.isArray(response?.unlockedCourseIds) ? response.unlockedCourseIds : [];
}

export async function listCourseFlashcards(courseId: string): Promise<Flashcard[]> {
  const response = await getJson<{ flashcards?: Flashcard[] }>(`/api/flashcards?courseId=${encodeURIComponent(courseId)}`);
  return response.flashcards || [];
}

export async function createCourseFlashcard(payload: {
  courseId: string;
  question: string;
  answer: string;
  justification?: string;
  commonMistakes?: { answer: string; explanation: string }[];
}): Promise<Flashcard> {
  const response = await postJson<{ flashcard?: Flashcard }>("/api/flashcards", payload);
  if (!response.flashcard) throw new Error("Impossible de créer la carte.");
  return response.flashcard;
}

export async function updateCourseFlashcard(
  id: string,
  payload: {
    question: string;
    answer: string;
    justification?: string;
    commonMistakes?: { answer: string; explanation: string }[];
  },
): Promise<Flashcard> {
  const response = await putJson<{ flashcard?: Flashcard }>(`/api/flashcards/${encodeURIComponent(id)}`, payload);
  if (!response.flashcard) throw new Error("Impossible de modifier la carte.");
  return response.flashcard;
}

export async function removeCourseFlashcard(id: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(`/api/flashcards/${encodeURIComponent(id)}`);
}

export function logout() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_ROLE_KEY);
}

export const summarizeContent = async (content: string): Promise<string> => {
  try {
    const response = await postJson<{ summary?: string }>("/api/summarize", { content });
    return response.summary || fallbackSummary(content);
  } catch {
    return fallbackSummary(content);
  }
};

export const generateFlashcards = async (content: string): Promise<Flashcard[]> => {
  try {
    const response = await postJson<{ flashcards?: Flashcard[] }>("/api/flashcards/ai", { content });
    return response.flashcards || fallbackFlashcards(content);
  } catch {
    return fallbackFlashcards(content);
  }
};

export const generatePodcastAudio = async (text: string): Promise<string> => {
  try {
    const response = await postJson<{ audioDataUrl?: string }>("/api/podcast", { text });
    if (!response.audioDataUrl) throw new Error("No audio");
    return response.audioDataUrl;
  } catch {
    throw new Error("Audio IA indisponible dans cette version web simple.");
  }
};

export async function listEvernoteNotes(courseId: string): Promise<EvernoteNote[]> {
  const response = await getJson<{ notes?: EvernoteNote[] }>(`/api/notes?courseId=${encodeURIComponent(courseId)}`);
  return response.notes || [];
}

export async function createEvernoteNote(payload: {
  courseId: string;
  title: string;
  content?: string;
  link?: string;
}): Promise<EvernoteNote> {
  const response = await postJson<{ note?: EvernoteNote }>("/api/notes", payload);
  if (!response.note) throw new Error("Impossible de créer la note.");
  return response.note;
}

export async function removeEvernoteNote(id: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(`/api/notes/${encodeURIComponent(id)}`);
}

export async function updateEvernoteNote(
  id: string,
  payload: { title: string; content?: string; link?: string },
): Promise<EvernoteNote> {
  const response = await putJson<{ note?: EvernoteNote }>(`/api/notes/${encodeURIComponent(id)}`, payload);
  if (!response.note) throw new Error("Impossible de modifier la note.");
  return response.note;
}

export async function listCourseContent(courseId: string): Promise<LearningContentItem[]> {
  const response = await getJson<{ resources?: LearningContentItem[] }>(`/api/resources?courseId=${encodeURIComponent(courseId)}`);
  return response.resources || [];
}

export async function createCourseContent(payload: {
  courseId: string;
  type: "PDF" | "LIEN";
  title: string;
  url: string;
}): Promise<LearningContentItem> {
  const response = await postJson<{ resource?: LearningContentItem }>("/api/resources", payload);
  if (!response.resource) throw new Error("Impossible de créer le contenu.");
  return response.resource;
}

export async function removeCourseContent(id: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(`/api/resources/${encodeURIComponent(id)}`);
}

export async function updateCourseContent(
  id: string,
  payload: { type: "PDF" | "LIEN"; title: string; url: string },
): Promise<LearningContentItem> {
  const response = await putJson<{ resource?: LearningContentItem }>(`/api/resources/${encodeURIComponent(id)}`, payload);
  if (!response.resource) throw new Error("Impossible de modifier le contenu.");
  return response.resource;
}

export async function getAccessMetrics(): Promise<AccessMetrics> {
  const response = await getJson<Partial<AccessMetrics>>("/api/access-metrics");
  return {
    total: Number(response.total || 0),
    student: Number(response.student || 0),
    professor: Number(response.professor || 0),
    firstAccessAt: response.firstAccessAt || null,
    lastAccessAt: response.lastAccessAt || null,
  };
}

export async function trackAnalyticsEvent(payload: {
  type: string;
  section?: string;
  courseId?: string;
  target?: string;
  label?: string;
}): Promise<void> {
  try {
    await postJson<{ ok?: boolean }>("/api/analytics/event", payload);
  } catch (_error) {
    // Analytics should never block the app.
  }
}

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  const response = await getJson<Partial<AnalyticsSummary>>("/api/analytics-summary");
  return {
    pageViews: Array.isArray(response.pageViews) ? response.pageViews : [],
    courseViews: Array.isArray(response.courseViews) ? response.courseViews : [],
    podcastOpens: Number(response.podcastOpens || 0),
    externalClicks: {
      blog: Number(response.externalClicks?.blog || 0),
      contact: Number(response.externalClicks?.contact || 0),
      zoom: Number(response.externalClicks?.zoom || 0),
    },
  };
}

export async function submitContactRequest(payload: {
  name: string;
  email: string;
  university: string;
  courseGroup?: string;
  message?: string;
  selections?: string[];
}): Promise<void> {
  await postJson<{ ok?: boolean }>("/api/contact-requests", payload);
}

export async function listContactRequests(): Promise<ContactRequest[]> {
  const response = await getJson<{ requests?: ContactRequest[] }>("/api/contact-requests");
  return Array.isArray(response.requests) ? response.requests : [];
}

export async function removeContactRequest(id: string): Promise<void> {
  await deleteJson<{ ok?: boolean }>(`/api/contact-requests/${encodeURIComponent(id)}`);
}

export async function saveCourseOrder(
  entityType: OrderEntityType,
  courseId: string,
  orderedIds: string[],
): Promise<void> {
  await putJson<{ ok?: boolean }>("/api/order", {
    entityType,
    courseId,
    orderedIds,
  });
}
