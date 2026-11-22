import React, { useEffect, useRef, useState } from 'react';
import { askTutor, tutorMaterialsStatus, importTutorMaterials, type TutorMaterialsStatus, type TutorActivity, type TutorBlock, type TutorMessage } from '../services/openaiService.ts';

const activities = [
  { id: 'article', title: 'Résumer un article scientifique', short: 'Résumé d’article', description: 'Comprendre un article à partir de son PDF.', icon: 'fa-file-lines' },
  { id: 'recherche', title: 'Débuter une recherche documentaire', short: 'Recherche documentaire', description: 'Préciser votre sujet et trouver des sources.', icon: 'fa-magnifying-glass' },
  { id: 'smart', title: 'Écrire un objectif SMART', short: 'Objectif SMART', description: 'Construire un objectif, étape par étape.', icon: 'fa-bullseye' },
  { id: 'ffom', title: 'Faire une analyse FFOM', short: 'Analyse FFOM', description: 'Explorer les forces, faiblesses, opportunités et menaces.', icon: 'fa-table-cells-large' },
  { id: 'libre', title: 'Poser une autre question', short: 'Conversation libre', description: 'Explorer une notion de communication.', icon: 'fa-comment' },
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pending, setPending] = useState<TutorMessage | null>(null);
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
  }, [turns, pending, opening]);
  function reset() {
    setActivity(null); setOpening([]); setTurns([]); setDraft(''); setFile(null); setError(''); setSidebarOpen(false);
    if (upload.current) upload.current.value = '';
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
    } finally { gate.current = false; setBusy(false); setPending(null); }
  }
  function start(id: TutorActivity) {
    void run(async () => { const result = await askTutor(id, []); setTurns([]); setDraft(''); setFile(null); if (upload.current) upload.current.value = ''; setOpening(result.blocks); setActivity(id); setSidebarOpen(false); });
  }
  function send() {
    if (!draft.trim() && !file) return;
    void run(async () => {
      const message: TutorMessage = { role: 'user', content: draft.trim() || 'Voici mon document PDF.' };
      if (file) message.pdf = await attachPdf(file);
      setPending(message);
      const selectedActivity = activity || 'libre';
      const intro = activity ? opening : (await askTutor(selectedActivity, [])).blocks;
      const history = turns.flatMap(t => [t.message, { role: 'assistant' as const, content: t.reply.map(b => b.text).join('\n\n') }]);
      const result = await askTutor(selectedActivity, [...history, message]);
      setActivity(selectedActivity); setOpening(intro);
      setTurns(previous => [...previous, { message, reply: result.blocks }]);
      setDraft(''); setFile(null);
      if (upload.current) upload.current.value = '';
    });
  }
  const smartStart = activity === 'smart' && !turns.length;
  const selected = activities.find(a => a.id === activity);
  const resourceUpload = <label className="st-resource-upload">Charger les lectures
    <input type="file" accept=".gz,application/gzip" disabled={busy} onChange={e => {
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
  </label>;
  return <section className="st-shell" aria-label="stépru, le prof de comm">
    <style>{styles}</style>
    {sidebarOpen && <button className="st-backdrop" aria-label="Fermer le panneau des activités" onClick={() => setSidebarOpen(false)} />}
    <aside className={'st-sidebar ' + (sidebarOpen ? 'st-sidebar-open' : '')} aria-label="Activités du tuteur">
      <div className="st-brand"><span className="st-mark">s.</span><span>stépru<small>le prof de comm</small></span></div>
      <button className="st-new" disabled={busy} onClick={reset}><i aria-hidden="true" className="fas fa-plus" />Nouvelle conversation</button>
      <p className="st-nav-label">Votre accompagnement</p>
      <nav>{activities.map(a => <button key={a.id} disabled={busy} aria-current={activity === a.id ? 'page' : undefined}
        onClick={() => start(a.id)} className={'st-nav-item ' + (activity === a.id ? 'st-nav-active' : '')}>
        <i aria-hidden="true" className={'fas ' + a.icon} /><span>{a.short}</span>
      </button>)}</nav>
      <div className="st-resources"><i className="fas fa-book-open" aria-hidden="true" />
        {resources ? resources.documents > 0 ? <span>{resources.documents} lectures de cours</span> : resourceUpload : <span>Chargement des lectures…</span>}
      </div>
    </aside>
    <div className="st-workspace">
      <header className="st-header">
        <button className="st-menu" type="button" aria-label="Afficher les activités" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>
          <i aria-hidden="true" className="fas fa-bars" />
        </button>
        <div><h1>stépru, le prof de comm</h1>{selected && <p>{selected.short}</p>}</div>
        <span className="st-preview"><i className="fas fa-lock" aria-hidden="true" />Essai professeur</span>
      </header>
      <div ref={transcript} className="st-transcript" role="log" aria-label="Conversation">
        {!activity && !pending && <div className="st-welcome">
          <span className="st-welcome-mark">s.</span>
          <h2>Sur quoi souhaitez-vous travailler?</h2>
          <p>Une question, une lecture ou une idée à approfondir.</p>
          <div className="st-cards">{activities.slice(0, 4).map(a => <button key={a.id} disabled={busy} onClick={() => start(a.id)} aria-label={a.title}>
            <i aria-hidden="true" className={'fas ' + a.icon} /><strong>{a.short}</strong><span>{a.description}</span>
          </button>)}</div>
        </div>}
        {activity && <div className="st-message st-assistant"><span className="st-avatar" aria-hidden="true">s.</span>
          <div className="st-answer">{opening.map((b, i) => <React.Fragment key={i}><Reply block={b} ffom={false} /></React.Fragment>)}</div>
        </div>}
        {turns.map((t, i) => <React.Fragment key={i}>
          <div className="st-message st-user"><div><p>{t.message.content}</p>{t.message.pdf && <span className="st-document"><i className="fas fa-file-pdf" aria-hidden="true" />{t.message.pdf.name}</span>}</div></div>
          <div className="st-message st-assistant"><span className="st-avatar" aria-hidden="true">s.</span>
            <div className="st-answer">{t.reply.map((b, j) => <React.Fragment key={j}><Reply block={b} ffom={activity === 'ffom'} /></React.Fragment>)}</div>
          </div>
        </React.Fragment>)}
        {pending && <div className="st-message st-user"><div><p>{pending.content}</p>{pending.pdf && <span className="st-document">{pending.pdf.name}</span>}</div></div>}
        {busy && <div role="status" className="st-thinking"><span className="st-pulse" />stépru prépare sa réponse…</div>}
      </div>
      <footer className="st-footer">
        {error && <p role="alert" className="st-error">{error}</p>}
        <form className="st-composer" onSubmit={e => { e.preventDefault(); send(); }}>
          {smartStart ? <fieldset disabled={busy} className="st-radio"><legend>Votre diagnostic est-il réalisé?</legend>
            {["Oui, j'ai réalisé mon diagnostic.", "Non, je n'ai pas encore réalisé mon diagnostic."].map(label =>
              <label key={label}><input name="diagnostic" type="radio" checked={draft === label} onChange={() => setDraft(label)} />{label}</label>)}
          </fieldset> : <>
            <label htmlFor="tutor-text" className="st-sr">Votre message</label>
            <textarea id="tutor-text" placeholder="Écrivez à stépru…" rows={2} maxLength={16000} value={draft} disabled={busy}
              onChange={e => setDraft(e.target.value)} onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
              }} />
            {file && <div className="st-file"><i className="fas fa-file-pdf" aria-hidden="true" /><span>{file.name}</span>
              <button type="button" aria-label="Retirer le PDF" disabled={busy} onClick={() => { setFile(null); if (upload.current) upload.current.value = ''; }}>×</button>
            </div>}
          </>}
          <div className="st-composer-actions">
            {!smartStart && <label className="st-attach" title="Joindre un PDF de 8 Mo maximum">
              <i className="fas fa-paperclip" aria-hidden="true" /><span>Joindre un PDF</span>
              <input ref={upload} type="file" accept=".pdf,application/pdf" disabled={busy} className="st-sr" aria-label="Joindre un PDF (8 Mo maximum)"
                onChange={e => setFile(e.target.files?.[0] || null)} />
            </label>}
            <button className="st-send" aria-label={smartStart ? 'Continuer' : 'Envoyer'} title={smartStart ? 'Continuer' : 'Envoyer'}
              disabled={busy || (!draft.trim() && !file)}><i className="fas fa-arrow-up" aria-hidden="true" /></button>
          </div>
        </form>
        <p className="st-footnote">Vérifiez les informations et les sources avant de les utiliser dans votre travail.</p>
      </footer>
    </div>
  </section>;
}

const styles = `
.st-shell{--st-ink:#243b3a;--st-accent:#216b62;display:grid;grid-template-columns:210px minmax(0,1fr);height:min(880px,calc(100dvh - 110px));min-height:610px;position:relative;overflow:hidden;border:1px solid #dae1de;border-radius:24px;background:#fff;box-shadow:0 10px 40px #233b3610;text-align:left}
.st-shell button,.st-shell input,.st-shell textarea{font:inherit}
.st-shell button{cursor:pointer;transition:background .15s,color .15s}
.st-shell button:disabled{opacity:.45;cursor:default}
.st-shell button:focus-visible,.st-shell textarea:focus-visible,.st-attach:focus-within{outline:3px solid #74a99f;outline-offset:3px}
.st-sidebar{display:flex;flex-direction:column;padding:25px 12px 16px;background:#f1f4f1;border-right:1px solid #e1e6e1;min-width:0}
.st-brand{display:flex;align-items:center;gap:10px;padding:0 10px 24px;font-size:23px;font-weight:750;color:var(--st-ink);letter-spacing:-.7px}
.st-brand small{display:block;font-size:11px;font-weight:500;letter-spacing:.2px;color:#667b73}
.st-mark,.st-welcome-mark,.st-avatar{display:grid;place-items:center;background:var(--st-accent);color:#fff;font-family:Georgia,serif;font-style:italic}
.st-mark{width:34px;height:39px;border-radius:11px;font-size:27px}
.st-new{display:flex;align-items:center;gap:9px;border:1px solid #cdd9d1;border-radius:10px;background:#fff;padding:11px 10px;font-size:12px!important;font-weight:600!important;color:var(--st-ink)}
.st-new:hover{background:#e5ede7}
.st-nav-label{margin:28px 10px 9px;font-size:10px;color:#7b8882;font-weight:600}
.st-nav-item{display:flex;align-items:center;gap:10px;border:0;width:100%;padding:11px 10px;margin:2px 0;border-radius:9px;text-align:left;font-size:12px!important;color:#53645b;line-height:1.4}
.st-nav-item i{width:17px;text-align:center;font-size:13px}
.st-nav-item:hover{background:#e7eee7}.st-nav-active{background:#dfeae1!important;color:#184e45;font-weight:650!important}
.st-resources{margin-top:auto;padding:22px 9px 2px;color:#6c8076;font-size:11px;display:flex;align-items:center;gap:8px}
.st-resource-upload{display:block;cursor:pointer}.st-resource-upload input{max-width:150px;font-size:10px}
.st-workspace{min-height:0;min-width:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto}
.st-header{padding:20px 26px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #f0f2ee}
.st-header h1{font-weight:650;font-size:16px;letter-spacing:-.35px;color:var(--st-ink);margin:0;line-height:1.4}.st-header p{font-size:11px;color:#819087;margin:3px 0 0}
.st-preview{margin-left:auto;font-size:10px;white-space:nowrap;color:#607568;display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;background:#f1f5ef}
.st-transcript{overflow:auto;overscroll-behavior:contain;padding:22px clamp(18px,4%,42px);min-width:0;scroll-behavior:smooth}
.st-welcome{max-width:650px;margin:clamp(15px,7vh,80px) auto 30px}
.st-welcome-mark{height:52px;width:46px;border-radius:15px;font-size:37px;margin-bottom:25px}
.st-welcome h2{font-size:clamp(23px,2.4vw,34px);font-weight:600;line-height:1.2;letter-spacing:-1px;color:var(--st-ink);margin:0 0 12px}
.st-welcome>p{font-size:14px;color:#78857e;margin:0}
.st-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:30px}
.st-cards button{display:flex;flex-direction:column;gap:8px;align-items:flex-start;text-align:left;border:1px solid #e3e9e1;border-radius:13px;padding:16px;background:#fafbf8;color:#586b5f}
.st-cards button:hover{background:#eff4ec;border-color:#bfcfc0}
.st-cards i{color:var(--st-accent);font-size:16px}.st-cards strong{font-size:13px;font-weight:650;color:var(--st-ink)}.st-cards span{font-size:12px;line-height:1.5;color:#78857b}
.st-message{max-width:740px;margin:0 auto 30px;font-size:14px;line-height:1.8;overflow-wrap:anywhere}
.st-assistant{display:flex;align-items:flex-start;gap:13px}.st-avatar{flex:0 0 27px;height:29px;font-size:22px;border-radius:9px;margin-top:4px}
.st-answer{min-width:0;flex:1;color:#35443b}.st-answer>div+div{margin-top:15px}
.st-user{display:flex;justify-content:flex-end}.st-user>div{max-width:88%;padding:13px 18px;background:#eef2eb;border-radius:17px 17px 4px 17px;color:#32473a}.st-user p{margin:0;white-space:pre-wrap}
.st-document{display:flex;align-items:center;gap:8px;font-size:11px;color:#68816d;margin-top:8px}
.st-thinking{display:flex;align-items:center;gap:9px;font-size:12px;color:#6b8173;max-width:740px;margin:16px auto}
.st-pulse{height:8px;width:8px;border-radius:50%;background:#6c9981;animation:st-breathe 1.2s ease-in-out infinite}
.st-footer{padding:10px clamp(18px,4%,42px) 13px;background:#fff}
.st-composer{max-width:740px;margin:auto;border:1px solid #ced9cc;border-radius:20px;padding:13px 15px 10px;background:#fcfdfb;box-shadow:0 3px 14px #23432308}
.st-composer:focus-within{border-color:#7c9f86;box-shadow:0 0 0 3px #216b6209}
.st-composer textarea{width:100%;resize:none;max-height:180px;min-height:54px;border:0;outline:0!important;padding:2px 3px;background:transparent;color:#31443a;font-size:14px;line-height:1.65}
.st-composer textarea::placeholder{color:#8a978b}
.st-composer-actions{display:flex;align-items:center;justify-content:space-between;gap:10px}
.st-attach{cursor:pointer;display:flex;align-items:center;gap:8px;font-size:11px;color:#788778;padding:7px 4px;border-radius:5px}.st-attach:hover{color:#216b62}
.st-send{display:grid;place-items:center;background:var(--st-accent);color:#fff;border:0;border-radius:11px;width:34px;height:34px;margin-left:auto;flex-shrink:0}
.st-send:hover{background:#175449}.st-file{display:flex;align-items:center;gap:9px;border:1px solid #dde5d9;border-radius:9px;padding:6px 10px;font-size:11px;margin-bottom:9px;width:fit-content;max-width:100%;color:#506c57}.st-file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.st-file button{border:0;background:transparent;font-size:20px!important;padding:0 3px}
.st-footnote{text-align:center;margin:9px 0 0;font-size:10px;color:#899488;line-height:1.5}
.st-error{max-width:740px;margin:0 auto 10px;font-size:12px;color:#a73838}
.st-radio legend{font-size:13px;font-weight:600;color:#314b38;margin-bottom:10px}.st-radio label{display:flex;align-items:center;gap:9px;font-size:12px;padding:5px 0;color:#526a55}.st-radio input{accent-color:#216b62}
.st-menu,.st-backdrop{display:none}.st-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@keyframes st-breathe{50%{opacity:.3}}
@media(prefers-reduced-motion:reduce){.st-pulse{animation:none}.st-transcript{scroll-behavior:auto}}
@media(max-width:1100px){.st-shell{grid-template-columns:170px minmax(0,1fr)}.st-sidebar{padding-left:8px;padding-right:8px}.st-new{font-size:10px!important}.st-nav-item{font-size:11px!important}.st-header{padding:16px}.st-preview{font-size:9px;padding:4px 6px}}
@media(max-width:800px){.st-shell{display:block;min-height:600px;border-radius:18px;height:calc(100dvh - 110px)}.st-workspace{height:100%}.st-sidebar{display:none}.st-sidebar-open{display:flex;position:absolute;left:0;top:0;bottom:0;width:225px;z-index:3;box-shadow:6px 0 24px #213e3a18}.st-backdrop{display:block;position:absolute;inset:0;border:0;background:#23372f44;z-index:2}.st-menu{display:block;border:0;background:transparent;color:#547564;padding:6px}.st-header h1{font-size:14px}.st-preview{margin-left:auto;font-size:9px}.st-welcome{margin-top:20px}.st-welcome h2{font-size:27px}.st-transcript{padding:18px}.st-footer{padding:8px 14px 12px}.st-message{font-size:14px}.st-avatar{display:none}.st-cards{gap:8px;margin-top:22px}.st-cards button{padding:13px}.st-cards span{font-size:11px}}
@media(max-width:400px){.st-preview{max-width:65px;white-space:normal;line-height:1.3}.st-cards{grid-template-columns:1fr}.st-welcome-mark{display:none}.st-cards span{display:none}.st-cards button{gap:7px;flex-direction:row;align-items:center}.st-welcome h2{font-size:24px}}
`;
