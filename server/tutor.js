import { readFile } from 'node:fs/promises';
import { getMaterials } from './tutor-materials.js';

const indexes = new WeakMap();

function words(text) {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/\b(?:[a-z]\.){2,}[a-z]?/g, value => value.replaceAll('.', ''))
    .match(/[a-z0-9]{2,}/g) || [];
}

function buildIndex(pack) {
  if (indexes.has(pack)) return indexes.get(pack);
  const pages = pack.pages;
  const postings = new Map();
  for (const [id, page] of pages.entries()) {
    const terms = words(page.text);
    const counts = new Map();
    for (const term of terms) counts.set(term, (counts.get(term) || 0) + 1);
    for (const [term, count] of counts) {
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push([id, count / (count + 0.7 + terms.length / 550)]);
    }
  }
  const index = { pages, postings };
  indexes.set(pack, index);
  return index;
}

export function searchReadings(index, query) {
  const scores = new Map();
  for (const term of new Set(words(query))) {
    const hits = index.postings.get(term) || [];
    const weight = Math.log((index.pages.length + 1) / (hits.length + 1));
    for (const [id, frequency] of hits) scores.set(id, (scores.get(id) || 0) + weight * frequency);
  }
  return [...scores].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => {
    const { document, page, text } = index.pages[id];
    return { document, pdf_page: page, passage: text.slice(0, 8500) };
  });
}

const readingTool = {
  type: 'function',
  name: 'chercher_lectures',
  description: 'Chercher des pages dans les lectures de communication. Utiliser quelques mots clés précis, avec leurs équivalents anglais.',
  parameters: {
    type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
  },
  strict: true,
};

const activities = new Map([
  ['article', 'resume-article'], ['recherche', 'recherche-documentaire'],
  ['smart', 'objectif-smart'], ['ffom', 'analyse-ffom'], ['libre', null],
]);

export function validActivity(activity) { return activities.has(activity); }

function passage(source, begin, end) {
  const start = source.indexOf(begin);
  const stop = source.indexOf(end, start + begin.length);
  if (start < 0 || stop < 0) throw new Error('Introduction de l’activité introuvable.');
  return source.slice(start + begin.length, stop).trim();
}

function opening(activity, source) {
  switch (activity) {
    case 'article': return passage(source, 'mot pour mot :', 'Arrêtez immédiatement');
    case 'recherche': return passage(source, 'Introduction à reproduire :', 'Préciser le sujet et préparer');
    case 'smart': return passage(source, "MESSAGE À AFFICHER À L'ÉTUDIANT", "FIN DU MESSAGE D'INTRODUCTION") +
      '\n\n' + passage(source, 'PREMIÈRE QUESTION : DIAGNOSTIC DE COMMUNICATION', 'Présente les deux choix');
    case 'ffom': {
      const quotes = [...source.matchAll(/^« ([\s\S]*?) »/gm)].map(match => match[1]);
      return [quotes[0], quotes[1], 'Je vais vous guider dans la construction de votre analyse.', quotes[2],
        passage(source, 'Dans ce même premier message, demande également :', 'Attends mes réponses')].join('\n\n');
    }
    default: return 'Quelle notion de communication souhaitez-vous explorer?';
  }
}

export async function answerTutor(activity, messages, callApi) {
  const file = activities.get(activity);
  const source = file ? await readFile(new URL('../prompts/' + file + '.txt', import.meta.url), 'utf8') : '';
  const first = opening(activity, source);
  if (!messages.length) return { blocks: [{text: first, citations: []}] };
  if (activity === 'article' && !messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'input_file'))) {
    return { blocks: [{text: 'Téléversez maintenant le document PDF de l’article scientifique ou du chapitre de livre à résumer.', citations: []}] };
  }
  const pack = await getMaterials();
  const index = pack ? buildIndex(pack) : null;
  let instructions = pack?.instructions || 'Tu es un tuteur en communication et relations publiques. Guide le raisonnement et laisse la rédaction des travaux évalués à l’étudiant. Réponds dans sa langue. Les lectures de cours ne sont pas disponibles sur ce serveur. Pour toute question qui en dépend, signale cette limite et demande un extrait. Cite uniquement les sources réellement consultées.';
  if (source) instructions += '\nPour cette activité spécifique, applique les consignes suivantes en priorité. Son introduction a déjà été présentée.\n' + source;
  if (activity === 'ffom') instructions += '\nPour la figure, fournis un tableau Markdown dont les colonnes sont Origine, Favorable et Défavorable, avec les lignes Interne et Externe. L’application colore les quadrants. Sépare les constats dans chaque cellule avec <br>.';
  const webTools = ['libre', 'recherche', 'article'].includes(activity) ? [{ type: 'web_search' }] : [];
  const tools = [...webTools];
  if (index && ['libre', 'recherche', 'smart'].includes(activity)) tools.push(readingTool);
  const input = [{role: 'user', content: 'Commencer cette activité.'}, {role: 'assistant', content: first}, ...messages];
  for (let round = 0; round <= 2; round++) {
    const response = await callApi('/responses', {
      model: process.env.TUTOR_MODEL || 'gpt-6-sol', store: false, instructions, input,
      tools: round === 2 ? webTools : tools, max_output_tokens: 9000,
    });
    if (response.status !== 'completed') throw new Error('Réponse du tuteur incomplète.');
    const calls = response.output.filter(item => item.type === 'function_call');
    if (calls.length) {
      input.push(...response.output);
      for (const call of calls) {
        if (call.name !== readingTool.name || !index) throw new Error('Recherche de cours indisponible.');
        const { query } = JSON.parse(call.arguments);
        const pages = searchReadings(index, String(query).slice(0, 500));
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(pages) });
      }
      continue;
    }
    const parts = response.output.filter(item => item.type === 'message').flatMap(item => item.content);
    const blocks = parts.filter(part => part.type === 'output_text' || part.type === 'refusal').map(part => ({
      text: part.text || part.refusal,
      citations: (part.annotations || []).filter(a => a.type === 'url_citation' && /^https?:\/\//i.test(a.url))
        .map(a => ({ start: a.start_index, end: a.end_index, url: a.url, title: a.title })),
    }));
    if (blocks.length && blocks.some(block => block.text?.trim())) return { blocks };
    break;
  }
  throw new Error('Le tuteur n’a pas pu terminer sa réponse.');
}
