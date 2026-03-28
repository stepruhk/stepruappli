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
const COURSE_PASSWORD_PREFIX = "COURSE_PASSWORD_";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 180);
const MAX_CONTENT_LENGTH = Number(process.env.MAX_CONTENT_LENGTH || 12_000);
const MAX_PODCAST_TEXT_LENGTH = Number(process.env.MAX_PODCAST_TEXT_LENGTH || 8_000);
const PODCAST_RSS_URL = (process.env.PODCAST_RSS_URL || "https://anchor.fm/s/10c060bb4/podcast/rss").trim();
const MAX_PODCAST_EPISODES = Number(process.env.MAX_PODCAST_EPISODES || 50);
const MAX_PASSWORD_LENGTH = Number(process.env.MAX_PASSWORD_LENGTH || 256);
const MAX_URL_LENGTH = Number(process.env.MAX_URL_LENGTH || 30_000_000);
const MAX_TITLE_LENGTH = Number(process.env.MAX_TITLE_LENGTH || 180);
const MAX_JSON_BODY_LIMIT = String(process.env.MAX_JSON_BODY_LIMIT || "35mb");
const ACCESS_ANALYTICS_COURSE_ID = "__analytics_access__";
const ACCESS_ANALYTICS_TITLE = "__ACCESS_EVENT__";
const APP_ANALYTICS_COURSE_ID = "__analytics_app__";
const APP_ANALYTICS_TITLE_PREFIX = "__APP_EVENT__:";
const ACCESS_METRICS_BASE_TOTAL = Number(process.env.ACCESS_METRICS_BASE_TOTAL || 35);
const ACCESS_METRICS_BASE_STUDENT = Number(process.env.ACCESS_METRICS_BASE_STUDENT || 35);
const ACCESS_METRICS_BASE_PROFESSOR = Number(process.env.ACCESS_METRICS_BASE_PROFESSOR || 0);
const APP_LAUNCH_DATE = String(process.env.APP_LAUNCH_DATE || "2026-02-07").trim();
const ORDER_META_COURSE_ID = "__ui_order__";
const ORDER_META_PREFIX = "__ORDER__";
const GENERAL_COURSE_ID = "general";
const ANNOUNCEMENTS_COURSE_ID = "announcements";
const CONTACT_REQUESTS_COURSE_ID = "__contact_requests__";
const PROFESSOR_PROFILE_PREFIX = "professor-profile:";
const FLASHCARD_COURSE_PREFIX = "flashcards:";
const ANNOUNCEMENTS_FALLBACK_COURSE_ID = "1";
const ANNOUNCEMENT_TITLE_PREFIX = "[ANNONCE] ";
const GENERAL_NOTE_TITLE_PREFIX = "[NOTE_GENERALE] ";
const GENERAL_RESOURCE_TITLE_PREFIX = "[CONTENU_GENERAL] ";

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

  const fallbackMessage =
    error && typeof error === "object" && typeof error.message === "string" && error.message.trim()
      ? error.message
      : "Unexpected server error.";

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: fallbackMessage,
        details: null,
        requestId: null,
      },
    },
  };
}

function sendError(res, error) {
  if (!(error instanceof ApiError)) {
    console.error("Unhandled server error:", error);
  }
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
  const token = getBearerToken(req);
  if (req.method === "GET" && (hasValidSession(token) || !isAuthEnabled())) {
    next();
    return;
  }

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
  authSessions.set(token, {
    expiresAt: Date.now() + SESSION_TTL_MS,
    role,
    unlockedCourseIds: [],
  });
  return token;
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

function getValidSession(token) {
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    authSessions.delete(token);
    return null;
  }
  return session;
}

function hasValidSession(token) {
  return Boolean(getValidSession(token));
}

function getSessionRole(token) {
  const session = getValidSession(token);
  if (!session) return "student";
  return session.role || "student";
}

function getSessionUnlockedCourseIds(token) {
  const session = getValidSession(token);
  if (!session || !Array.isArray(session.unlockedCourseIds)) return [];
  return normalizeOrderIds(session.unlockedCourseIds);
}

function unlockCourseForSession(token, courseId) {
  const session = getValidSession(token);
  if (!session) return [];
  const nextUnlockedCourseIds = normalizeOrderIds([...(session.unlockedCourseIds || []), courseId]);
  session.unlockedCourseIds = nextUnlockedCourseIds;
  authSessions.set(token, session);
  return nextUnlockedCourseIds;
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

function normalizeCoursePasswordKey(courseId) {
  return String(courseId || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function getCanonicalCourseId(courseId) {
  const normalized = String(courseId || "").trim();
  if (!normalized) return "";
  if (normalized.startsWith(FLASHCARD_COURSE_PREFIX)) {
    return normalized.slice(FLASHCARD_COURSE_PREFIX.length).trim();
  }
  if (normalized.startsWith(PROFESSOR_PROFILE_PREFIX)) {
    return normalized.slice(PROFESSOR_PROFILE_PREFIX.length).trim();
  }
  return normalized;
}

function getFlashcardStorageCourseId(courseId) {
  const canonicalCourseId = getCanonicalCourseId(courseId);
  if (!canonicalCourseId) return "";
  return `${FLASHCARD_COURSE_PREFIX}${canonicalCourseId}`;
}

function toFlashcardPayload(rawNote) {
  let parsedContent = {};
  if (typeof rawNote.content === "string" && rawNote.content.trim()) {
    try {
      parsedContent = JSON.parse(rawNote.content);
    } catch {
      parsedContent = { answer: rawNote.content };
    }
  }

  return {
    id: rawNote.id,
    courseId: getCanonicalCourseId(rawNote.courseId),
    question: rawNote.title || "",
    answer: typeof parsedContent.answer === "string" ? parsedContent.answer : "",
    justification: typeof parsedContent.justification === "string" ? parsedContent.justification : "",
    commonMistakes: normalizeFlashcardCommonMistakes(parsedContent.commonMistakes),
    createdAt: rawNote.createdAt,
  };
}

function serializeFlashcardContent(answer, justification, commonMistakes = []) {
  return JSON.stringify({
    answer: String(answer || "").trim(),
    justification: String(justification || "").trim(),
    commonMistakes: normalizeFlashcardCommonMistakes(commonMistakes),
  });
}

function normalizeFlashcardCommonMistakes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const answer = typeof entry.answer === "string" ? entry.answer.trim() : "";
      const explanation = typeof entry.explanation === "string" ? entry.explanation.trim() : "";
      if (!answer || !explanation) return null;
      return { answer, explanation };
    })
    .filter(Boolean);
}

function readOptionalFlashcardCommonMistakes(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "INVALID_INPUT", "Request body must be a JSON object.");
  }
  const raw = body.commonMistakes;
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(400, "INVALID_INPUT", "Field \"commonMistakes\" must be an array.");
  }
  return normalizeFlashcardCommonMistakes(raw);
}

function getCoursePassword(courseId) {
  const canonicalCourseId = getCanonicalCourseId(courseId);
  if (!canonicalCourseId) return "";
  const envKey = `${COURSE_PASSWORD_PREFIX}${normalizeCoursePasswordKey(canonicalCourseId)}`;
  return String(process.env[envKey] || "").trim();
}

function getConfiguredLockedCourseIds() {
  return Object.entries(process.env)
    .filter(([key, value]) => key.startsWith(COURSE_PASSWORD_PREFIX) && String(value || "").trim())
    .map(([key]) => key.slice(COURSE_PASSWORD_PREFIX.length))
    .map((suffix) => suffix.trim().toLowerCase())
    .filter(Boolean);
}

function courseRequiresPassword(courseId) {
  const canonicalCourseId = getCanonicalCourseId(courseId);
  if (!canonicalCourseId) return false;
  if (
    canonicalCourseId === GENERAL_COURSE_ID ||
    canonicalCourseId === ANNOUNCEMENTS_COURSE_ID ||
    canonicalCourseId === ORDER_META_COURSE_ID ||
    canonicalCourseId === ACCESS_ANALYTICS_COURSE_ID
  ) {
    return false;
  }
  return Boolean(getCoursePassword(canonicalCourseId));
}

function requireCourseAccess(req, courseId) {
  const canonicalCourseId = getCanonicalCourseId(courseId);
  if (!canonicalCourseId) return;
  if (!courseRequiresPassword(canonicalCourseId)) return;
  if (getCurrentSessionRole(req) === "professor") return;

  const token = getBearerToken(req);
  const unlockedCourseIds = getSessionUnlockedCourseIds(token);
  if (unlockedCourseIds.includes(canonicalCourseId)) return;

  throw new ApiError(403, "COURSE_PASSWORD_REQUIRED", "Mot de passe du cours requis.");
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

function normalizeOrderIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const ids = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function getOrderMetaTitle(entityType, courseId) {
  return `${ORDER_META_PREFIX}:${entityType}:${courseId}`;
}

function parseOrderIds(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return normalizeOrderIds(parsed);
  } catch {
    return [];
  }
}

function parseLaunchDate(input) {
  if (!input) return null;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function getAppAnalyticsTitle(eventType) {
  return `${APP_ANALYTICS_TITLE_PREFIX}${String(eventType || "").trim()}`;
}

function parseAppAnalyticsEvent(rawNote) {
  const title = String(rawNote?.title || "");
  const eventType = title.startsWith(APP_ANALYTICS_TITLE_PREFIX)
    ? title.slice(APP_ANALYTICS_TITLE_PREFIX.length)
    : "";
  let payload = {};
  if (typeof rawNote?.content === "string" && rawNote.content.trim()) {
    try {
      payload = JSON.parse(rawNote.content);
    } catch {
      payload = { raw: rawNote.content };
    }
  }
  return {
    type: eventType,
    payload,
    createdAt: rawNote?.createdAt || rawNote?.created_at || null,
  };
}

function isAnnouncementStorageNote(courseId, title) {
  return (
    courseId === ANNOUNCEMENTS_COURSE_ID ||
    ((courseId === GENERAL_COURSE_ID || courseId === ANNOUNCEMENTS_FALLBACK_COURSE_ID) &&
      typeof title === "string" &&
      title.startsWith(ANNOUNCEMENT_TITLE_PREFIX))
  );
}

function isGeneralStorageNote(courseId, title) {
  if (courseId === GENERAL_COURSE_ID && !isAnnouncementStorageNote(courseId, title)) return true;
  return (
    courseId === ANNOUNCEMENTS_FALLBACK_COURSE_ID &&
    typeof title === "string" &&
    title.startsWith(GENERAL_NOTE_TITLE_PREFIX)
  );
}

function normalizeAnnouncementTitle(title) {
  const cleaned = String(title || "").trim();
  if (!cleaned) return ANNOUNCEMENT_TITLE_PREFIX.trim();
  if (cleaned.startsWith(ANNOUNCEMENT_TITLE_PREFIX)) {
    return cleaned;
  }
  return `${ANNOUNCEMENT_TITLE_PREFIX}${cleaned}`;
}

function normalizeGeneralNoteTitle(title) {
  const cleaned = String(title || "").trim();
  if (!cleaned) return GENERAL_NOTE_TITLE_PREFIX.trim();
  if (cleaned.startsWith(GENERAL_NOTE_TITLE_PREFIX)) {
    return cleaned;
  }
  return `${GENERAL_NOTE_TITLE_PREFIX}${cleaned}`;
}

function toStorageNoteCandidates(courseId, title) {
  if (courseId === ANNOUNCEMENTS_COURSE_ID) {
    const normalized = normalizeAnnouncementTitle(title);
    return [
      { storageCourseId: ANNOUNCEMENTS_COURSE_ID, storageTitle: normalized },
      { storageCourseId: GENERAL_COURSE_ID, storageTitle: normalized },
      { storageCourseId: ANNOUNCEMENTS_FALLBACK_COURSE_ID, storageTitle: normalized },
    ];
  }
  if (courseId === GENERAL_COURSE_ID) {
    const normalized = normalizeGeneralNoteTitle(title);
    return [
      { storageCourseId: GENERAL_COURSE_ID, storageTitle: normalized },
      { storageCourseId: ANNOUNCEMENTS_FALLBACK_COURSE_ID, storageTitle: normalized },
    ];
  }
  return [{ storageCourseId: courseId, storageTitle: title }];
}

function toApiNote(rawNote) {
  const isAnnouncement = isAnnouncementStorageNote(rawNote.courseId, rawNote.title || "");
  const isGeneral = !isAnnouncement && isGeneralStorageNote(rawNote.courseId, rawNote.title || "");
  let apiTitle = rawNote.title || "";
  if (isAnnouncement && apiTitle.startsWith(ANNOUNCEMENT_TITLE_PREFIX)) {
    apiTitle = apiTitle.slice(ANNOUNCEMENT_TITLE_PREFIX.length).trimStart();
  } else if (isGeneral && apiTitle.startsWith(GENERAL_NOTE_TITLE_PREFIX)) {
    apiTitle = apiTitle.slice(GENERAL_NOTE_TITLE_PREFIX.length).trimStart();
  }
  return {
    ...rawNote,
    courseId: isAnnouncement ? ANNOUNCEMENTS_COURSE_ID : (isGeneral ? GENERAL_COURSE_ID : rawNote.courseId),
    title: apiTitle || "",
  };
}

function normalizeContactRequestSelections(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, 20);
}

function readRequiredStringArrayField(body, fieldName, maxItems = 20, maxLength = 180) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "INVALID_INPUT", "Request body must be a JSON object.");
  }

  const value = body[fieldName];
  if (!Array.isArray(value)) {
    throw new ApiError(400, "INVALID_INPUT", `Field "${fieldName}" must be an array.`);
  }

  const normalized = normalizeContactRequestSelections(value);
  if (!normalized.length) {
    throw new ApiError(400, "INVALID_INPUT", `Field "${fieldName}" must contain at least one choice.`);
  }
  if (normalized.length > maxItems) {
    throw new ApiError(400, "INPUT_TOO_LARGE", `Field "${fieldName}" exceeds maximum number of items.`, {
      field: fieldName,
      maxItems,
    });
  }

  for (const item of normalized) {
    if (item.length > maxLength) {
      throw new ApiError(400, "INPUT_TOO_LARGE", `One value in "${fieldName}" exceeds maximum length.`, {
        field: fieldName,
        maxLength,
      });
    }
  }

  return normalized;
}

function parseContactRequest(rawNote) {
  let payload = {};
  if (typeof rawNote?.content === "string" && rawNote.content.trim()) {
    try {
      payload = JSON.parse(rawNote.content);
    } catch {
      payload = {};
    }
  }

  return {
    id: rawNote?.id || crypto.randomUUID(),
    name: typeof payload?.name === "string" ? payload.name : "",
    email: typeof payload?.email === "string" ? payload.email : "",
    university: typeof payload?.university === "string" ? payload.university : "",
    selections: normalizeContactRequestSelections(payload?.selections),
    createdAt: rawNote?.createdAt || rawNote?.created_at || new Date().toISOString(),
  };
}

function isGeneralStorageResource(courseId, title) {
  if (courseId === GENERAL_COURSE_ID) return true;
  return (
    courseId === ANNOUNCEMENTS_FALLBACK_COURSE_ID &&
    typeof title === "string" &&
    title.startsWith(GENERAL_RESOURCE_TITLE_PREFIX)
  );
}

function normalizeGeneralResourceTitle(title) {
  const cleaned = String(title || "").trim();
  if (!cleaned) return GENERAL_RESOURCE_TITLE_PREFIX.trim();
  if (cleaned.startsWith(GENERAL_RESOURCE_TITLE_PREFIX)) {
    return cleaned;
  }
  return `${GENERAL_RESOURCE_TITLE_PREFIX}${cleaned}`;
}

function toStorageResourceCandidates(courseId, title) {
  if (courseId === GENERAL_COURSE_ID) {
    const normalized = normalizeGeneralResourceTitle(title);
    return [
      { storageCourseId: GENERAL_COURSE_ID, storageTitle: normalized },
      { storageCourseId: ANNOUNCEMENTS_FALLBACK_COURSE_ID, storageTitle: normalized },
    ];
  }
  return [{ storageCourseId: courseId, storageTitle: title }];
}

function toApiResource(rawResource) {
  const isGeneral = isGeneralStorageResource(rawResource.courseId, rawResource.title || "");
  let apiTitle = rawResource.title || "";
  if (isGeneral && apiTitle.startsWith(GENERAL_RESOURCE_TITLE_PREFIX)) {
    apiTitle = apiTitle.slice(GENERAL_RESOURCE_TITLE_PREFIX.length).trimStart();
  }
  return {
    ...rawResource,
    courseId: isGeneral ? GENERAL_COURSE_ID : rawResource.courseId,
    title: apiTitle || "",
  };
}

function applyManualOrder(items, orderedIds) {
  if (!Array.isArray(items) || !items.length) return [];
  const orderMap = new Map();
  orderedIds.forEach((id, index) => {
    orderMap.set(id, index);
  });
  const fallbackRank = Number.MAX_SAFE_INTEGER;
  return [...items].sort((a, b) => {
    const rankA = orderMap.has(a.id) ? orderMap.get(a.id) : fallbackRank;
    const rankB = orderMap.has(b.id) ? orderMap.get(b.id) : fallbackRank;
    if (rankA !== rankB) return rankA - rankB;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTag(xml, tagName) {
  const cdataRegex = new RegExp(`<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tagName}>`, "i");
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch?.[1]) return cdataMatch[1].trim();

  const tagRegex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const tagMatch = xml.match(tagRegex);
  return tagMatch?.[1]?.trim() || "";
}

function extractEnclosureUrl(xml) {
  const enclosureMatch = xml.match(/<enclosure[^>]*url="([^"]+)"[^>]*>/i);
  return enclosureMatch?.[1] || "";
}

function parsePodcastRss(xmlText) {
  const items = [];
  const itemRegex = /<item\b[\s\S]*?<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[0];
    const title = decodeHtmlEntities(extractTag(itemXml, "title"));
    const link = extractTag(itemXml, "link");
    const pubDate = extractTag(itemXml, "pubDate");
    const descriptionRaw = extractTag(itemXml, "description");
    const description = decodeHtmlEntities(stripTags(descriptionRaw)).slice(0, 500);
    const audioUrl = extractEnclosureUrl(itemXml);

    if (!title) continue;
    items.push({ title, link, pubDate, description, audioUrl });
  }

  return items.slice(0, MAX_PODCAST_EPISODES);
}

function parsePodcastAtom(xmlText) {
  const entries = [];
  const entryRegex = /<entry\b[\s\S]*?<\/entry>/gi;
  let match;

  while ((match = entryRegex.exec(xmlText)) !== null) {
    const entryXml = match[0];
    const title = decodeHtmlEntities(extractTag(entryXml, "title"));
    const pubDate = extractTag(entryXml, "published") || extractTag(entryXml, "updated");
    const descriptionRaw = extractTag(entryXml, "summary") || extractTag(entryXml, "content");
    const description = decodeHtmlEntities(stripTags(descriptionRaw)).slice(0, 500);
    const linkMatch = entryXml.match(/<link[^>]*href="([^"]+)"[^>]*>/i);
    const link = linkMatch?.[1] || "";
    const audioUrl = extractEnclosureUrl(entryXml);

    if (!title) continue;
    entries.push({ title, link, pubDate, description, audioUrl });
  }

  return entries.slice(0, MAX_PODCAST_EPISODES);
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
    try {
      await fs.writeFile(storageFilePath, JSON.stringify(storeCache, null, 2), "utf8");
    } catch (writeError) {
      console.warn("Could not initialize local storage file, using in-memory fallback.", writeError);
    }
  }

  return storeCache;
}

async function saveStore() {
  if (!storeCache) return;
  try {
    await fs.writeFile(storageFilePath, JSON.stringify(storeCache, null, 2), "utf8");
  } catch (error) {
    console.warn("Could not persist local storage file, continuing with in-memory data.", error);
  }
}

async function supabaseRequest(pathname, init = {}, { allowNotFound = false } = {}) {
  if (!hasSupabaseStorage) {
    throw new ApiError(500, "STORAGE_NOT_CONFIGURED", "Supabase storage is not configured.");
  }

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...(init.headers || {}),
  };

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...init,
    headers,
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

async function supabaseCount(pathname) {
  if (!hasSupabaseStorage) return 0;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    method: "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ApiError(502, "STORAGE_ERROR", "Storage backend request failed.", {
      status: response.status,
      body: text || null,
      path: pathname,
    });
  }

  const contentRange = response.headers.get("content-range") || "";
  const total = Number(contentRange.split("/")[1] || 0);
  return Number.isFinite(total) ? total : 0;
}

async function readStoredOrder(entityType, courseId) {
  if (!courseId) return [];
  const title = getOrderMetaTitle(entityType, courseId);
  try {
    if (hasSupabaseStorage) {
      const rows = await supabaseRequest(
        `notes?course_id=eq.${encodeURIComponent(ORDER_META_COURSE_ID)}&title=eq.${encodeURIComponent(title)}&select=content,created_at&order=created_at.desc&limit=1`,
        { method: "GET" },
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      return parseOrderIds(row?.content);
    }

    const store = await ensureStoreLoaded();
    const row = store.notes
      .filter((note) => note.courseId === ORDER_META_COURSE_ID && note.title === title)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    return parseOrderIds(row?.content);
  } catch (error) {
    console.warn("Order metadata read failed, fallback to default order.", { entityType, courseId, error });
    return [];
  }
}

async function upsertStoredOrder(entityType, courseId, orderedIds) {
  const normalizedIds = normalizeOrderIds(orderedIds);
  const title = getOrderMetaTitle(entityType, courseId);
  const content = JSON.stringify(normalizedIds);
  const nowIso = new Date().toISOString();
  try {
    if (hasSupabaseStorage) {
      const rows = await supabaseRequest(
        `notes?course_id=eq.${encodeURIComponent(ORDER_META_COURSE_ID)}&title=eq.${encodeURIComponent(title)}&select=id,created_at&order=created_at.desc`,
        { method: "GET" },
      );
      const first = Array.isArray(rows) ? rows[0] : null;
      if (first?.id) {
        await supabaseRequest(`notes?id=eq.${encodeURIComponent(first.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            content,
            created_at: nowIso,
          }),
        });
        return;
      }

      await supabaseRequest("notes", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          course_id: ORDER_META_COURSE_ID,
          title,
          content,
          link: null,
          created_at: nowIso,
        }),
      });
      return;
    }

    const store = await ensureStoreLoaded();
    const existing = store.notes.find((note) => note.courseId === ORDER_META_COURSE_ID && note.title === title);
    if (existing) {
      existing.content = content;
      existing.createdAt = nowIso;
    } else {
      store.notes.unshift({
        id: crypto.randomUUID(),
        courseId: ORDER_META_COURSE_ID,
        title,
        content,
        createdAt: nowIso,
      });
    }
    await saveStore();
  } catch (error) {
    console.warn("Order metadata write failed, continuing without persistent order.", { entityType, courseId, error });
  }
}

async function prependItemInOrder(entityType, courseId, itemId) {
  if (!courseId || !itemId) return;
  const current = await readStoredOrder(entityType, courseId);
  const next = [itemId, ...current.filter((id) => id !== itemId)];
  await upsertStoredOrder(entityType, courseId, next);
}

async function removeItemFromOrder(entityType, courseId, itemId) {
  if (!courseId || !itemId) return;
  const current = await readStoredOrder(entityType, courseId);
  if (!current.includes(itemId)) return;
  const next = current.filter((id) => id !== itemId);
  await upsertStoredOrder(entityType, courseId, next);
}

async function recordAccess(role = "student") {
  const nowIso = new Date().toISOString();
  const entry = {
    id: crypto.randomUUID(),
    courseId: ACCESS_ANALYTICS_COURSE_ID,
    title: ACCESS_ANALYTICS_TITLE,
    content: role,
    link: null,
    createdAt: nowIso,
  };

  if (hasSupabaseStorage) {
    try {
      await supabaseRequest("notes", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          id: entry.id,
          course_id: entry.courseId,
          title: entry.title,
          content: entry.content,
          link: entry.link,
          created_at: entry.createdAt,
        }),
      });
      return;
    } catch (error) {
      console.warn("Could not persist access metric in Supabase, fallback to local storage.", error);
    }
  }

  const store = await ensureStoreLoaded();
  store.notes.unshift({
    id: entry.id,
    courseId: entry.courseId,
    title: entry.title,
    content: entry.content,
    createdAt: entry.createdAt,
  });
  await saveStore();
}

async function readAccessMetrics() {
  const launchDateIso = parseLaunchDate(APP_LAUNCH_DATE);
  const baseTotal = Number.isFinite(ACCESS_METRICS_BASE_TOTAL) ? ACCESS_METRICS_BASE_TOTAL : 0;
  const baseStudent = Number.isFinite(ACCESS_METRICS_BASE_STUDENT) ? ACCESS_METRICS_BASE_STUDENT : 0;
  const baseProfessor = Number.isFinite(ACCESS_METRICS_BASE_PROFESSOR) ? ACCESS_METRICS_BASE_PROFESSOR : 0;

  if (hasSupabaseStorage) {
    try {
      const encodedCourseId = encodeURIComponent(ACCESS_ANALYTICS_COURSE_ID);
      const encodedTitle = encodeURIComponent(ACCESS_ANALYTICS_TITLE);
      const encodedStudent = encodeURIComponent("student");
      const encodedProfessor = encodeURIComponent("professor");
      const baseFilter = `course_id=eq.${encodedCourseId}&title=eq.${encodedTitle}`;

      const [total, student, professor, latestRows, firstRows] = await Promise.all([
        supabaseCount(`notes?${baseFilter}&select=id`),
        supabaseCount(`notes?${baseFilter}&content=eq.${encodedStudent}&select=id`),
        supabaseCount(`notes?${baseFilter}&content=eq.${encodedProfessor}&select=id`),
        supabaseRequest(
          `notes?${baseFilter}&select=created_at&order=created_at.desc&limit=1`,
          { method: "GET" },
        ),
        supabaseRequest(
          `notes?${baseFilter}&select=created_at&order=created_at.asc&limit=1`,
          { method: "GET" },
        ),
      ]);

      const lastAccessAt = Array.isArray(latestRows) && latestRows[0]?.created_at
        ? latestRows[0].created_at
        : null;
      const firstAccessAt = Array.isArray(firstRows) && firstRows[0]?.created_at
        ? firstRows[0].created_at
        : null;

      return {
        total: total + baseTotal,
        student: student + baseStudent,
        professor: professor + baseProfessor,
        firstAccessAt: launchDateIso || firstAccessAt,
        lastAccessAt,
      };
    } catch (error) {
      console.warn("Could not read access metrics from Supabase, fallback to local storage.", error);
    }
  }

  try {
    const store = await ensureStoreLoaded();
    const events = store.notes.filter(
      (note) => note.courseId === ACCESS_ANALYTICS_COURSE_ID && note.title === ACCESS_ANALYTICS_TITLE,
    );

    const student = events.filter((note) => note.content === "student").length;
    const professor = events.filter((note) => note.content === "professor").length;
    const lastAccessAt = events.reduce((latest, note) => {
      if (!latest) return note.createdAt || null;
      return new Date(note.createdAt).getTime() > new Date(latest).getTime() ? note.createdAt : latest;
    }, null);
    const firstAccessAt = events.reduce((earliest, note) => {
      if (!earliest) return note.createdAt || null;
      return new Date(note.createdAt).getTime() < new Date(earliest).getTime() ? note.createdAt : earliest;
    }, null);

    return {
      total: events.length + baseTotal,
      student: student + baseStudent,
      professor: professor + baseProfessor,
      firstAccessAt: launchDateIso || firstAccessAt,
      lastAccessAt,
    };
  } catch (error) {
    console.warn("Could not read access metrics from local storage, returning baseline metrics.", error);
    return {
      total: baseTotal,
      student: baseStudent,
      professor: baseProfessor,
      firstAccessAt: launchDateIso,
      lastAccessAt: null,
    };
  }
}

async function recordAppAnalyticsEvent(eventType, payload = {}) {
  const normalizedEventType = String(eventType || "").trim().toLowerCase();
  if (!normalizedEventType) return;

  const entry = {
    id: crypto.randomUUID(),
    courseId: APP_ANALYTICS_COURSE_ID,
    title: getAppAnalyticsTitle(normalizedEventType),
    content: JSON.stringify(payload || {}),
    link: null,
    createdAt: new Date().toISOString(),
  };

  if (hasSupabaseStorage) {
    try {
      await supabaseRequest("notes", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          id: entry.id,
          course_id: entry.courseId,
          title: entry.title,
          content: entry.content,
          link: entry.link,
          created_at: entry.createdAt,
        }),
      });
      return;
    } catch (error) {
      console.warn("Could not persist app analytics event in Supabase, fallback to local storage.", error);
    }
  }

  try {
    const store = await ensureStoreLoaded();
    store.notes.unshift({
      id: entry.id,
      courseId: entry.courseId,
      title: entry.title,
      content: entry.content,
      createdAt: entry.createdAt,
    });
    await saveStore();
  } catch (error) {
    console.warn("Could not persist app analytics event locally, skipping analytics event.", error);
  }
}

function createSortedSummaryEntries(sourceMap, keyFieldName) {
  return Array.from(sourceMap.entries())
    .map(([key, count]) => ({ [keyFieldName]: key, count }))
    .sort((a, b) => b.count - a.count);
}

async function readAppAnalyticsSummary() {
  let rawEvents = [];

  if (hasSupabaseStorage) {
    try {
      const rows = await supabaseRequest(
        `notes?course_id=eq.${encodeURIComponent(APP_ANALYTICS_COURSE_ID)}&select=title,content,created_at&order=created_at.desc`,
        { method: "GET" },
      );
      rawEvents = (Array.isArray(rows) ? rows : []).map((row) => ({
        title: row.title,
        content: row.content,
        created_at: row.created_at,
      }));
    } catch (error) {
      console.warn("Could not read app analytics from Supabase, fallback to local storage.", error);
    }
  }

  if (!rawEvents.length) {
    try {
      const store = await ensureStoreLoaded();
      rawEvents = store.notes
        .filter((note) => note.courseId === APP_ANALYTICS_COURSE_ID)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((note) => ({
          title: note.title,
          content: note.content,
          createdAt: note.createdAt,
        }));
    } catch (error) {
      console.warn("Could not read app analytics from local storage, returning empty summary.", error);
      rawEvents = [];
    }
  }

  const events = rawEvents
    .map((entry) => parseAppAnalyticsEvent(entry))
    .filter((entry) => entry.type);

  const pageViews = new Map();
  const courseViews = new Map();
  const externalClicks = {
    blog: 0,
    contact: 0,
    zoom: 0,
  };
  let podcastOpens = 0;

  for (const event of events) {
    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};

    if (event.type === "page_view") {
      const section = typeof payload.section === "string" ? payload.section.trim() : "";
      if (section) {
        pageViews.set(section, (pageViews.get(section) || 0) + 1);
      }
    }

    if (event.type === "course_view") {
      const courseId = typeof payload.courseId === "string" ? payload.courseId.trim() : "";
      if (courseId) {
        courseViews.set(courseId, (courseViews.get(courseId) || 0) + 1);
      }
    }

    if (event.type === "balado_open") {
      podcastOpens += 1;
    }

    if (event.type === "external_click") {
      const target = typeof payload.target === "string" ? payload.target.trim().toLowerCase() : "";
      if (target === "blog" || target === "contact" || target === "zoom") {
        externalClicks[target] += 1;
      }
    }
  }

  return {
    pageViews: createSortedSummaryEntries(pageViews, "section"),
    courseViews: createSortedSummaryEntries(courseViews, "courseId"),
    podcastOpens,
    externalClicks,
  };
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
    void recordAccess("student").catch((error) => {
      console.error("Failed to record student access:", error);
    });
    res.json({
      token,
      role: "student",
      unlockedCourseIds: [],
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
    void recordAccess("professor").catch((error) => {
      console.error("Failed to record professor access:", error);
    });
    res.json({
      token,
      role: "professor",
      unlockedCourseIds: [],
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
    unlockedCourseIds: hasValidSession(token) ? getSessionUnlockedCourseIds(token) : [],
    lockedCourseIds: getConfiguredLockedCourseIds(),
  });
});

app.post("/api/auth/course-login", (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!hasValidSession(token)) {
      throw new ApiError(401, "UNAUTHORIZED", "Mot de passe requis ou session expirée.");
    }

    const courseId = readRequiredTextField(req.body, "courseId", 128);
    const canonicalCourseId = getCanonicalCourseId(courseId);

    if (!canonicalCourseId) {
      throw new ApiError(400, "INVALID_INPUT", "Course id invalide.");
    }

    if (getSessionRole(token) === "professor" || !courseRequiresPassword(canonicalCourseId)) {
      res.json({
        ok: true,
        unlockedCourseIds: getSessionUnlockedCourseIds(token),
      });
      return;
    }

    const password = readRequiredTextField(req.body, "password", MAX_PASSWORD_LENGTH);
    const expectedPassword = getCoursePassword(canonicalCourseId);

    if (password !== expectedPassword) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Mot de passe du cours incorrect.");
    }

    const unlockedCourseIds = unlockCourseForSession(token, canonicalCourseId);
    res.json({
      ok: true,
      unlockedCourseIds,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.use("/api", (req, _res, next) => {
  if (req.path === "/health" || req.path === "/auth/login" || req.path === "/auth/prof-login" || req.path === "/auth/status") {
    next();
    return;
  }
  requireAuth(req, _res, next);
});

app.get("/api/contact-requests", async (req, res) => {
  try {
    requireProfessor(req);

    if (hasSupabaseStorage) {
      const rows = await supabaseRequest(
        `notes?course_id=eq.${encodeURIComponent(CONTACT_REQUESTS_COURSE_ID)}&select=id,content,created_at&order=created_at.desc`,
        { method: "GET" },
      );
      const requests = (Array.isArray(rows) ? rows : []).map((row) =>
        parseContactRequest({
          id: row.id,
          content: row.content || "",
          created_at: row.created_at,
        }),
      );
      res.json({ requests });
      return;
    }

    const store = await ensureStoreLoaded();
    const requests = store.notes
      .filter((note) => note.courseId === CONTACT_REQUESTS_COURSE_ID)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((note) => parseContactRequest(note));
    res.json({ requests });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/contact-requests", async (req, res) => {
  try {
    const name = readRequiredTextField(req.body, "name", 160);
    const email = readRequiredTextField(req.body, "email", 220);
    const university = readRequiredTextField(req.body, "university", 220);
    const selections = readRequiredStringArrayField(req.body, "selections");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(400, "INVALID_INPUT", "Adresse courriel invalide.");
    }

    const requestEntry = {
      id: crypto.randomUUID(),
      courseId: CONTACT_REQUESTS_COURSE_ID,
      title: `[CONTACT_REQUEST] ${name}`,
      content: JSON.stringify({
        name,
        email,
        university,
        selections,
      }),
      link: null,
      createdAt: new Date().toISOString(),
    };

    if (hasSupabaseStorage) {
      await supabaseRequest("notes", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          id: requestEntry.id,
          course_id: requestEntry.courseId,
          title: requestEntry.title,
          content: requestEntry.content,
          link: requestEntry.link,
          created_at: requestEntry.createdAt,
        }),
      });
      res.status(201).json({ ok: true });
      return;
    }

    const store = await ensureStoreLoaded();
    store.notes.unshift({
      id: requestEntry.id,
      courseId: requestEntry.courseId,
      title: requestEntry.title,
      content: requestEntry.content,
      createdAt: requestEntry.createdAt,
    });
    await saveStore();
    res.status(201).json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/notes", async (req, res) => {
  try {
    const requestedCourseId = String(req.query.courseId || "").trim();
    if (!requestedCourseId) {
      throw new ApiError(400, "INVALID_INPUT", "Query parameter \"courseId\" is required.");
    }
    requireCourseAccess(req, requestedCourseId);
    const orderedIds = await readStoredOrder("notes", requestedCourseId);
    const storageCourseIds = requestedCourseId === ANNOUNCEMENTS_COURSE_ID
      ? [ANNOUNCEMENTS_COURSE_ID, GENERAL_COURSE_ID, ANNOUNCEMENTS_FALLBACK_COURSE_ID]
      : requestedCourseId === GENERAL_COURSE_ID
        ? [GENERAL_COURSE_ID, ANNOUNCEMENTS_FALLBACK_COURSE_ID]
        : [requestedCourseId];

    if (hasSupabaseStorage) {
      const rowsByCourse = await Promise.all(
        storageCourseIds.map((courseId) =>
          supabaseRequest(
            `notes?course_id=eq.${encodeURIComponent(courseId)}&select=id,course_id,title,content,link,created_at&order=created_at.desc`,
            { method: "GET" },
          ),
        ),
      );

      const parsedNotes = rowsByCourse
        .flatMap((rows) => (Array.isArray(rows) ? rows : []))
        .map((row) =>
          toApiNote({
            id: row.id,
            courseId: row.course_id,
            title: row.title,
            content: row.content || "",
            link: row.link || undefined,
            createdAt: row.created_at,
          }),
        )
        .filter((note) => note.courseId === requestedCourseId);

      const notes = applyManualOrder(parsedNotes, orderedIds);
      res.json({ notes });
      return;
    }

    const store = await ensureStoreLoaded();
    const parsedNotes = store.notes
      .filter((note) => storageCourseIds.includes(note.courseId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((note) => toApiNote(note))
      .filter((note) => note.courseId === requestedCourseId);
    const notes = applyManualOrder(parsedNotes, orderedIds);
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

    const candidates = toStorageNoteCandidates(courseId, title);
    const note = {
      id: crypto.randomUUID(),
      courseId,
      title,
      content,
      link: link || undefined,
      createdAt: new Date().toISOString(),
    };
    if (hasSupabaseStorage) {
      let created = null;
      let lastError = null;
      for (const candidate of candidates) {
        try {
          const rows = await supabaseRequest("notes", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({
              id: note.id,
              course_id: candidate.storageCourseId,
              title: candidate.storageTitle,
              content: note.content,
              link: note.link || null,
              created_at: note.createdAt,
            }),
          });
          created = Array.isArray(rows) ? rows[0] : null;
          if (created) break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!created) {
        if (lastError) throw lastError;
        throw new ApiError(502, "STORAGE_ERROR", "Unable to persist note.");
      }
      await prependItemInOrder("notes", note.courseId, note.id);
      const apiNote = toApiNote({
        id: created.id,
        courseId: created.course_id,
        title: created.title,
        content: created.content || "",
        link: created.link || undefined,
        createdAt: created.created_at,
      });
      res.status(201).json({
        note: apiNote,
      });
      return;
    }

    const store = await ensureStoreLoaded();
    const selectedCandidate = candidates[0];
    const storedNote = {
      ...note,
      courseId: selectedCandidate.storageCourseId,
      title: selectedCandidate.storageTitle,
    };
    store.notes.unshift(storedNote);
    await saveStore();
    await prependItemInOrder("notes", note.courseId, note.id);

    res.status(201).json({ note: toApiNote(storedNote) });
  } catch (error) {
    sendError(res, error);
  }
});

app.put("/api/notes/:id", async (req, res) => {
  try {
    requireProfessor(req);
    const id = String(req.params.id || "").trim();
    if (!id) {
      throw new ApiError(400, "INVALID_INPUT", "Missing note id.");
    }

    const title = readRequiredTextField(req.body, "title", MAX_TITLE_LENGTH);
    const content = readOptionalTextField(req.body, "content", MAX_CONTENT_LENGTH);
    const link = readOptionalTextField(req.body, "link", MAX_URL_LENGTH);

    if (!content && !link) {
      throw new ApiError(400, "INVALID_INPUT", "Either \"content\" or \"link\" must be provided.");
    }
    if (link && !isValidHttpUrl(link)) {
      throw new ApiError(400, "INVALID_INPUT", "Field \"link\" must be a valid http(s) URL.");
    }

    if (hasSupabaseStorage) {
      const existingRows = await supabaseRequest(
        `notes?id=eq.${encodeURIComponent(id)}&select=id,course_id,title&limit=1`,
        { method: "GET" },
      );
      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      if (!existing) {
        throw new ApiError(404, "NOT_FOUND", "Note not found.");
      }

      const nextStorageTitle = isAnnouncementStorageNote(existing.course_id, existing.title || "")
        ? normalizeAnnouncementTitle(title)
        : isGeneralStorageNote(existing.course_id, existing.title || "")
          ? normalizeGeneralNoteTitle(title)
        : title;

      const rows = await supabaseRequest(`notes?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          title: nextStorageTitle,
          content,
          link: link || null,
        }),
      });
      const updated = Array.isArray(rows) ? rows[0] : null;
      if (!updated) {
        throw new ApiError(404, "NOT_FOUND", "Note not found.");
      }
      const apiNote = toApiNote({
        id: updated.id,
        courseId: updated.course_id,
        title: updated.title,
        content: updated.content || "",
        link: updated.link || undefined,
        createdAt: updated.created_at,
      });
      res.json({
        note: apiNote,
      });
      return;
    }

    const store = await ensureStoreLoaded();
    const note = store.notes.find((entry) => entry.id === id);
    if (!note) {
      throw new ApiError(404, "NOT_FOUND", "Note not found.");
    }
    note.title = isAnnouncementStorageNote(note.courseId, note.title || "")
      ? normalizeAnnouncementTitle(title)
      : isGeneralStorageNote(note.courseId, note.title || "")
        ? normalizeGeneralNoteTitle(title)
      : title;
    note.content = content;
    note.link = link || undefined;
    await saveStore();
    res.json({ note: toApiNote(note) });
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
      const existingRows = await supabaseRequest(
        `notes?id=eq.${encodeURIComponent(id)}&select=id,course_id,title&limit=1`,
        { method: "GET" },
      );
      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      await supabaseRequest(`notes?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (existing) {
        if (isAnnouncementStorageNote(existing.course_id, existing.title || "")) {
          await removeItemFromOrder("notes", ANNOUNCEMENTS_COURSE_ID, id);
        } else if (isGeneralStorageNote(existing.course_id, existing.title || "")) {
          await removeItemFromOrder("notes", GENERAL_COURSE_ID, id);
        } else if (existing.course_id) {
          await removeItemFromOrder("notes", existing.course_id, id);
        }
      }
      res.json({ ok: true });
      return;
    }

    const store = await ensureStoreLoaded();
    const deletedNote = store.notes.find((note) => note.id === id);
    const before = store.notes.length;
    store.notes = store.notes.filter((note) => note.id !== id);
    if (store.notes.length === before) {
      throw new ApiError(404, "NOT_FOUND", "Note not found.");
    }
    await saveStore();
    if (deletedNote) {
      if (isAnnouncementStorageNote(deletedNote.courseId, deletedNote.title || "")) {
        await removeItemFromOrder("notes", ANNOUNCEMENTS_COURSE_ID, id);
      } else if (isGeneralStorageNote(deletedNote.courseId, deletedNote.title || "")) {
        await removeItemFromOrder("notes", GENERAL_COURSE_ID, id);
      } else if (deletedNote.courseId) {
        await removeItemFromOrder("notes", deletedNote.courseId, id);
      }
    }
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/resources", async (req, res) => {
  try {
    const requestedCourseId = String(req.query.courseId || "").trim();
    if (!requestedCourseId) {
      throw new ApiError(400, "INVALID_INPUT", "Query parameter \"courseId\" is required.");
    }
    requireCourseAccess(req, requestedCourseId);
    const orderedIds = await readStoredOrder("resources", requestedCourseId);
    const storageCourseIds = requestedCourseId === GENERAL_COURSE_ID
      ? [GENERAL_COURSE_ID, ANNOUNCEMENTS_FALLBACK_COURSE_ID]
      : [requestedCourseId];

    if (hasSupabaseStorage) {
      const rowsByCourse = await Promise.all(
        storageCourseIds.map((courseId) =>
          supabaseRequest(
            `resources?course_id=eq.${encodeURIComponent(courseId)}&select=id,course_id,type,title,url,created_at&order=created_at.desc`,
            { method: "GET" },
          ),
        ),
      );
      const parsedResources = rowsByCourse
        .flatMap((rows) => (Array.isArray(rows) ? rows : []))
        .map((row) => toApiResource({
            id: row.id,
            courseId: row.course_id,
            type: row.type,
            title: row.title,
            url: row.url,
            createdAt: row.created_at,
          }))
        .filter((item) => item.courseId === requestedCourseId);
      const resources = applyManualOrder(parsedResources, orderedIds);
      res.json({ resources });
      return;
    }

    const store = await ensureStoreLoaded();
    const parsedResources = store.resources
      .filter((item) => storageCourseIds.includes(item.courseId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((item) => toApiResource(item))
      .filter((item) => item.courseId === requestedCourseId);
    const resources = applyManualOrder(parsedResources, orderedIds);
    res.json({ resources });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/flashcards", async (req, res) => {
  try {
    const requestedCourseId = String(req.query.courseId || "").trim();
    if (!requestedCourseId) {
      throw new ApiError(400, "INVALID_INPUT", "Query parameter \"courseId\" is required.");
    }

    requireCourseAccess(req, requestedCourseId);
    const storageCourseId = getFlashcardStorageCourseId(requestedCourseId);
    const orderedIds = await readStoredOrder("notes", storageCourseId);

    if (hasSupabaseStorage) {
      const rows = await supabaseRequest(
        `notes?course_id=eq.${encodeURIComponent(storageCourseId)}&select=id,course_id,title,content,created_at&order=created_at.desc`,
        { method: "GET" },
      );
      const flashcards = applyManualOrder(
        (Array.isArray(rows) ? rows : []).map((row) =>
          toFlashcardPayload({
            id: row.id,
            courseId: row.course_id,
            title: row.title,
            content: row.content || "",
            createdAt: row.created_at,
          }),
        ),
        orderedIds,
      );
      res.json({ flashcards });
      return;
    }

    const store = await ensureStoreLoaded();
    const flashcards = applyManualOrder(
      store.notes
        .filter((note) => note.courseId === storageCourseId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((note) => toFlashcardPayload(note)),
      orderedIds,
    );

    res.json({ flashcards });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/flashcards", async (req, res) => {
  try {
    requireProfessor(req);
    const courseId = readRequiredTextField(req.body, "courseId", 128);
    const question = readRequiredTextField(req.body, "question", MAX_CONTENT_LENGTH);
    const answer = readRequiredTextField(req.body, "answer", MAX_CONTENT_LENGTH);
    const justification = readOptionalTextField(req.body, "justification", MAX_CONTENT_LENGTH);
    const commonMistakes = readOptionalFlashcardCommonMistakes(req.body);
    const storageCourseId = getFlashcardStorageCourseId(courseId);
    const createdAt = new Date().toISOString();
    const id = crypto.randomUUID();

    if (hasSupabaseStorage) {
      const rows = await supabaseRequest("notes", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          id,
          course_id: storageCourseId,
          title: question,
          content: serializeFlashcardContent(answer, justification, commonMistakes),
          link: null,
          created_at: createdAt,
        }),
      });
      const created = Array.isArray(rows) ? rows[0] : null;
      if (!created) {
        throw new ApiError(502, "STORAGE_ERROR", "Unable to persist flashcard.");
      }
      await prependItemInOrder("notes", storageCourseId, id);
      res.status(201).json({
        flashcard: toFlashcardPayload({
          id: created.id,
          courseId: created.course_id,
          title: created.title,
          content: created.content || "",
          createdAt: created.created_at,
        }),
      });
      return;
    }

    const store = await ensureStoreLoaded();
    const storedFlashcard = {
      id,
      courseId: storageCourseId,
      title: question,
      content: serializeFlashcardContent(answer, justification, commonMistakes),
      createdAt,
    };
    store.notes.unshift(storedFlashcard);
    await saveStore();
    await prependItemInOrder("notes", storageCourseId, id);
    res.status(201).json({ flashcard: toFlashcardPayload(storedFlashcard) });
  } catch (error) {
    sendError(res, error);
  }
});

app.put("/api/flashcards/:id", async (req, res) => {
  try {
    requireProfessor(req);
    const id = String(req.params.id || "").trim();
    if (!id) {
      throw new ApiError(400, "INVALID_INPUT", "Missing flashcard id.");
    }
    const question = readRequiredTextField(req.body, "question", MAX_CONTENT_LENGTH);
    const answer = readRequiredTextField(req.body, "answer", MAX_CONTENT_LENGTH);
    const justification = readOptionalTextField(req.body, "justification", MAX_CONTENT_LENGTH);
    const commonMistakes = readOptionalFlashcardCommonMistakes(req.body);

    if (hasSupabaseStorage) {
      const rows = await supabaseRequest(`notes?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          title: question,
          content: serializeFlashcardContent(answer, justification, commonMistakes),
        }),
      });
      const updated = Array.isArray(rows) ? rows[0] : null;
      if (!updated) {
        throw new ApiError(404, "NOT_FOUND", "Flashcard not found.");
      }
      res.json({
        flashcard: toFlashcardPayload({
          id: updated.id,
          courseId: updated.course_id,
          title: updated.title,
          content: updated.content || "",
          createdAt: updated.created_at,
        }),
      });
      return;
    }

    const store = await ensureStoreLoaded();
    const note = store.notes.find((entry) => entry.id === id && String(entry.courseId || "").startsWith(FLASHCARD_COURSE_PREFIX));
    if (!note) {
      throw new ApiError(404, "NOT_FOUND", "Flashcard not found.");
    }
    note.title = question;
    note.content = serializeFlashcardContent(answer, justification, commonMistakes);
    await saveStore();
    res.json({ flashcard: toFlashcardPayload(note) });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/flashcards/:id", async (req, res) => {
  try {
    requireProfessor(req);
    const id = String(req.params.id || "").trim();
    if (!id) {
      throw new ApiError(400, "INVALID_INPUT", "Missing flashcard id.");
    }

    if (hasSupabaseStorage) {
      const existingRows = await supabaseRequest(
        `notes?id=eq.${encodeURIComponent(id)}&select=id,course_id&limit=1`,
        { method: "GET" },
      );
      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      await supabaseRequest(`notes?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (existing?.course_id) {
        await removeItemFromOrder("notes", existing.course_id, id);
      }
      res.json({ ok: true });
      return;
    }

    const store = await ensureStoreLoaded();
    const existing = store.notes.find((entry) => entry.id === id);
    const before = store.notes.length;
    store.notes = store.notes.filter((entry) => entry.id !== id);
    if (store.notes.length === before) {
      throw new ApiError(404, "NOT_FOUND", "Flashcard not found.");
    }
    await saveStore();
    if (existing?.courseId) {
      await removeItemFromOrder("notes", existing.courseId, id);
    }
    res.json({ ok: true });
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

    const candidates = toStorageResourceCandidates(courseId, title);
    if (hasSupabaseStorage) {
      let created = null;
      let lastError = null;
      for (const candidate of candidates) {
        try {
          const rows = await supabaseRequest("resources", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({
              id: resource.id,
              course_id: candidate.storageCourseId,
              type: resource.type,
              title: candidate.storageTitle,
              url: resource.url,
              created_at: resource.createdAt,
            }),
          });
          created = Array.isArray(rows) ? rows[0] : null;
          if (created) break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!created) {
        if (lastError) throw lastError;
        throw new ApiError(502, "STORAGE_ERROR", "Unable to persist resource.");
      }
      await prependItemInOrder("resources", resource.courseId, resource.id);
      const apiResource = toApiResource({
        id: created.id,
        courseId: created.course_id,
        type: created.type,
        title: created.title,
        url: created.url,
        createdAt: created.created_at,
      });
      res.status(201).json({
        resource: apiResource,
      });
      return;
    }

    const store = await ensureStoreLoaded();
    const selectedCandidate = candidates[0];
    const storedResource = {
      ...resource,
      courseId: selectedCandidate.storageCourseId,
      title: selectedCandidate.storageTitle,
    };
    store.resources.unshift(storedResource);
    await saveStore();
    await prependItemInOrder("resources", resource.courseId, resource.id);

    res.status(201).json({ resource: toApiResource(storedResource) });
  } catch (error) {
    sendError(res, error);
  }
});

app.put("/api/resources/:id", async (req, res) => {
  try {
    requireProfessor(req);
    const id = String(req.params.id || "").trim();
    if (!id) {
      throw new ApiError(400, "INVALID_INPUT", "Missing resource id.");
    }

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

    if (hasSupabaseStorage) {
      const existingRows = await supabaseRequest(
        `resources?id=eq.${encodeURIComponent(id)}&select=id,course_id,title&limit=1`,
        { method: "GET" },
      );
      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      if (!existing) {
        throw new ApiError(404, "NOT_FOUND", "Resource not found.");
      }

      const nextStorageTitle = isGeneralStorageResource(existing.course_id, existing.title || "")
        ? normalizeGeneralResourceTitle(title)
        : title;

      const rows = await supabaseRequest(`resources?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          title: nextStorageTitle,
          type,
          url,
        }),
      });
      const updated = Array.isArray(rows) ? rows[0] : null;
      if (!updated) {
        throw new ApiError(404, "NOT_FOUND", "Resource not found.");
      }
      const apiResource = toApiResource({
        id: updated.id,
        courseId: updated.course_id,
        type: updated.type,
        title: updated.title,
        url: updated.url,
        createdAt: updated.created_at,
      });
      res.json({
        resource: apiResource,
      });
      return;
    }

    const store = await ensureStoreLoaded();
    const resource = store.resources.find((entry) => entry.id === id);
    if (!resource) {
      throw new ApiError(404, "NOT_FOUND", "Resource not found.");
    }
    resource.title = isGeneralStorageResource(resource.courseId, resource.title || "")
      ? normalizeGeneralResourceTitle(title)
      : title;
    resource.type = type;
    resource.url = url;
    await saveStore();
    res.json({ resource: toApiResource(resource) });
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
      const existingRows = await supabaseRequest(
        `resources?id=eq.${encodeURIComponent(id)}&select=id,course_id,title&limit=1`,
        { method: "GET" },
      );
      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      await supabaseRequest(`resources?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (existing) {
        if (isGeneralStorageResource(existing.course_id, existing.title || "")) {
          await removeItemFromOrder("resources", GENERAL_COURSE_ID, id);
        } else if (existing.course_id) {
          await removeItemFromOrder("resources", existing.course_id, id);
        }
      }
      res.json({ ok: true });
      return;
    }

    const store = await ensureStoreLoaded();
    const deletedResource = store.resources.find((item) => item.id === id);
    const before = store.resources.length;
    store.resources = store.resources.filter((item) => item.id !== id);
    if (store.resources.length === before) {
      throw new ApiError(404, "NOT_FOUND", "Resource not found.");
    }
    await saveStore();
    if (deletedResource) {
      if (isGeneralStorageResource(deletedResource.courseId, deletedResource.title || "")) {
        await removeItemFromOrder("resources", GENERAL_COURSE_ID, id);
      } else if (deletedResource.courseId) {
        await removeItemFromOrder("resources", deletedResource.courseId, id);
      }
    }
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.put("/api/order", async (req, res) => {
  try {
    requireProfessor(req);
    const entityTypeRaw = readRequiredTextField(req.body, "entityType", 32).toLowerCase();
    const courseId = readRequiredTextField(req.body, "courseId", 128);
    const orderedIds = normalizeOrderIds(req.body?.orderedIds);

    if (entityTypeRaw !== "notes" && entityTypeRaw !== "resources") {
      throw new ApiError(400, "INVALID_INPUT", "Field \"entityType\" must be notes or resources.");
    }
    if (!Array.isArray(req.body?.orderedIds)) {
      throw new ApiError(400, "INVALID_INPUT", "Field \"orderedIds\" must be an array.");
    }

    await upsertStoredOrder(entityTypeRaw, courseId, orderedIds);
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

app.post("/api/flashcards/ai", async (req, res) => {
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

app.get("/api/podcast-episodes", async (_req, res) => {
  try {
    if (!PODCAST_RSS_URL) {
      throw new ApiError(500, "PODCAST_RSS_NOT_CONFIGURED", "Podcast RSS URL is not configured.");
    }
    const candidates = [PODCAST_RSS_URL];
    if (PODCAST_RSS_URL.includes("anchor.fm")) {
      candidates.push(PODCAST_RSS_URL.replace("anchor.fm", "spotifyanchor-web.app.link"));
    }

    let lastError = null;
    for (const sourceUrl of candidates) {
      try {
        const response = await fetch(sourceUrl, {
          method: "GET",
          redirect: "follow",
          headers: {
            Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          lastError = {
            status: response.status,
            body: body.slice(0, 180),
            sourceUrl,
          };
          continue;
        }

        const xml = await response.text();
        const episodes = parsePodcastRss(xml);
        const fallbackEpisodes = episodes.length ? episodes : parsePodcastAtom(xml);

        if (!fallbackEpisodes.length) {
          lastError = {
            status: 200,
            body: "No podcast entries found in feed.",
            sourceUrl,
          };
          continue;
        }

        res.json({
          source: sourceUrl,
          episodes: fallbackEpisodes,
        });
        return;
      } catch (error) {
        lastError = {
          status: 0,
          body: String(error),
          sourceUrl,
        };
      }
    }

    throw new ApiError(502, "PODCAST_RSS_UNAVAILABLE", "Impossible de récupérer le flux podcast.", lastError);
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/access-metrics", async (req, res) => {
  try {
    requireProfessor(req);
    const metrics = await readAccessMetrics();
    res.json(metrics);
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/analytics/event", async (req, res) => {
  try {
    const eventType = readRequiredTextField(req.body, "type", 64).toLowerCase();
    const section = readOptionalTextField(req.body, "section", 64);
    const courseId = readOptionalTextField(req.body, "courseId", 128);
    const target = readOptionalTextField(req.body, "target", 64);
    const label = readOptionalTextField(req.body, "label", 160);

    await recordAppAnalyticsEvent(eventType, {
      section: section || undefined,
      courseId: courseId || undefined,
      target: target || undefined,
      label: label || undefined,
      role: getCurrentSessionRole(req),
    });

    res.status(201).json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/analytics-summary", async (req, res) => {
  try {
    requireProfessor(req);
    const summary = await readAppAnalyticsSummary();
    res.json(summary);
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
