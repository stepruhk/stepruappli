import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGift } from '../shared/gift.js';

const valid = `::FFOM::Une opportunité est… {
=Un facteur externe favorable.#C’est une condition de l’environnement.
~Un facteur interne favorable.#Il s’agit d’une force.
~Un facteur externe défavorable.#Il s’agit d’une menace.
####Vérifiez l’origine et l’effet.
}`;

test('imports several Moodle questions with titles, feedback, categories and UTF-8 BOM', () => {
  const result = parseGift('\ufeff// export Moodle\r\n$CATEGORY: Cours/FFOM\r\n\r\n' + valid + '\n\n' + valid.replace('FFOM', 'FFOM2'));
  assert.deepEqual(result.errors, []);
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].answer, 'Un facteur externe favorable.');
  assert.equal(result.questions[0].commonMistakes[1].explanation, 'Il s’agit d’une menace.');
  assert.equal(result.questions[0].generalFeedback, 'Vérifiez l’origine et l’effet.');
});

test('escaped GIFT punctuation is kept as content rather than parsed as choices', () => {
  const result = parseGift(String.raw`::Calcul\: test::Quel texte contient les symboles ? {
=\= \~ \# \{ \} \: \\ #Les symboles sont échappés.
~Autre #Voir les symboles.
}`);
  assert.deepEqual(result.errors, []);
  assert.equal(result.questions[0].title, 'Calcul: test');
  assert.equal(result.questions[0].answer, '= ~ # { } : \\');
});

test('Moodle HTML is converted to plain readable text, never executed', () => {
  const result = parseGift('::HTML::[html]<p>Quel &eacute;noncé &amp; quel choix ?</p>{=<b>Oui</b>#<p>Correct<br>suite</p>~Non#<i>Incorrect</i>}');
  assert.deepEqual(result.errors, []);
  assert.equal(result.questions[0].answer, 'Oui');
  assert.equal(result.questions[0].question, 'Quel énoncé & quel choix ?');
  assert.equal(result.questions[0].justification, 'Correct\nsuite');
  assert.ok(!result.questions[0].question.includes('<p>'));
});

test('supports 100% weighting and flags partial credit rather than losing grading meaning', () => {
  assert.equal(parseGift('Q {~%100%Oui#Bien~%0%Non#Non}').questions[0].answer, 'Oui');
  assert.match(parseGift('Q {~%50%Oui~%50%Non}').errors[0].message, /partielles/);
});

test('rejects unsupported, malformed and ambiguous questions and reports line numbers', () => {
  for (const text of ['Q {TRUE}', 'Q {#42}', 'Q {=A =B ~C}', 'Q {=A ~A}', 'Q {=A}', 'Q {=A ~B', 'Q {=A ~B {nested}}']) {
    assert.ok(parseGift(text).errors.length, text);
  }
  const result = parseGift(valid + '\n\nQ {FALSE}');
  assert.equal(result.questions.length, 1);
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0].line > 1);
});

test('handles missing explanations explicitly and rejects embedded media', () => {
  const result = parseGift('Q {=A ~B}');
  assert.equal(result.questions[0].justification, '');
  assert.equal(result.questions[0].commonMistakes[0].explanation, 'Aucune explication fournie pour ce choix.');
  assert.ok(parseGift('[html]<img src="a">Q {=A ~B}').errors.length);
});

test('enforces file and question count limits', () => {
  assert.ok(parseGift('é'.repeat(600_000)).errors.length);
  assert.ok(parseGift(Array.from({ length: 201 }, () => valid).join('\n\n')).errors.length);
  assert.ok(parseGift('').errors.length);
});

test('does not silently swallow an incomplete question or two questions on one line', () => {
  assert.ok(parseGift('Question sans réponses\n\n' + valid).errors.length);
  assert.ok(parseGift('Q {=A ~B} Q2 {=C ~D}').errors.length);
});
