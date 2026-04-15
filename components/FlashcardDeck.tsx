
import React, { useState } from 'react';
import { Flashcard } from '../types.ts';

interface FlashcardDeckProps {
  cards: Flashcard[];
  onClose: () => void;
}

const FlashcardDeck: React.FC<FlashcardDeckProps> = ({ cards, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  if (cards.length === 0) return <div>Pas de cartes disponibles.</div>;

  const currentCard = cards[currentIndex];

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-between items-center mb-6 text-white">
          <h2 className="text-xl font-bold">Révision par Flashcards</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <i className="fas fa-times text-xl"></i>
          </button>
        </div>

        <div 
          className="relative h-80 w-full cursor-pointer perspective-1000"
          onClick={() => setIsFlipped(!isFlipped)}
        >
          <div className={`flashcard-inner relative w-full h-full transition-transform duration-500 shadow-2xl rounded-2xl ${isFlipped ? 'flashcard-flipped' : ''}`}>
            <div className="flashcard-face absolute inset-0 w-full h-full bg-white rounded-2xl p-8 flex flex-col items-center justify-center text-center">
              <span className="absolute top-4 left-6 text-xs font-bold text-slate-400 uppercase tracking-widest">Question</span>
              <p className="text-2xl font-medium text-slate-800 whitespace-pre-line">{currentCard.question}</p>
              <p className="absolute bottom-4 text-xs text-slate-400">Cliquez pour voir la réponse</p>
            </div>

            <div className="flashcard-face flashcard-back absolute inset-0 w-full h-full bg-indigo-600 rounded-2xl p-8 flex flex-col items-center justify-center text-center text-white">
              <span className="absolute top-4 left-6 text-xs font-bold text-indigo-200 uppercase tracking-widest">Réponse</span>
              <div className="max-h-full w-full overflow-y-auto px-2 text-left">
                <div className="rounded-2xl bg-emerald-400/20 p-4 border border-emerald-200/30">
                  <p className="text-xs font-bold uppercase tracking-widest text-emerald-100">Bonne réponse</p>
                  <p className="mt-2 text-xl leading-relaxed whitespace-pre-line">{currentCard.answer}</p>
                </div>
                {currentCard.justification && (
                  <div className="mt-4 rounded-2xl bg-white/10 p-4 text-left">
                    <p className="text-xs font-bold uppercase tracking-widest text-indigo-100">Pourquoi c&apos;est la bonne réponse</p>
                    <p className="mt-2 text-sm leading-relaxed text-white/90 whitespace-pre-line">{currentCard.justification}</p>
                  </div>
                )}
                {!!currentCard.commonMistakes?.length && (
                  <div className="mt-4 rounded-2xl bg-rose-500/15 p-4 text-left border border-rose-200/20">
                    <p className="text-xs font-bold uppercase tracking-widest text-rose-100">Mauvaises réponses fréquentes</p>
                    <div className="mt-3 space-y-3">
                      {currentCard.commonMistakes.map((mistake, index) => (
                        <div key={`${currentCard.id}-mistake-${index}`} className="rounded-xl bg-white/10 p-3">
                          <p className="font-bold text-white">{mistake.answer}</p>
                          <p className="mt-1 text-sm leading-relaxed text-white/85 whitespace-pre-line">{mistake.explanation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <p className="absolute bottom-4 text-xs text-indigo-200">Cliquez pour revenir à la question</p>
            </div>
          </div>
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
