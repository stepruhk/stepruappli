import React, { useState } from 'react';
import type { Flashcard } from '../types.ts';

export default function QcmQuestion({ card }: { card: Flashcard }) {
  const [choices] = useState(() => {
    const options = [
      { answer: card.answer, explanation: card.justification || 'Aucune explication fournie pour ce choix.', correct: true },
      ...(card.commonMistakes || []).map((mistake) => ({ ...mistake, correct: false })),
    ];
    for (let i = options.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return options;
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [validated, setValidated] = useState(false);
  const response = selected == null ? null : choices[selected];

  return (
    <form onSubmit={(event) => { event.preventDefault(); if (selected != null) setValidated(true); }} className="flex h-full flex-col rounded-2xl bg-white p-6 md:p-8">
      <div className="flex-1 overflow-y-auto overscroll-contain pr-1">
        <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Question à choix multiples — une seule réponse</p>
        <fieldset className="mt-4" disabled={validated}>
          <legend className="mb-4 whitespace-pre-line text-base font-semibold text-slate-900">{card.question}</legend>
          <div className="space-y-3">{choices.map((choice, index) => (
            <label key={index} className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 ${selected === index ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white'} ${validated ? 'cursor-default' : 'hover:border-indigo-300'}`}>
              <input type="radio" name={`qcm-${card.id}`} checked={selected === index} onChange={() => setSelected(index)} className="mt-1 h-4 w-4 shrink-0 accent-indigo-600" />
              <span className="whitespace-pre-line text-sm text-slate-800">{choice.answer}</span>
            </label>
          ))}</div>
        </fieldset>
        {validated && response && <div role="status" className={`mt-5 rounded-xl border p-4 ${response.correct ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
          <p className={`font-bold ${response.correct ? 'text-emerald-900' : 'text-rose-900'}`}>{response.correct ? 'Bonne réponse !' : 'Ce n’est pas la bonne réponse.'}</p>
          <p className="mt-2 whitespace-pre-line text-sm text-slate-800">{response.explanation}</p>
          {!response.correct && <div className="mt-4 border-t border-rose-200 pt-3 text-sm text-slate-800">
            <p><strong>Bonne réponse : </strong>{card.answer}</p>
            <p className="mt-2 whitespace-pre-line">{card.justification || 'Aucune explication fournie pour la bonne réponse.'}</p>
          </div>}
          {card.generalFeedback && <p className="mt-4 whitespace-pre-line border-t border-slate-200 pt-3 text-sm text-slate-800"><strong>À retenir : </strong>{card.generalFeedback}</p>}
        </div>}
      </div>
      {!validated && <button type="submit" disabled={selected == null} className="mt-4 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">Valider</button>}
      {validated && <p className="mt-4 text-sm font-semibold text-slate-600">Cliquez sur Suivant pour poursuivre la révision.</p>}
    </form>
  );
}
