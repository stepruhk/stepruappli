import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerGiftImport, readQuizMetadata } from '../server/gift-import.js';

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const text = '::Q1::Une question ? {=Oui#Explication correcte.~Non#Explication incorrecte.}';

async function setup(t, supabase = false) {
  const store = { notes: [] };
  const database = new Map();
  let writes = 0;
  const app = express(); app.use(express.json());
  registerGiftImport(app, {
    ApiError,
    requireProfessor: (req) => { if (req.headers.authorization !== 'professor') throw new ApiError(403, 'FORBIDDEN', 'Professeur requis.'); },
    readRequiredTextField: (body, name, max) => { if (typeof body[name] !== 'string' || !body[name].trim() || body[name].length > max) throw new ApiError(400, 'INVALID_INPUT', name); return body[name].trim(); },
    sendError: (res, error) => res.status(error.status || 500).json({ error: { code: error.code, message: error.message } }),
    getFlashcardStorageCourseId: (id) => `flashcards:${id}`,
    hasSupabaseStorage: supabase,
    supabaseRequest: async (path, init) => { assert.equal(path, 'notes?on_conflict=id'); writes += 1; for (const row of JSON.parse(init.body)) if (!database.has(row.id)) database.set(row.id, row); },
    ensureStoreLoaded: async () => store,
    saveStore: async () => { writes += 1; },
    readStoredOrder: async () => [], upsertStoredOrder: async () => {},
    toFlashcardPayload: (entry) => ({ id: entry.id, courseId: entry.courseId.slice(11), question: entry.title, ...JSON.parse(entry.content) }),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { store, database, writes: () => writes, request: (body, authorization = 'professor') => fetch(`http://127.0.0.1:${server.address().port}/api/flashcards/import-gift`, { method: 'POST', headers: { 'content-type': 'application/json', authorization }, body: JSON.stringify(body) }) };
}

for (const supabase of [false, true]) test(`batch import persists feedback and retries without duplicates (${supabase ? 'Supabase' : 'local'})`, async (t) => {
  const fixture = await setup(t, supabase);
  const body = { courseId: 'course-1', text: text + '\n\n' + text.replace('Q1', 'Q2'), importId: 'test-import-12345678' };
  const first = await fixture.request(body);
  assert.equal(first.status, 201);
  const result = await first.json();
  assert.equal(result.flashcards.length, 2);
  assert.equal(result.flashcards[0].questionType, 'qcm');
  assert.equal(result.flashcards[0].commonMistakes[0].explanation, 'Explication incorrecte.');
  const retry = await fixture.request(body);
  assert.equal(retry.status, 201);
  assert.deepEqual((await retry.json()).flashcards.map((card) => card.id), result.flashcards.map((card) => card.id));
  assert.equal(supabase ? fixture.database.size : fixture.store.notes.length, 2);
});

test('student and malformed imports cannot write anything, including partially valid files', async (t) => {
  const fixture = await setup(t);
  const body = { courseId: 'course-1', text, importId: 'test-import-12345678' };
  assert.equal((await fixture.request(body, 'student')).status, 403);
  assert.equal((await fixture.request({ ...body, text: text + '\n\nQ {TRUE}' })).status, 400);
  assert.equal((await fixture.request({ ...body, importId: 'bad' })).status, 400);
  assert.equal(fixture.writes(), 0);
});

test('quiz editing validates distinct choices and preserves general feedback', () => {
  assert.throws(() => readQuizMetadata({ questionType: 'qcm', answer: 'A', commonMistakes: [{ answer: 'A' }] }, ApiError));
  assert.throws(() => readQuizMetadata({ questionType: 'qcm', answer: 'A' }, ApiError));
  assert.equal(readQuizMetadata({ questionType: 'qcm', answer: 'A', commonMistakes: [{ answer: 'B' }], generalFeedback: ' À retenir ' }, ApiError).generalFeedback, 'À retenir');
});
