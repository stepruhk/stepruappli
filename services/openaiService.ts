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

export async function checkAuthStatus(): Promise<{ authenticated: boolean; role: UserRole }> {
  const response = await getJson<{ authenticated?: boolean; role?: UserRole }>("/api/auth/status");
  return {
    authenticated: Boolean(response?.authenticated),
    role: response?.role || "student",
  };
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
    const response = await postJson<{ flashcards?: Flashcard[] }>("/api/flashcards", { content });
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
