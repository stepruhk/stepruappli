import crypto from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import fs from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: "env.local" });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const APP_PASSWORD = (process.env.APP_PASSWORD || "").trim();
const PROF_PASSWORD = (process.env.PROF_PASSWORD || "").trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 30);
const MAX_CONTENT_LENGTH = Number(process.env.MAX_CONTENT_LENGTH || 12_000);
const MAX_PODCAST_TEXT_LENGTH = Number(process.env.MAX_PODCAST_TEXT_LENGTH || 8_000);
const MAX_PASSWORD_LENGTH = Number(process.env.MAX_PASSWORD_LENGTH || 256);
const MAX_URL_LENGTH = Number(process.env.MAX_URL_LENGTH || 30_000_000);
const MAX_TITLE_LENGTH = Number(process.env.MAX_TITLE_LENGTH || 180);
const MAX_JSON_BODY_LIMIT = String(process.env.MAX_JSON_BODY_LIMIT || "35mb");

const rateBuckets = new Map();
const authSessions = new Map();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const storageFilePath = process.env.STORAGE_FILE || path.resolve(__dirname, "../data/app-data.json");
let storeCache = null;
const hasSupabaseStorage = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

app.use(express.json({ limit: MAX_JSON_BODY_LIMIT }));
app.set("trust proxy", true);

class ApiError extends Error {
  constructor(status, code, message, details, requestId) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

function normalizeError(error) {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details || null,
          requestId: error.requestId || null,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected server error.",
        details: null,
        requestId: null,
      },
    },
  };
}

function sendError(res, error) {
  const normalized = normalizeError(error);
  res.status(normalized.status).json(normalized.body);
}

function requireApiKey() {
  if (!OPENAI_API_KEY) {
    throw new ApiError(500, "MISSING_API_KEY", "Missing OPENAI_API_KEY on server.");
  }
}

function isAuthEnabled() {
  return APP_PASSWORD.length > 0;
}

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function rateLimitMiddleware(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const current = rateBuckets.get(ip);

  if (!current || current.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.set("Retry-After", String(retryAfterSeconds));
    sendError(
      res,
      new ApiError(429, "RATE_LIMITED", "Too many requests. Please retry later.", {
        retryAfterSeconds,
        windowMs: RATE_LIMIT_WINDOW_MS,
        maxRequests: RATE_LIMIT_MAX_REQUESTS,
      }),
    );
    return;
  }

  current.count += 1;
  next();
}

function readRequiredTextField(body, fieldName, maxLength) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "INVALID_INPUT", "Request body must be a JSON object.");
  }

  if (typeof body[fieldName] !== "string") {
    throw new ApiError(400, "INVALID_INPUT", `Field "${fieldName}" must be a string.`);
  }

  const value = body[fieldName].trim();
  if (!value) {
    throw new ApiError(400, "INVALID_INPUT", `Field "${fieldName}" cannot be empty.`);
  }
  if (value.length > maxLength) {
    throw new ApiError(400, "INPUT_TOO_LARGE", `Field "${fieldName}" exceeds maximum length.`, {
      field: fieldName,
      maxLength,
    });
  }

  return value;
}

function createSessionToken(role = "student") {
  const token = crypto.randomBytes(32).toString("hex");
  authSessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS, role });
  return token;
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

function hasValidSession(token) {
  if (!token) return false;
  const session = authSessions.get(token);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    authSessions.delete(token);
    return false;
  }
  return true;
}

function getSessionRole(token) {
  if (!token) return "student";
  const session = authSessions.get(token);
  if (!session) return "student";
  return session.role || "student";
}

function requireAuth(req, _res, next) {
  if (!isAuthEnabled()) {
    next();
    return;
  }

  const token = getBearerToken(req);
  if (!hasValidSession(token)) {
    next(new ApiError(401, "UNAUTHORIZED", "Mot de passe requis ou session expirée."));
    return;
  }

  next();
}

function getCurrentSessionRole(req) {
  const token = getBearerToken(req);
  return hasValidSession(token) ? getSessionRole(token) : "student";
}

function requireProfessor(req) {
  const role = getCurrentSessionRole(req);
  if (role !== "professor") {
    throw new ApiError(403, "FORBIDDEN", "Action réservée au professeur.");
  }
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function readOptionalTextField(body, fieldName, maxLength) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "INVALID_INPUT", "Request body must be a JSON object.");
  }
  const value = body[fieldName];
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_INPUT", `Field "${fieldName}" must be a string.`);
  }
  const cleaned = value.trim();
  if (cleaned.length > maxLength) {
    throw new ApiError(400, "INPUT_TOO_LARGE", `Field "${fieldName}" exceeds maximum length.`, {
      field: fieldName,
      maxLength,
    });
  }
  return cleaned;
}

async function ensureStoreLoaded() {
  if (storeCache) return storeCache;

  const dir = path.dirname(storageFilePath);
  await fs.mkdir(dir, { recursive: true });

  try {
    const raw = await fs.readFile(storageFilePath, "utf8");
    const parsed = JSON.parse(raw);
    storeCache = {
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      resources: Array.isArray(parsed.resources) ? parsed.resources : [],
    };
  } catch (_error) {
    storeCache = { notes: [], resources: [] };
    await fs.writeFile(storageFilePath, JSON.stringify(storeCache, null, 2), "utf8");
  }

  return storeCache;
}

async function saveStore() {
  if (!storeCache) return;
  await fs.writeFile(storageFilePath, JSON.stringify(storeCache, null, 2), "utf8");
}

async function supabaseRequest(pathname, init = {}, { allowNotFound = false } = {}) {
  if (!hasSupabaseStorage) {
    throw new ApiError(500, "STORAGE_NOT_CONFIGURED", "Supabase storage is not configured.");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (allowNotFound && response.status === 404) return null;

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ApiError(502, "STORAGE_ERROR", "Storage backend request failed.", {
      status: response.status,
      body: text || null,
      path: pathname,
    });
  }

  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

setInterval(() => {
  const now = Date.now();

  for (const [ip, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateBuckets.delete(ip);
    }
  }

  for (const [token, session] of authSessions.entries()) {
    if (session.expiresAt <= now) {
      authSessions.delete(token);
    }
  }
}, Math.max(30_000, RATE_LIMIT_WINDOW_MS)).unref();

async function readOpenAiError(response) {
  const requestId = response.headers.get("x-request-id");
  const contentType = response.headers.get("content-type") || "";
  let raw = "";
  let parsed = null;

  if (contentType.includes("application/json")) {
    parsed = await response.json().catch(() => null);
  } else {
    raw = await response.text().catch(() => "");
  }

  const upstreamMessage = parsed?.error?.message || raw || "OpenAI request failed.";

  if (response.status === 429) {
    return new ApiError(429, "UPSTREAM_RATE_LIMIT", "OpenAI rate limit reached. Retry later.", {
      upstreamMessage,
    }, requestId);
  }
  if (response.status === 401 || response.status === 403) {
    return new ApiError(502, "UPSTREAM_AUTH_ERROR", "Upstream authentication failed.", {
      upstreamMessage,
    }, requestId);
  }
  if (response.status >= 500) {
    return new ApiError(502, "UPSTREAM_UNAVAILABLE", "OpenAI service is temporarily unavailable.", {
      upstreamMessage,
    }, requestId);
  }

  return new ApiError(502, "UPSTREAM_ERROR", "OpenAI request failed.", { upstreamMessage }, requestId);
}

async function openaiJson(endpoint, body) {
  requireApiKey();

  const response = await fetch(`${OPENAI_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await readOpenAiError(response);
  }

  const data = await response.json().catch(() => null);
  if (!data) {
    throw new ApiError(502, "UPSTREAM_INVALID_RESPONSE", "OpenAI returned invalid JSON.");
  }
  return data;
}

app.use("/api", rateLimitMiddleware);

app.post("/api/auth/login", (req, res) => {
  try {
    if (!isAuthEnabled()) {
      throw new ApiError(500, "AUTH_NOT_CONFIGURED", "APP_PASSWORD n'est pas configuré sur le serveur.");
    }

    const password = readRequiredTextField(req.body, "password", MAX_PASSWORD_LENGTH);
    if (password !== APP_PASSWORD) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Mot de passe incorrect.");
    }

    const token = createSessionToken();
    res.json({
      token,
      role: "student",
      expiresInMs: SESSION_TTL_MS,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/auth/prof-login", (req, res) => {
  try {
    if (!isAuthEnabled()) {
      throw new ApiError(500, "AUTH_NOT_CONFIGURED", "APP_PASSWORD n'est pas configuré sur le serveur.");
    }
    if (!PROF_PASSWORD) {
      throw new ApiError(500, "PROF_AUTH_NOT_CONFIGURED", "PROF_PASSWORD n'est pas configuré sur le serveur.");
    }

    const password = readRequiredTextField(req.body, "password", MAX_PASSWORD_LENGTH);
    if (password !== PROF_PASSWORD) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Mot de passe professeur incorrect.");
    }

    const token = createSessionToken("professor");
    res.json({
      token,
      role: "professor",
      expiresInMs: SESSION_TTL_MS,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/auth/status", (req, res) => {
  if (!isAuthEnabled()) {
    res.json({
      authEnabled: false,
      authenticated: true,
    });
    return;
  }

  const token = getBearerToken(req);
  res.json({
    authEnabled: true,
    authenticated: hasValidSession(token),
    role: hasValidSession(token) ? getSessionRole(token) : "student",
  });
});

app.use("/api", (req, _res, next) => {
  if (req.path === "/health" || req.path === "/auth/login" || req.path === "/auth/prof-login" || req.path === "/auth/status") {
    next();
    return;
  }
  requireAuth(req, _res, next);
});

app.get("/api/notes", async (req, res) => {
  try {
    const courseId = String(req.query.courseId || "").trim();
    if (!courseId) {
      throw new ApiError(400, "INVALID_INPUT", "Query parameter \"courseId\" is required.");
    }
    if (hasSupabaseStorage) {
      const rows = await supabaseRequest(
        `notes?course_id=eq.${encodeURIComponent(courseId)}&select=id,course_id,title,content,link,created_at&order=created_at.desc`,
        { method: "GET" },
      );
      const notes = Array.isArray(rows)
        ? rows.map((row) => ({
            id: row.id,
            courseId: row.course_id,
            title: row.title,
            content: row.content || "",
            link: row.link || undefined,
            createdAt: row.created_at,
          }))
        : [];
      res.json({ notes });
      return;
    }

    const store = await ensureStoreLoaded();
    const notes = store.notes
      .filter((note) => note.courseId === courseId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ notes });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/notes", async (req, res) => {
  try {
    requireProfessor(req);
    const courseId = readRequiredTextField(req.body, "courseId", 128);
    const title = readRequiredTextField(req.body, "title", MAX_TITLE_LENGTH);
    const content = readOptionalTextField(req.body, "content", MAX_CONTENT_LENGTH);
    const link = readOptionalTextField(req.body, "link", MAX_URL_LENGTH);

    if (!content && !link) {
      throw new ApiError(400, "INVALID_INPUT", "Either \"content\" or \"link\" must be provided.");
    }
    if (link && !isValidHttpUrl(link)) {
      throw new ApiError(400, "INVALID_INPUT", "Field \"link\" must be a valid http(s) URL.");
    }

    const note = {
      id: crypto.randomUUID(),
      courseId,
      title,
      content,
      link: link || undefined,
      createdAt: new Date().toISOString(),
    };
    if (hasSupabaseStorage) {
      const rows = await supabaseRequest("notes", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          id: note.id,
          course_id: note.courseId,
          title: note.title,
          content: note.content,
          link: note.link || null,
          created_at: note.createdAt,
        }),
      });
      const created = Array.isArray(rows) ? rows[0] : null;
      if (!created) {
        throw new ApiError(502, "STORAGE_ERROR", "Unable to persist note.");
      }
      res.status(201).json({
        note: {
          id: created.id,
          courseId: created.course_id,
          title: created.title,
          content: created.content || "",
          link: created.link || undefined,
          createdAt: created.created_at,
        },
      });
      return;
    }

    const store = await ensureStoreLoaded();
    store.notes.unshift(note);
    await saveStore();

    res.status(201).json({ note });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/notes/:id", async (req, res) => {
  try {
    requireProfessor(req);
    const id = String(req.params.id || "").trim();
    if (!id) {
      throw new ApiError(400, "INVALID_INPUT", "Missing note id.");
    }

    if (hasSupabaseStorage) {
      await supabaseRequest(`notes?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      res.json({ ok: true });
      return;
    }

    const store = await ensureStoreLoaded();
    const before = store.notes.length;
    store.notes = store.notes.filter((note) => note.id !== id);
    if (store.notes.length === before) {
      throw new ApiError(404, "NOT_FOUND", "Note not found.");
    }
    await saveStore();
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/resources", async (req, res) => {
  try {
    const courseId = String(req.query.courseId || "").trim();
    if (!courseId) {
      throw new ApiError(400, "INVALID_INPUT", "Query parameter \"courseId\" is required.");
    }
    if (hasSupabaseStorage) {
      const rows = await supabaseRequest(
        `resources?course_id=eq.${encodeURIComponent(courseId)}&select=id,course_id,type,title,url,created_at&order=created_at.desc`,
        { method: "GET" },
      );
      const resources = Array.isArray(rows)
        ? rows.map((row) => ({
            id: row.id,
            courseId: row.course_id,
            type: row.type,
            title: row.title,
            url: row.url,
            createdAt: row.created_at,
          }))
        : [];
      res.json({ resources });
      return;
    }

    const store = await ensureStoreLoaded();
    const resources = store.resources
      .filter((item) => item.courseId === courseId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ resources });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/resources", async (req, res) => {
  try {
    requireProfessor(req);
    const courseId = readRequiredTextField(req.body, "courseId", 128);
    const title = readRequiredTextField(req.body, "title", MAX_TITLE_LENGTH);
    const type = readRequiredTextField(req.body, "type", 16).toUpperCase();
    const url = readRequiredTextField(req.body, "url", MAX_URL_LENGTH);

    if (type !== "PDF" && type !== "LIEN") {
      throw new ApiError(400, "INVALID_INPUT", "Field \"type\" must be PDF or LIEN.");
    }

    if (type === "LIEN" && !isValidHttpUrl(url)) {
      throw new ApiError(400, "INVALID_INPUT", "Field \"url\" must be a valid http(s) URL for LIEN.");
    }

    if (type === "PDF" && !url.startsWith("data:application/pdf")) {
      throw new ApiError(400, "INVALID_INPUT", "Field \"url\" must be a PDF data URL for PDF resources.");
    }

    const resource = {
      id: crypto.randomUUID(),
      courseId,
      type,
      title,
      url,
      createdAt: new Date().toISOString(),
    };
    if (hasSupabaseStorage) {
      const rows = await supabaseRequest("resources", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          id: resource.id,
          course_id: resource.courseId,
          type: resource.type,
          title: resource.title,
          url: resource.url,
          created_at: resource.createdAt,
        }),
      });
      const created = Array.isArray(rows) ? rows[0] : null;
      if (!created) {
        throw new ApiError(502, "STORAGE_ERROR", "Unable to persist resource.");
      }
      res.status(201).json({
        resource: {
          id: created.id,
          courseId: created.course_id,
          type: created.type,
          title: created.title,
          url: created.url,
          createdAt: created.created_at,
        },
      });
      return;
    }

    const store = await ensureStoreLoaded();
    store.resources.unshift(resource);
    await saveStore();

    res.status(201).json({ resource });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/resources/:id", async (req, res) => {
  try {
    requireProfessor(req);
    const id = String(req.params.id || "").trim();
    if (!id) {
      throw new ApiError(400, "INVALID_INPUT", "Missing resource id.");
    }

    if (hasSupabaseStorage) {
      await supabaseRequest(`resources?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      res.json({ ok: true });
      return;
    }

    const store = await ensureStoreLoaded();
    const before = store.resources.length;
    store.resources = store.resources.filter((item) => item.id !== id);
    if (store.resources.length === before) {
      throw new ApiError(404, "NOT_FOUND", "Resource not found.");
    }
    await saveStore();
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/summarize", async (req, res) => {
  try {
    const content = readRequiredTextField(req.body, "content", MAX_CONTENT_LENGTH);

    const response = await openaiJson("/chat/completions", {
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: "Tu es un tuteur pedagogique. Tu produis des resumes clairs et actionnables.",
        },
        {
          role: "user",
          content: `Resumes le contenu suivant de maniere pedagogique pour un etudiant. Utilise des puces et mets en avant les concepts cles.\n\n${content}`,
        },
      ],
    });

    const summary = response?.choices?.[0]?.message?.content?.trim() || "Impossible de generer un resume.";
    res.json({ summary });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/flashcards", async (req, res) => {
  try {
    const content = readRequiredTextField(req.body, "content", MAX_CONTENT_LENGTH);

    const response = await openaiJson("/chat/completions", {
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "Tu crees des flashcards precises et concises pour l'apprentissage.",
        },
        {
          role: "user",
          content: `Genere 5 flashcards pertinentes a partir du texte suivant. Chaque carte doit avoir un id, une question courte et une reponse concise.\n\nTexte:\n${content}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "flashcards_schema",
          strict: true,
          schema: {
            type: "object",
            properties: {
              flashcards: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    question: { type: "string" },
                    answer: { type: "string" },
                  },
                  required: ["id", "question", "answer"],
                  additionalProperties: false,
                },
              },
            },
            required: ["flashcards"],
            additionalProperties: false,
          },
        },
      },
    });

    const contentText = response?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(contentText);
    const flashcards = Array.isArray(parsed.flashcards) ? parsed.flashcards : [];
    res.json({ flashcards });
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendError(res, new ApiError(502, "UPSTREAM_INVALID_RESPONSE", "Invalid flashcards payload from OpenAI."));
      return;
    }
    sendError(res, error);
  }
});

app.post("/api/podcast", async (req, res) => {
  try {
    requireApiKey();
    const text = readRequiredTextField(req.body, "text", MAX_PODCAST_TEXT_LENGTH);
    const prompt = `Voici un resume de cours pour un etudiant. Lis-le d'un ton calme, encourageant et professionnel, comme un professeur particulier:\n\n${text}`;

    const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: prompt,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      throw await readOpenAiError(response);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new ApiError(502, "UPSTREAM_INVALID_RESPONSE", "OpenAI returned empty audio.");
    }
    const audioDataUrl = `data:audio/mp3;base64,${buffer.toString("base64")}`;
    res.json({ audioDataUrl });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    authEnabled: isAuthEnabled(),
    rateLimit: {
      windowMs: RATE_LIMIT_WINDOW_MS,
      maxRequests: RATE_LIMIT_MAX_REQUESTS,
    },
  });
});

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") {
    sendError(res, new ApiError(413, "PAYLOAD_TOO_LARGE", "Le document est trop volumineux pour etre publie."));
    return;
  }
  if (error?.type === "entity.parse.failed") {
    sendError(res, new ApiError(400, "INVALID_JSON", "Malformed JSON payload."));
    return;
  }
  sendError(res, error);
});

const distPath = path.resolve(__dirname, "../dist");
app.use(express.static(distPath));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`EduBoost API server running on http://localhost:${port}`);
});
