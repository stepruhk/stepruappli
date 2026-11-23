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
    if (transcript.current) transcript.current.scrollTop = turns.length || pending ? transcript.current.scrollHeight : 0;
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
  function send(question = draft) {
    if (!question.trim() && !file) return;
    void run(async () => {
      const message: TutorMessage = { role: 'user', content: question.trim() || 'Voici mon document PDF.' };
      if (file) message.pdf = await attachPdf(file);
      setPending(message); setSidebarOpen(false);
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
    <div className="st-workspace">
      <header className="st-header">
        <span className="st-preview"><i className="fas fa-lock" aria-hidden="true" />Essai professeur</span>
        {selected && <span className="st-current">{selected.short}</span>}
        <div className="st-header-actions">
          <div className="st-activity-menu">
            <button className="st-menu-button" aria-expanded={sidebarOpen} aria-controls="st-activities" onClick={() => setSidebarOpen(!sidebarOpen)}>Activités <i className="fas fa-chevron-down" aria-hidden="true" /></button>
            {sidebarOpen && <nav className="st-menu-panel" id="st-activities" aria-label="Activités du tuteur">
              {activities.map(a => <button key={a.id} disabled={busy} aria-current={activity === a.id ? 'page' : undefined} onClick={() => start(a.id)}>
                <i className={'fas ' + a.icon} aria-hidden="true" />{a.title}
              </button>)}
            </nav>}
          </div>
          <button className="st-new" disabled={busy} onClick={reset}><i aria-hidden="true" className="fas fa-plus" /><span>Nouvelle conversation</span></button>
        </div>
      </header>
      <div ref={transcript} className="st-transcript" role="log" aria-label="Conversation">
        {!activity && !pending && <div className="st-welcome">
          <span className="st-robot" role="img" aria-label="Robot stépru">🤖</span>
          <h1>stépru, le prof de comm</h1>
          <p className="st-author">Par STÉPHANE PRUD’HOMME</p>
          <p className="st-description">Bonjour, je suis stépru, ton compagnon d'apprentissage de la comm strat et des RP. Je ne suis pas bon en rédaction (ce n'est pas pour cela que tu es ici 😉), mais j'excelle dans les Q/R, dans la recherche formative, dans l'explication de concepts et de théories. Demande-moi n'importe quoi! Je peux t'accompagner et te guider dans n'importe quelle tâche en communication et relations publiques.</p>
          <div className="st-starters">
            {activities.slice(0, 4).map(a => <button key={a.id} disabled={busy} onClick={() => start(a.id)}>{a.title}</button>)}
          </div>
        </div>}
        {activity && <div className="st-message st-assistant"><span className="st-avatar" aria-hidden="true">🤖</span>
          <div className="st-answer">{opening.map((b, i) => <React.Fragment key={i}><Reply block={b} ffom={false} /></React.Fragment>)}</div>
        </div>}
        {turns.map((t, i) => <React.Fragment key={i}>
          <div className="st-message st-user"><div><p>{t.message.content}</p>{t.message.pdf && <span className="st-document"><i className="fas fa-file-pdf" aria-hidden="true" />{t.message.pdf.name}</span>}</div></div>
          <div className="st-message st-assistant"><span className="st-avatar" aria-hidden="true">🤖</span>
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
              <i className="fas fa-plus" aria-hidden="true" /><span>Joindre un PDF</span>
              <input ref={upload} type="file" accept=".pdf,application/pdf" disabled={busy} className="st-sr" aria-label="Joindre un PDF (8 Mo maximum)"
                onChange={e => setFile(e.target.files?.[0] || null)} />
            </label>}
            <button className="st-send" aria-label={smartStart ? 'Continuer' : 'Envoyer'} title={smartStart ? 'Continuer' : 'Envoyer'}
              disabled={busy || (!draft.trim() && !file)}><i className="fas fa-arrow-up" aria-hidden="true" /></button>
          </div>
        </form>
        <div className="st-footnote">
          <span>Vérifiez les informations et les sources avant de les utiliser dans votre travail.</span>
          {resources && (resources.documents > 0 ? <span>{resources.documents} lectures de cours disponibles</span> : resourceUpload)}
        </div>
      </footer>
    </div>
  </section>;
}

const styles = `
.st-shell{--st-ink:#24272c;--st-accent:#40588e;height:min(920px,calc(100dvh - 100px));min-height:660px;position:relative;overflow:hidden;border:1px solid #e7e8ea;border-radius:24px;background:#fff;box-shadow:0 8px 32px #17244006;text-align:left}
.st-shell button,.st-shell input,.st-shell textarea{font:inherit}
.st-shell button{cursor:pointer;transition:background .15s,color .15s}
.st-shell button:disabled{opacity:.45;cursor:default}
.st-shell button:focus-visible,.st-shell textarea:focus-visible,.st-attach:focus-within{outline:3px solid #94a3c5;outline-offset:3px}
.st-workspace{height:100%;min-width:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto}
.st-header{min-height:54px;padding:13px 24px;display:flex;align-items:center;gap:12px;color:#777d87}
.st-preview{font-size:10px;white-space:nowrap;display:flex;align-items:center;gap:6px}
.st-current{font-size:12px;color:#555c68}
.st-header-actions{margin-left:auto;display:flex;align-items:center;gap:12px}
.st-new,.st-menu-button{display:flex;align-items:center;justify-content:center;gap:8px;padding:6px 9px;background:transparent;color:#616774;border:0;border-radius:8px;font-size:11px!important}
.st-new:hover,.st-menu-button:hover{background:#f2f3f5}
.st-menu-button i{font-size:9px}.st-new i{font-size:13px}
.st-activity-menu{position:relative}
.st-menu-panel{position:absolute;right:0;top:calc(100% + 8px);z-index:4;background:#fff;border:1px solid #e2e4e8;border-radius:14px;padding:6px;box-shadow:0 10px 30px #1d28451a;width:280px;max-width:calc(100vw - 60px)}
.st-menu-panel button{display:flex;align-items:center;gap:12px;width:100%;padding:12px;border:0;background:transparent;border-radius:9px;font-size:12px!important;color:#454b55;text-align:left}
.st-menu-panel button:hover,.st-menu-panel button[aria-current=page]{background:#f0f2f6}.st-menu-panel i{width:17px;text-align:center;color:#707a8d}
.st-transcript{overflow:auto;overscroll-behavior:contain;padding:8px 26px 24px;min-width:0;scroll-behavior:smooth}
.st-welcome{max-width:820px;margin:7px auto 20px;text-align:center;color:var(--st-ink)}
.st-robot{display:grid;place-items:center;font-size:40px;line-height:1;width:62px;height:62px;margin:0 auto 15px;border-radius:50%;background:#f0f3f8;border:1px solid #e4e8ef}
.st-welcome h1{font-size:clamp(24px,2.5vw,30px);font-weight:500;line-height:1.25;letter-spacing:-.7px;margin:0}
.st-author{font-size:12px;color:#7d828c;margin:13px 0 21px}
.st-description{font-size:16px;line-height:1.65;color:#686d76;max-width:530px;margin:0 auto 26px}
.st-starters{display:flex;flex-direction:column;align-items:center;gap:9px}
.st-starters button{width:fit-content;max-width:100%;background:#f2f3f5;border:1px solid transparent;color:#4e5560;padding:8px 17px;line-height:1.4;border-radius:24px;font-size:13px!important;text-align:center}
.st-starters button:hover{background:#e9ecf2;border-color:#dce1eb}
.st-message{max-width:760px;margin:0 auto 30px;font-size:14px;line-height:1.8;overflow-wrap:anywhere}
.st-assistant{display:flex;align-items:flex-start;gap:13px}
.st-avatar{flex:0 0 29px;display:grid;place-items:center;height:31px;font-size:22px;border-radius:50%;background:#f1f3f7;margin-top:3px}
.st-answer{min-width:0;flex:1;color:#343a43}.st-answer>div+div{margin-top:15px}
.st-user{display:flex;justify-content:flex-end}.st-user>div{max-width:88%;padding:13px 18px;background:#f0f2f6;border-radius:20px 20px 5px 20px;color:#3b414c}.st-user p{margin:0;white-space:pre-wrap}
.st-document{display:flex;align-items:center;gap:8px;font-size:11px;color:#737e90;margin-top:8px}
.st-thinking{display:flex;align-items:center;gap:9px;font-size:12px;color:#798194;max-width:760px;margin:16px auto}
.st-pulse{height:8px;width:8px;border-radius:50%;background:#7b8eac;animation:st-breathe 1.2s ease-in-out infinite}
.st-footer{padding:8px 26px 14px;background:#fff}
.st-composer{max-width:860px;margin:auto;border:1px solid #e1e3e8;border-radius:26px;padding:17px 18px 12px;background:#f7f8fa}
.st-composer:focus-within{border-color:#a2adc3;box-shadow:0 0 0 3px #40588e07}
.st-composer textarea{width:100%;resize:none;max-height:180px;min-height:65px;border:0;outline:0!important;padding:0 2px;background:transparent;color:#3a414e;font-size:15px;line-height:1.65}
.st-composer textarea::placeholder{color:#969ba5}
.st-composer-actions{display:flex;align-items:center;justify-content:space-between;gap:10px}
.st-attach{cursor:pointer;display:flex;align-items:center;gap:10px;font-size:11px;color:#7e8593;padding:7px 4px;border-radius:5px}.st-attach i{font-size:18px;font-weight:400}.st-attach:hover{color:#40588e}
.st-send{display:grid;place-items:center;background:var(--st-accent);color:#fff;border:0;border-radius:50%;width:36px;height:36px;margin-left:auto;flex-shrink:0}
.st-send:hover{background:#2e467c}
.st-file{display:flex;align-items:center;gap:9px;border:1px solid #dce1eb;border-radius:10px;padding:6px 10px;font-size:11px;margin-bottom:9px;width:fit-content;max-width:100%;color:#68768d}.st-file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.st-file button{border:0;background:transparent;font-size:20px!important;padding:0 3px}
.st-footnote{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 12px;margin:9px auto 0;font-size:9px;color:#9b9fa8;line-height:1.5;text-align:center}
.st-resource-upload input{max-width:180px;font-size:10px}
.st-error{max-width:860px;margin:0 auto 10px;font-size:12px;color:#a73838}
.st-radio legend{font-size:13px;font-weight:600;color:#3f4d68;margin-bottom:10px}.st-radio label{display:flex;align-items:center;gap:9px;font-size:12px;padding:5px 0;color:#5b6475}.st-radio input{accent-color:#40588e}
.st-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@keyframes st-breathe{50%{opacity:.3}}
@media(prefers-reduced-motion:reduce){.st-pulse{animation:none}.st-transcript{scroll-behavior:auto}}
@media(max-height:800px){.st-shell{min-height:610px}.st-header{min-height:44px;padding-top:8px;padding-bottom:8px}.st-robot{height:46px;width:46px;font-size:31px;margin-bottom:10px}.st-welcome{margin-top:0}.st-welcome h1{font-size:25px}.st-author{margin:8px 0 15px;font-size:11px}.st-description{font-size:14px;line-height:1.55;margin-bottom:19px;max-width:500px}.st-starters{gap:7px}.st-starters button{font-size:12px!important;padding:6px 15px}.st-composer textarea{min-height:48px}.st-footer{padding-top:7px;padding-bottom:10px}}
@media(max-width:650px){.st-shell{border-radius:18px;min-height:670px;height:calc(100dvh - 100px)}.st-header{padding:12px 13px}.st-new span{display:none}.st-new{padding:8px}.st-header-actions{gap:2px}.st-preview{font-size:9px}.st-current{display:none}.st-transcript{padding:12px 16px 20px}.st-welcome{margin-top:5px}.st-robot{margin-bottom:13px}.st-welcome h1{font-size:24px}.st-description{font-size:14px;line-height:1.6}.st-author{font-size:10px;margin:11px 0 20px}.st-starters button{font-size:12px!important;padding:8px 13px}.st-footer{padding:8px 13px 12px}.st-composer{border-radius:22px;padding:14px}.st-footnote{font-size:9px}.st-message{font-size:14px}.st-avatar{display:none}}
`;
