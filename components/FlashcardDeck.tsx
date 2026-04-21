
import React, { useState } from 'react';
import { Flashcard } from '../types.ts';

interface FlashcardDeckProps {
  cards: Flashcard[];
  onClose: () => void;
  preventCopy?: boolean;
}

const FlashcardDeck: React.FC<FlashcardDeckProps> = ({ cards, onClose, preventCopy = false }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  if (cards.length === 0) return <div>Pas de cartes disponibles.</div>;

  const currentCard = cards[currentIndex];
  const difficultyLevel = Math.max(1, Math.min(5, Math.round(Number(currentCard.difficulty ?? 3))));
  const difficultyPercentage = ((difficultyLevel - 1) / 4) * 100;
  const protectedInteractionProps = preventCopy
    ? {
        onCopy: (event: React.ClipboardEvent) => event.preventDefault(),
        onCut: (event: React.ClipboardEvent) => event.preventDefault(),
        onPaste: (event: React.ClipboardEvent) => event.preventDefault(),
        onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
      }
    : {};

  const handleNext = () => {
    setIsFlipped(false);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % cards.length);
    }, 150);
  };

  const handlePrev = () => {
    setIsFlipped(false);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev - 1 + cards.length) % cards.length);
    }, 150);
  };

  const renderQuestionFace = () => (
    <div className="flex h-full w-full flex-col bg-white rounded-2xl p-6 md:p-8">
      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Question</span>
      <div
        className="mt-5 flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 md:pr-2 pb-4"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
        {...protectedInteractionProps}
      >
        <div className="mb-5">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
            <span>Difficulté</span>
            <span>{difficultyLevel}/5</span>
          </div>
          <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500"></div>
            <div
              className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white bg-white shadow"
              style={{ left: `calc(${difficultyPercentage}% - 0.5rem)` }}
            ></div>
          </div>
        </div>
        <p className={`text-sm font-normal leading-relaxed text-slate-800 whitespace-pre-line text-left ${preventCopy ? 'select-none' : ''}`}>
          {currentCard.question}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setIsFlipped(true)}
        className="mt-3 text-sm font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
      >
        Cliquez pour voir la réponse
      </button>
    </div>
  );

  const renderAnswerFace = () => (
    <div className="flex h-full w-full flex-col bg-white rounded-2xl p-6 md:p-8 text-slate-800">
      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Réponse</span>
      <div
        className="mt-5 flex-1 min-h-0 overflow-y-auto overscroll-contain px-1 md:px-2 pb-4 text-left"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
        {...protectedInteractionProps}
      >
        <div className="rounded-2xl bg-indigo-50 p-5 border border-indigo-100">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">Bonne réponse</p>
          <p className={`mt-3 text-sm leading-relaxed whitespace-pre-line text-slate-800 ${preventCopy ? 'select-none' : ''}`}>{currentCard.answer}</p>
        </div>
        {currentCard.justification && (
          <div className="mt-4 rounded-2xl bg-slate-50 p-5 text-left border border-slate-100">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-600">Pourquoi c&apos;est la bonne réponse</p>
            <p className={`mt-2 text-sm leading-relaxed text-slate-700 whitespace-pre-line ${preventCopy ? 'select-none' : ''}`}>{currentCard.justification}</p>
          </div>
        )}
        {!!currentCard.commonMistakes?.length && (
          <div className="mt-4 rounded-2xl bg-rose-50 p-5 text-left border border-rose-100">
            <p className="text-xs font-bold uppercase tracking-widest text-rose-700">Mauvaises réponses fréquentes</p>
            <div className="mt-3 space-y-3">
              {currentCard.commonMistakes.map((mistake, index) => (
                <div key={`${currentCard.id}-mistake-${index}`} className="rounded-xl bg-white p-3 border border-rose-100">
                  <p className={`font-bold text-slate-800 ${preventCopy ? 'select-none' : ''}`}>{mistake.answer}</p>
                  <p className={`mt-1 text-sm leading-relaxed text-slate-700 whitespace-pre-line ${preventCopy ? 'select-none' : ''}`}>{mistake.explanation}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setIsFlipped(false)}
        className="mt-3 w-full text-center text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
      >
        Cliquez pour revenir à la question
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl">
        <div className="flex justify-between items-center mb-6 text-white">
          <h2 className="text-xl font-bold">Révision par Flashcards</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <i className="fas fa-times text-xl"></i>
          </button>
        </div>

        <div className="relative h-[min(70vh,34rem)] w-full overflow-hidden rounded-2xl bg-white shadow-2xl">
          {isFlipped ? renderAnswerFace() : renderQuestionFace()}
        </div>

        <div className="flex justify-between items-center mt-8 px-4">
          <button 
            onClick={(e) => { e.stopPropagation(); handlePrev(); }}
            className="flex items-center space-x-2 text-white bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
          >
            <i className="fas fa-chevron-left"></i>
            <span>Précédent</span>
          </button>
          
          <span className="text-white font-medium">{currentIndex + 1} / {cards.length}</span>

          <button 
            onClick={(e) => { e.stopPropagation(); handleNext(); }}
            className="flex items-center space-x-2 text-white bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
          >
            <span>Suivant</span>
            <i className="fas fa-chevron-right"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default FlashcardDeck;
