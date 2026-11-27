// Shared by the import preview and the server: no execution of imported markup.
export const GIFT_MAX_QUESTIONS = 200;
export const GIFT_MAX_BYTES = 1_000_000;
const MAX_TEXT = 12_000;
const special = new Set(['~', '=', '#', '{', '}', ':', '\\']);

function find(text, character, from = 0) {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '\\') { i += 1; continue; }
    if (text[i] === character) return i;
  }
  return -1;
}

function readable(text, format) {
  let value = text.trim();
  if (format === 'html') {
    if (/<(?:img|audio|video|iframe)\b/i.test(value)) throw new Error('Les médias intégrés ne sont pas pris en charge.');
    value = value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])\s*>/gi, '\n').replace(/<[^>]*>/g, '')
      .replace(/&(#x[\da-f]+|#\d+|[a-z][a-z0-9]*);/gi, (entity, code) => {
        const named = { eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', auml: 'ä', icirc: 'î', iuml: 'ï', ocirc: 'ô', ouml: 'ö', ugrave: 'ù', ucirc: 'û', uuml: 'ü', ccedil: 'ç', oelig: 'œ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
        if (named[code.toLowerCase()]) {
          const letter = named[code.toLowerCase()];
          return /^[A-Z](?:acute|grave|circ|uml|cedil|elig)$/.test(code) ? letter.toUpperCase() : letter;
        }
        if (!code.startsWith('#')) return entity;
        const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
      });
  }
  value = value.replace(/\\(.)/gs, (match, char) => char === 'n' ? '\n' : special.has(char) ? char : match).trim();
  if (value.length > MAX_TEXT) throw new Error('Un texte dépasse la limite de 12 000 caractères.');
  return value;
}

function parseQuestion(header, body, suffix) {
  let title = '';
  let question = header.trim();
  if (question.startsWith('::')) {
    let end = -1;
    for (let i = 2; i < question.length - 1; i += 1) {
      if (question[i] === '\\') { i += 1; continue; }
      if (question.slice(i, i + 2) === '::') { end = i; break; }
    }
    if (end < 0) throw new Error('Le titre de la question doit se terminer par ::.');
    title = readable(question.slice(2, end), 'plain');
    question = question.slice(end + 2).trim();
  }
  let format = 'moodle';
  const tag = question.match(/^\[(html|plain|moodle|markdown)\]/i);
  if (tag) { format = tag[1].toLowerCase(); question = question.slice(tag[0].length); }
  question = readable(question + suffix, format);
  if (!question) throw new Error('La question est vide.');
  let generalFeedback = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '\\') { i += 1; continue; }
    if (body.slice(i, i + 4) === '####') {
      generalFeedback = readable(body.slice(i + 4), format);
      body = body.slice(0, i);
      break;
    }
  }
  body = body.trim();
  if (!/^[=~]/.test(body)) throw new Error('Seuls les QCM à une seule bonne réponse sont pris en charge (pas les vrai/faux, numériques ou appariements).');
  const starts = [];
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '\\') { i += 1; continue; }
    if (body[i] === '=' || body[i] === '~') starts.push(i);
  }
  const choices = starts.map((start, index) => {
    let text = body.slice(start + 1, starts[index + 1] ?? body.length).trim();
    let correct = body[start] === '=';
    const weight = text.match(/^%(-?\d+(?:\.\d+)?)%/);
    if (weight) {
      const score = Number(weight[1]);
      if (![0, 100].includes(score) && score > 0) throw new Error('Les notes partielles ne sont pas prises en charge.');
      correct = score === 100;
      text = text.slice(weight[0].length);
    }
    if (find(text, '>') >= 0 && /(^|[^\\])->/.test(text)) throw new Error('Les questions d’appariement ne sont pas prises en charge.');
    const feedback = find(text, '#');
    const answer = readable(feedback < 0 ? text : text.slice(0, feedback), format);
    const explanation = feedback < 0 ? '' : readable(text.slice(feedback + 1), format);
    if (!answer) throw new Error('Un choix de réponse est vide.');
    return { answer, explanation, correct };
  });
  if (choices.length < 2 || choices.length > 20) throw new Error('Un QCM doit comporter entre 2 et 20 choix.');
  if (choices.filter((choice) => choice.correct).length !== 1) throw new Error('Un QCM doit avoir exactement une bonne réponse.');
  if (new Set(choices.map((choice) => choice.answer)).size !== choices.length) throw new Error('Deux choix de réponse sont identiques.');
  const correct = choices.find((choice) => choice.correct);
  return {
    title, question, answer: correct.answer, justification: correct.explanation,
    commonMistakes: choices.filter((choice) => !choice.correct).map(({ answer, explanation }) => ({
      answer, explanation: explanation || 'Aucune explication fournie pour ce choix.',
    })),
    questionType: 'qcm', generalFeedback, difficulty: 3,
  };
}

export function parseGift(input) {
  const questions = [];
  const errors = [];
  if (typeof input !== 'string' || new TextEncoder().encode(input).length > GIFT_MAX_BYTES) {
    return { questions, errors: [{ line: 1, message: 'Le fichier doit contenir au maximum 1 Mo de texte UTF-8.' }] };
  }
  const source = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    .replace(/^[\t ]*(?:\/\/[^\n]*|\$CATEGORY:[^\n]*)$/gm, '');
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] || '') && cursor < source.length) cursor += 1;
    if (cursor >= source.length) break;
    const line = source.slice(0, cursor).split('\n').length;
    const open = find(source, '{', cursor);
    if (open < 0) { errors.push({ line, message: 'Accolade ouvrante { manquante.' }); break; }
    const close = find(source, '}', open + 1);
    if (close < 0) { errors.push({ line, message: 'Accolade fermante } manquante.' }); break; }
    const newline = source.indexOf('\n', close + 1);
    const end = newline < 0 ? source.length : newline;
    try {
      if (find(source.slice(cursor, open), '}') >= 0 || find(source.slice(open + 1, close), '{') >= 0) {
        throw new Error('Accolades non échappées dans le texte : utilisez \\{ et \\}.');
      }
      if (/\n[\t ]*\n/.test(source.slice(cursor, open).trim()) || find(source.slice(close + 1, end), '{') >= 0 || find(source.slice(close + 1, end), '}') >= 0) {
        throw new Error('Question incomplète ou questions non séparées : utilisez une ligne vide entre les questions.');
      }
      questions.push(parseQuestion(source.slice(cursor, open), source.slice(open + 1, close), source.slice(close + 1, end)));
    } catch (error) { errors.push({ line, message: error.message }); }
    cursor = end;
    if (questions.length > GIFT_MAX_QUESTIONS) {
      errors.push({ line, message: `Importez au maximum ${GIFT_MAX_QUESTIONS} questions à la fois.` }); break;
    }
  }
  if (!questions.length && !errors.length) errors.push({ line: 1, message: 'Aucune question trouvée dans ce fichier.' });
  return { questions, errors };
}
