import React, { useState } from 'react';
import { parseGift, GIFT_MAX_BYTES, GIFT_MAX_QUESTIONS } from '../shared/gift.js';
import { importGiftFlashcards } from '../services/openaiService.ts';
import type { Flashcard } from '../types.ts';


type Props = { courseId: string; courseTitle: string; onImported: (cards: Flashcard[]) => void; onError: (error: unknown) => void };

export default function GiftImporter({ courseId, courseTitle, onImported, onError }: Props) {
  const [draft, setDraft] = useState<{ text: string; name: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const preview = draft ? parseGift(draft.text) : null;

  const loadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setDraft(null); setError(''); setSuccess(''); setBusy(true);
    try {
      if (!/\.(?:txt|gift)$/i.test(file.name)) throw new Error('Choisissez un fichier .txt ou .gift.');
      if (file.size > GIFT_MAX_BYTES) throw new Error('Le fichier doit faire au maximum 1 Mo.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      setDraft({ text, name: file.name, id: crypto.randomUUID() });
    } catch (error) {
      setError(error instanceof TypeError ? 'Enregistrez le fichier en texte UTF-8, puis réessayez.' : error instanceof Error ? error.message : 'Lecture du fichier impossible.');
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!draft || !preview?.questions.length || preview.errors.length || busy) return;
    setBusy(true); setError('');
    try {
      const cards = await importGiftFlashcards(courseId, draft.text, draft.id);
      onImported(cards);
      setSuccess(`${cards.length} question${cards.length > 1 ? 's' : ''} importée${cards.length > 1 ? 's' : ''} dans « ${courseTitle} ».`);
      setDraft(null);
    } catch (error) {
      onError(error);
      setError(error instanceof Error ? error.message : 'Importation impossible. Réessayez : les questions ne seront pas ajoutées en double.');
    } finally { setBusy(false); }
  };

  return (
    <section className="bg-white rounded-3xl border border-slate-200 p-6 md:p-8 shadow-sm" aria-label="Importation GIFT">
      <h2 className="text-2xl font-black text-slate-900">Importer des questions GIFT</h2>
      <p className="mt-2 text-slate-600">Ajoutez des QCM à une seule bonne réponse, avec une explication pour chaque choix. Vérifiez l’aperçu avant d’enregistrer dans « {courseTitle} ».</p>
      <p className="mt-2 text-sm text-slate-500">Fichier .txt ou .gift en UTF-8, 1 Mo et {GIFT_MAX_QUESTIONS} questions maximum. Les questions existantes sont conservées. Les notes partielles et les autres types de questions ne sont pas pris en charge.</p>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <label className="font-bold text-slate-700">
          Choisir un fichier GIFT
          <input type="file" accept=".gift,.txt,text/plain" disabled={busy} onChange={loadFile}
            className="mt-2 block max-w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-indigo-50 file:px-4 file:py-3 file:font-bold file:text-indigo-700 disabled:opacity-50" />
        </label>
        <a download="exemple-qcm.gift" href="/exemple-qcm.gift" className="font-bold text-indigo-700 underline">Télécharger un exemple GIFT</a>
      </div>
      <div aria-live="polite">
        {busy && <p className="mt-4 font-semibold text-indigo-700">Traitement en cours…</p>}
        {success && <p className="mt-4 font-bold text-emerald-700">{success}</p>}
      </div>
      {error && <p role="alert" className="mt-4 whitespace-pre-line text-red-700">{error}</p>}
      {preview && (
        <div className="mt-6">
          <h3 className="text-lg font-bold text-slate-900">Prévisualisation : {draft?.name} — {preview.questions.length} QCM</h3>
          {!!preview.errors.length && <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
            <p className="font-bold">Corrigez ces erreurs avant l’importation :</p>
            <ul className="mt-2 list-disc pl-5">{preview.errors.map((issue, index) => <li key={index}>Ligne {issue.line} : {issue.message}</li>)}</ul>
          </div>}
          <div className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 p-3">
            {preview.questions.map((card, index) => <article key={index} className="rounded-xl bg-slate-50 p-4">
              <h4 className="font-bold text-slate-900">{index + 1}. {card.title || 'Question sans titre'}</h4>
              <p className="mt-2 whitespace-pre-line text-slate-800">{card.question}</p>
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="font-bold text-emerald-900">Bonne réponse : {card.answer}</p>
                <p className="mt-1 whitespace-pre-line text-slate-700">{card.justification || 'Aucune explication fournie pour ce choix.'}</p>
              </div>
              {card.commonMistakes?.map((choice, i) => <div key={i} className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
                <p className="font-semibold text-slate-800">Mauvaise réponse : {choice.answer}</p>
                <p className="mt-1 whitespace-pre-line text-slate-600">{choice.explanation}</p>
              </div>)}
              {card.generalFeedback && <p className="mt-3 whitespace-pre-line text-slate-700"><strong>Explication générale : </strong>{card.generalFeedback}</p>}
            </article>)}
            {!preview.questions.length && <p className="text-slate-600">Aucune question valide à prévisualiser.</p>}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" disabled={busy || !!preview.errors.length || !preview.questions.length} onClick={save}
              className="rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">Importer {preview.questions.length} question{preview.questions.length > 1 ? 's' : ''} dans ce cours</button>
            <button type="button" disabled={busy} onClick={() => { setDraft(null); setError(''); }} className="rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      )}
    </section>
  );
}
