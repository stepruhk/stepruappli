import React, { useEffect, useRef, useState } from 'react';
import { askTutor, tutorMaterialsStatus, importTutorMaterials, type TutorMaterialsStatus, type TutorActivity, type TutorBlock, type TutorMessage } from '../services/openaiService.ts';

const activities = [
  { id: 'article', title: 'Résumer un article scientifique', icon: 'fa-file-pdf' },
  { id: 'recherche', title: 'Débuter une recherche documentaire', icon: 'fa-magnifying-glass' },
  { id: 'smart', title: 'Écrire un objectif SMART', icon: 'fa-bullseye' },
  { id: 'ffom', title: 'Faire une analyse FFOM', icon: 'fa-table-cells-large' },
  { id: 'libre', title: 'Poser une autre question', icon: 'fa-comment' },
] as const;
type Turn = { message: TutorMessage; reply: TutorBlock[] };

function inline(text: string): React.ReactNode[] {
  return text.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*\n]+\*\*|https?:\/\/[^\s<>]+)/g).map((part, i) => {
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link || /^https?:\/\//.test(part)) return <a key={i} href={link ? link[2] : part} target="_blank" rel="noreferrer" className="underline text-indigo-700">{link ? link[1] : part}</a>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

function Reply({ block, ffom }: { block: TutorBlock; ffom: boolean }) {
  let text = block.text;
  for (const citation of [...block.citations].sort((a, b) => b.start - a.start)) {
    if (citation.start < 0 || citation.end < citation.start || citation.end > block.text.length) continue;
    const title = (citation.title || 'Source').replace(/[\[\]\n]/g, ' ');
    text = text.slice(0, citation.start) + ' [' + title + '](' + citation.url + ') ' + text.slice(citation.end);
  }
  return <>{text.split(/(^\s*\|[^\n]+\|[^\S\n]*\n\|[ :|\-]+\|[^\S\n]*(?:\n\|[^\n]+\|[^\S\n]*)+)/gm).map((part, i) => {
    const rows = part.trim().split('\n');
    if (!/^\|[ :|\-]+\|$/.test(rows[1]?.trim() || '')) {
      return <div key={i} className="whitespace-pre-wrap break-words">{inline(part.trim())}</div>;
    }
    const cells = (row: string) => row.trim().slice(1, -1).split('|').map(value => value.trim().replace(/<br\s*\/?\s*>/gi, '\n'));
    const headers = cells(rows[0]);
    const matrix = ffom && headers.length === 3 && /favorable/i.test(headers[1]) && /défavorable/i.test(headers[2]);
    const colors = [['bg-emerald-50', 'bg-amber-50'], ['bg-sky-50', 'bg-rose-50']];
    return <div key={i} className="overflow-x-auto my-3"><table className="w-full border-collapse text-left">
      <thead><tr>{headers.map((h, j) => <th key={j} className="border p-2 bg-slate-100">{inline(h)}</th>)}</tr></thead>
      <tbody>{rows.slice(2).map((row, r) => <tr key={r}>{cells(row).map((cell, c) => <td key={c}
        className={'align-top whitespace-pre-line border p-2 ' + (matrix && c > 0 ? colors[r]?.[c - 1] || '' : '')}>{inline(cell)}</td>)}</tr>)}</tbody>
    </table></div>;
  })}</>;
}

async function attachPdf(file: File) {
  if (file.size > 8 * 1024 * 1024 || await file.slice(0, 5).text() !== '%PDF-') {
    throw new Error('Joignez un fichier PDF de 8 Mo maximum.');
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Le fichier PDF ne peut pas être lu.'));
    reader.onload = () => resolve('data:application/pdf;base64,' + String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return { name: file.name, data };
}

export default function TutorPreview() {
  const [activity, setActivity] = useState<TutorActivity | null>(null);
  const [opening, setOpening] = useState<TutorBlock[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resources, setResources] = useState<TutorMaterialsStatus | null>(null);
  useEffect(() => {
    let active = true;
    tutorMaterialsStatus().then(status => { if (active) setResources(status); })
      .catch(() => { if (active) setError('Impossible de vérifier le stockage des lectures.'); });
    return () => { active = false; };
  }, []);
  const gate = useRef(false);
  const upload = useRef<HTMLInputElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [turns]);
  function reset() {
    setActivity(null); setOpening([]); setTurns([]); setDraft(''); setFile(null); setError('');
  }
  async function run(task: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true; setBusy(true); setError('');
    try { await task(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(/api.key|authentication failed/i.test(message) ? 'La connexion à OpenAI doit être configurée sur le serveur.'
        : /upstream|OpenAI|fetch|network|rate limit/i.test(message) ? 'Le service d’IA ne peut pas répondre pour le moment. Réessayez.'
        : message || 'Impossible de continuer. Réessayez.');
    } finally { gate.current = false; setBusy(false); }
  }
  function start(id: TutorActivity) {
    void run(async () => { const result = await askTutor(id, []); setOpening(result.blocks); setActivity(id); });
  }
  function send() {
    if (!activity || (!draft.trim() && !file)) return;
    void run(async () => {
      const message: TutorMessage = { role: 'user', content: draft.trim() || 'Voici mon document PDF.' };
      if (file) message.pdf = await attachPdf(file);
      const history = turns.flatMap(t => [t.message, { role: 'assistant' as const, content: t.reply.map(b => b.text).join('\n\n') }]);
      const result = await askTutor(activity, [...history, message]);
      setTurns(previous => [...previous, { message, reply: result.blocks }]);
      setDraft(''); setFile(null);
      if (upload.current) upload.current.value = '';
    });
  }
  const smartStart = activity === 'smart' && !turns.length;
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 md:p-8 shadow-sm">
    <h1 className="text-3xl font-black text-slate-900">stépru, le prof de comm</h1>
    <p className="mt-2 text-sm text-slate-600">Version d’essai réservée au professeur</p>
    {!activity && resources && <div className="mt-3 text-sm text-slate-600">
      {resources.documents > 0 ? <p>{resources.documents} lectures de cours disponibles.</p> :
        <label className="block font-semibold">Charger les ressources privées du tuteur
          <input type="file" accept=".gz,application/gzip" disabled={busy} className="mt-1 block"
            onChange={e => {
              const pack = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (!pack) return;
              void run(async () => {
                if (pack.size > 12 * 1024 * 1024) throw new Error('Le fichier de ressources dépasse 12 Mo.');
                const bytes = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result).split(',')[1]);
                  reader.onerror = () => reject(new Error('Le fichier de ressources ne peut pas être lu.'));
                  reader.readAsDataURL(pack);
                });
                setResources(await importTutorMaterials(bytes));
              });
            }} />
        </label>}
    </div>}
    {!activity ? <div className="mt-6 grid gap-3 sm:grid-cols-2">{activities.map(a =>
      <button key={a.id} disabled={busy} onClick={() => start(a.id)} className="flex gap-3 items-center text-left rounded-2xl border border-indigo-200 bg-indigo-50 p-4 font-bold text-indigo-900 hover:bg-indigo-100">
        <i aria-hidden="true" className={'fas ' + a.icon}></i>{a.title}</button>)}</div> : <>
      <div className="my-5 flex flex-wrap justify-between items-center gap-2">
        <h2 className="text-xl font-bold">{activities.find(a => a.id === activity)?.title}</h2>
        <button disabled={busy} onClick={reset} className="underline text-indigo-700">Nouvelle conversation</button>
      </div>
      <div ref={transcript} role="log" aria-label="Conversation" className="space-y-4 max-h-[55vh] overflow-y-auto">
        {opening.map((b, i) => <React.Fragment key={i}><Reply block={b} ffom={false} /></React.Fragment>)}
        {turns.map((t, i) => <div key={i} className="space-y-3">
          <div className="rounded-xl bg-indigo-50 p-3"><strong>Vous</strong><p className="whitespace-pre-wrap">{t.message.content}</p>{t.message.pdf?.name}</div>
          <div><strong>stépru</strong>{t.reply.map((b, j) => <React.Fragment key={j}><Reply block={b} ffom={activity === 'ffom'} /></React.Fragment>)}</div>
        </div>)}
      </div>
      <form onSubmit={e => { e.preventDefault(); send(); }} className="mt-5 space-y-3">
        {smartStart ? <fieldset disabled={busy}><legend className="font-semibold">Votre réponse</legend>
          {["Oui, j'ai réalisé mon diagnostic.", "Non, je n'ai pas encore réalisé mon diagnostic."].map(label =>
            <label key={label} className="block"><input name="diagnostic" type="radio" checked={draft === label} onChange={() => setDraft(label)} /> {label}</label>)}
        </fieldset> : <><label htmlFor="tutor-text" className="font-semibold">Votre message</label>
          <textarea id="tutor-text" rows={3} maxLength={16000} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)}
            className="block w-full rounded-xl border border-slate-300 p-3" />
          <label className="block text-sm">Joindre un PDF (8 Mo maximum)
            <input ref={upload} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={e => setFile(e.target.files?.[0] || null)} className="block mt-1 max-w-full" />
          </label></>}
        <button disabled={busy || (!draft.trim() && !file)} className="rounded-xl bg-indigo-700 px-5 py-2 font-bold text-white disabled:opacity-50">{smartStart ? 'Continuer' : 'Envoyer'}</button>
      </form>
    </>}
    {busy && <p role="status" className="mt-3">stépru prépare sa réponse…</p>}
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
  </section>;
}
