import crypto from 'node:crypto';
import { parseGift, GIFT_MAX_BYTES } from '../shared/gift.js';

export function readQuizMetadata(body, ApiError) {
  const questionType = body.questionType;
  const generalFeedback = body.generalFeedback ?? '';
  if (questionType != null && questionType !== 'qcm') throw new ApiError(400, 'INVALID_INPUT', 'Type de question invalide.');
  if (typeof generalFeedback !== 'string' || generalFeedback.length > 12000) throw new ApiError(400, 'INVALID_INPUT', 'Explication générale invalide (12 000 caractères maximum).');
  if (questionType === 'qcm') {
    const answers = [body.answer, ...(Array.isArray(body.commonMistakes) ? body.commonMistakes.map((item) => item?.answer) : [])];
    if (answers.length < 2 || answers.length > 20 || answers.some((answer) => typeof answer !== 'string' || !answer.trim()) || new Set(answers.map((answer) => answer.trim())).size !== answers.length) {
      throw new ApiError(400, 'INVALID_INPUT', 'Un QCM doit contenir de 2 à 20 choix distincts, dont une bonne réponse.');
    }
  }
  return { ...(questionType ? { questionType } : {}), generalFeedback: generalFeedback.trim() };
}

export function registerGiftImport(app, helpers) {
  const { requireProfessor, readRequiredTextField, ApiError, sendError, getFlashcardStorageCourseId,
    hasSupabaseStorage, supabaseRequest, ensureStoreLoaded, saveStore, readStoredOrder, upsertStoredOrder, toFlashcardPayload } = helpers;
  app.post('/api/flashcards/import-gift', async (req, res) => {
    try {
      requireProfessor(req);
      const courseId = readRequiredTextField(req.body, 'courseId', 128);
      const text = readRequiredTextField(req.body, 'text', GIFT_MAX_BYTES);
      const importId = readRequiredTextField(req.body, 'importId', 80);
      if (!/^[\w-]{16,80}$/.test(importId)) throw new ApiError(400, 'INVALID_INPUT', 'Identifiant d’importation invalide.');
      const { questions, errors } = parseGift(text);
      if (errors.length) throw new ApiError(400, 'INVALID_GIFT', errors.map((error) => `Ligne ${error.line} : ${error.message}`).join('\n'));
      const storageCourseId = getFlashcardStorageCourseId(courseId);
      const createdAt = new Date().toISOString();
      const entries = questions.map(({ title, ...question }, index) => {
        // A retry of the same import cannot create duplicate cards.
        const hex = crypto.createHash('sha256').update(JSON.stringify([courseId, importId, text, index])).digest('hex').slice(0, 32);
        const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        const { question: prompt, ...content } = question;
        return { id, courseId: storageCourseId, title: prompt, content: JSON.stringify(content), createdAt };
      });
      if (hasSupabaseStorage) {
        // One database request for the whole batch, rather than one write per question.
        await supabaseRequest('notes?on_conflict=id', {
          method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(entries.map((entry) => ({ id: entry.id, course_id: entry.courseId,
            title: entry.title, content: entry.content, link: null, created_at: entry.createdAt }))),
        });
      } else {
        const store = await ensureStoreLoaded();
        const known = new Set(store.notes.map((note) => note.id));
        const previous = store.notes;
        store.notes = [...entries.filter((entry) => !known.has(entry.id)), ...previous];
        try { await saveStore(); } catch (error) { store.notes = previous; throw error; }
      }
      const order = await readStoredOrder('notes', storageCourseId);
      const ids = new Set(entries.map((entry) => entry.id));
      await upsertStoredOrder('notes', storageCourseId, [...ids, ...order.filter((id) => !ids.has(id))]);
      res.status(201).json({ flashcards: entries.map(toFlashcardPayload) });
    } catch (error) { sendError(res, error); }
  });
}
