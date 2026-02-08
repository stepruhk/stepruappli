
import React, { useEffect, useState } from 'react';
import { Topic, AppView, StudySession } from './types.ts';
import { INITIAL_TOPICS } from './constants.ts';
import {
  checkAuthStatus,
  createCourseContent,
  createEvernoteNote,
  generateFlashcards,
  listCourseContent,
  listEvernoteNotes,
  loginWithPassword,
  logout,
  removeCourseContent,
  removeEvernoteNote,
  summarizeContent,
  type EvernoteNote,
  type LearningContentItem,
  type UserRole,
} from './services/openaiService.ts';
import FlashcardDeck from './components/FlashcardDeck.tsx';

type MenuSection = 'ACCUEIL' | 'CONTENU' | 'NOTES' | 'MEMO' | 'BALADO' | 'BLOG' | 'ASSISTANT' | 'CONTACT';
type PodcastEpisode = {
  title: string;
  link?: string;
  pubDate?: string;
  description?: string;
  audioUrl?: string;
};

const App: React.FC = () => {
  const visibleTopics = INITIAL_TOPICS.filter((topic) => topic.id !== '4');
  const [view, setView] = useState<AppView>(AppView.DASHBOARD);
  const [menuSection, setMenuSection] = useState<MenuSection>('ACCUEIL');
  const [resourceCourseId, setResourceCourseId] = useState<string>(visibleTopics[0]?.id || '');
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [sessionData, setSessionData] = useState<Record<string, StudySession>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('student');
  const [loginRole, setLoginRole] = useState<UserRole>('student');
  const [authChecked, setAuthChecked] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteLink, setNoteLink] = useState('');
  const [evernoteNotes, setEvernoteNotes] = useState<EvernoteNote[]>([]);
  const [contentTitle, setContentTitle] = useState('');
  const [contentUrl, setContentUrl] = useState('');
  const [pdfTitle, setPdfTitle] = useState('');
  const [contentItems, setContentItems] = useState<LearningContentItem[]>([]);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const landingImageCandidates = [
    'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1800&q=80',
    'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1800&q=80',
    'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?auto=format&fit=crop&w=1800&q=80',
  ];
  const [landingImageIndex, setLandingImageIndex] = useState(0);
  const landingImageUrl = landingImageCandidates[Math.min(landingImageIndex, landingImageCandidates.length - 1)];
  const spotifyShowUrl = 'https://open.spotify.com/show/4C0DeBIvVZjRbM6MUOylOT?si=VZGKDnooR52E7qbZZ2aweA';
  const blogUrl = 'https://stepru.wordpress.com';
  const assistantUrl = 'https://chatgpt.com/g/g-ZltU00p7B-stepru-the-comms-professor';
  const contactUrl = 'https://credibilityinstitute.com/contact';
  const [podcastEpisodes, setPodcastEpisodes] = useState<PodcastEpisode[]>([]);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [podcastError, setPodcastError] = useState<string | null>(null);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const auth = await checkAuthStatus();
        setIsAuthenticated(auth.authenticated);
        setUserRole(auth.role);
      } catch (_error) {
        setIsAuthenticated(false);
        setUserRole('student');
      } finally {
        setAuthChecked(true);
      }
    };

    void initAuth();
  }, []);

  useEffect(() => {
    if (!visibleTopics.some((topic) => topic.id === resourceCourseId)) {
      setResourceCourseId(visibleTopics[0]?.id || '');
    }
  }, [resourceCourseId, visibleTopics]);

  useEffect(() => {
    const loadCourseResources = async () => {
      if (!authChecked || !isAuthenticated || !resourceCourseId) return;
      try {
        const [notes, resources] = await Promise.all([
          listEvernoteNotes(resourceCourseId),
          listCourseContent(resourceCourseId),
        ]);
        setEvernoteNotes(notes);
        setContentItems(resources);
      } catch (error) {
        console.error(error);
      }
    };

    void loadCourseResources();
  }, [authChecked, isAuthenticated, resourceCourseId]);

  useEffect(() => {
    const loadPodcastEpisodes = async () => {
      if (!authChecked || !isAuthenticated) return;
      if (menuSection !== 'BALADO') return;

      setPodcastLoading(true);
      setPodcastError(null);
      try {
        const token = localStorage.getItem('eduboost_auth_token');
        const response = await fetch('/api/podcast-episodes', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const data = await response.json();
        if (!response.ok) {
          const details = data?.error?.details ? ` (${JSON.stringify(data.error.details)})` : '';
          throw new Error((data?.error?.message || 'Impossible de charger les épisodes.') + details);
        }
        setPodcastEpisodes(Array.isArray(data?.episodes) ? data.episodes : []);
      } catch (error) {
        console.error(error);
        setPodcastError(error instanceof Error ? error.message : 'Impossible de charger la liste des épisodes.');
      } finally {
        setPodcastLoading(false);
      }
    };

    void loadPodcastEpisodes();
  }, [authChecked, isAuthenticated, menuSection]);

  const handleAuthError = (error: unknown) => {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNAUTHORIZED') || message.includes('INVALID_CREDENTIALS')) {
      setIsAuthenticated(false);
      setAuthError('Session expirée ou mot de passe incorrect.');
      return;
    }
    if (message.includes('FORBIDDEN') || message.includes('Action réservée au professeur')) {
      setAuthError('Connexion professeur requise pour publier du contenu.');
    }
  };

  const getErrorMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('FORBIDDEN') || message.includes('Action réservée au professeur')) {
      return 'Connexion professeur requise pour publier du contenu.';
    }
    if (
      message.includes('PAYLOAD_TOO_LARGE') ||
      message.includes('INPUT_TOO_LARGE') ||
      message.includes('too large') ||
      message.includes('trop volumineux')
    ) {
      return 'Le document est trop volumineux. Essaie un PDF plus léger.';
    }
    if (message.includes('UNAUTHORIZED') || message.includes('INVALID_CREDENTIALS')) {
      return 'Session expirée. Reconnecte-toi puis réessaie.';
    }
    return message || 'Erreur inconnue.';
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError(null);

    try {
      const role = await loginWithPassword(password, loginRole);
      setIsAuthenticated(true);
      setUserRole(role);
      setPassword('');
    } catch (error) {
      console.error(error);
      setAuthError('Mot de passe incorrect. Réessayez.');
    }
  };

  const startTopic = async (topic: Topic) => {
    setMenuSection('ACCUEIL');
    setResourceCourseId(topic.id);
    setSelectedTopic(topic);
    setView(AppView.TOPIC_DETAIL);

    if (sessionData[topic.id]) return;

    setLoading("Préparation de votre matériel d'étude...");
    try {
      const [summary, flashcards] = await Promise.all([
        summarizeContent(topic.content),
        generateFlashcards(topic.content),
      ]);
      
      setSessionData(prev => ({
        ...prev,
        [topic.id]: { topicId: topic.id, summary, flashcards }
      }));
    } catch (error) {
      handleAuthError(error);
    } finally {
      setLoading(null);
    }
  };

  const currentSession = selectedTopic ? sessionData[selectedTopic.id] : null;
  const resourceCourse = visibleTopics.find((topic) => topic.id === resourceCourseId) || null;
  const filteredEvernoteNotes = evernoteNotes.filter((note) => note.courseId === resourceCourseId);
  const filteredContentItems = contentItems.filter((item) => item.courseId === resourceCourseId);
  const flashcardsForModal = menuSection === 'MEMO'
    ? (sessionData[resourceCourseId]?.flashcards || [])
    : (currentSession?.flashcards || []);
  const cardAccentStyles = [
    {
      icon: 'bg-indigo-600 text-white',
      bubble: 'bg-indigo-50',
    },
    {
      icon: 'bg-emerald-600 text-white',
      bubble: 'bg-emerald-50',
    },
    {
      icon: 'bg-pink-600 text-white',
      bubble: 'bg-pink-50',
    },
    {
      icon: 'bg-amber-600 text-white',
      bubble: 'bg-amber-50',
    },
  ];
  const mainMenuItems = [
    { label: 'Accueil', icon: 'fa-border-all', key: 'ACCUEIL' as const },
    { label: 'Contenu', icon: 'fa-file-lines', key: 'CONTENU' as const },
    { label: 'Notes Evernote', icon: 'fa-note-sticky', key: 'NOTES' as const },
    { label: 'Cartes mémo', icon: 'fa-bolt', key: 'MEMO' as const },
    { label: 'Balado', icon: 'fa-podcast', key: 'BALADO' as const },
    { label: 'Blog', icon: 'fa-newspaper', key: 'BLOG' as const },
    { label: 'Assistant IA', icon: 'fa-robot', key: 'ASSISTANT' as const },
    { label: 'Contact', icon: 'fa-envelope', key: 'CONTACT' as const },
  ];
  const canEditResources = userRole === 'professor';

  const addEvernoteNote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resourceCourseId) return;
    const title = noteTitle.trim();
    const content = noteContent.trim();
    const rawLink = noteLink.trim();
    const link = rawLink
      ? rawLink.startsWith('http://') || rawLink.startsWith('https://')
        ? rawLink
        : `https://${rawLink}`
      : '';
    if (!title || (!content && !link)) return;

    try {
      const newNote = await createEvernoteNote({
        courseId: resourceCourseId,
        title,
        content,
        link: link || undefined,
      });
      setEvernoteNotes((prev) => [newNote, ...prev]);
      setNoteTitle('');
      setNoteContent('');
      setNoteLink('');
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible d'ajouter la note. ${getErrorMessage(error)}`);
    }
  };

  const deleteEvernoteNote = async (id: string) => {
    try {
      await removeEvernoteNote(id);
      setEvernoteNotes((prev) => prev.filter((note) => note.id !== id));
    } catch (error) {
      console.error(error);
      alert("Impossible de supprimer la note.");
    }
  };

  const addContentLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resourceCourseId) return;
    const title = contentTitle.trim();
    const rawUrl = contentUrl.trim();
    if (!title || !rawUrl) return;
    const normalizedUrl = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
      ? rawUrl
      : `https://${rawUrl}`;

    try {
      const item = await createCourseContent({
        courseId: resourceCourseId,
        type: 'LIEN',
        title,
        url: normalizedUrl,
      });
      setContentItems((prev) => [item, ...prev]);
      setContentTitle('');
      setContentUrl('');
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible d'ajouter le lien. ${getErrorMessage(error)}`);
    }
  };

  const fileToDataUrl = async (file: File) => {
    // Primary path: FileReader data URL.
    try {
      const result = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
        reader.readAsDataURL(file);
      });
      if (result) return result;
    } catch (_error) {
      // Continue with a fallback for browsers that fail on readAsDataURL.
    }

    // Fallback path: arrayBuffer -> base64 data URL.
    try {
      const buffer = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const mime = file.type || 'application/pdf';
      return `data:${mime};base64,${btoa(binary)}`;
    } catch (_error) {
      throw new Error('Lecture du fichier impossible.');
    }
  };

  const addPdfContent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resourceCourseId) return;
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem('pdf-file') as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    const title = pdfTitle.trim();
    if (!file || !title) return;

    setUploadingPdf(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const item = await createCourseContent({
        courseId: resourceCourseId,
        type: 'PDF',
        title,
        url: dataUrl,
      });
      setContentItems((prev) => [item, ...prev]);
      setPdfTitle('');
      if (fileInput) fileInput.value = '';
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible d'ajouter le PDF. ${getErrorMessage(error)}`);
    } finally {
      setUploadingPdf(false);
    }
  };

  const deleteContentItem = async (id: string) => {
    try {
      await removeCourseContent(id);
      setContentItems((prev) => prev.filter((item) => item.id !== id));
    } catch (error) {
      console.error(error);
      alert("Impossible de supprimer ce contenu.");
    }
  };

  const openContentItem = async (item: LearningContentItem) => {
    if (item.type === 'LIEN') {
      window.open(item.url, '_blank', 'noopener,noreferrer');
      return;
    }

    try {
      const response = await fetch(item.url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      console.error(error);
      alert("Impossible d'ouvrir ce PDF pour le moment.");
    }
  };

  const ensureCourseSession = async (courseId: string) => {
    const topic = visibleTopics.find((item) => item.id === courseId);
    if (!topic) return;
    if (sessionData[courseId]?.flashcards?.length) return;

    setLoading("Préparation de vos cartes mémo...");
    try {
      const [summary, flashcards] = await Promise.all([
        summarizeContent(topic.content),
        generateFlashcards(topic.content),
      ]);
      setSessionData((prev) => ({
        ...prev,
        [courseId]: { topicId: courseId, summary, flashcards },
      }));
    } catch (error) {
      handleAuthError(error);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <main className="max-w-[1500px] mx-auto px-6 py-8 md:py-12">
        {!authChecked && (
          <div className="min-h-[60vh] flex items-center justify-center">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}

        {authChecked && !isAuthenticated && (
          <div className="relative min-h-[82vh] overflow-hidden rounded-[32px]">
            <img
              src={landingImageUrl}
              alt=""
              onError={() => {
                setLandingImageIndex((current) =>
                  Math.min(current + 1, landingImageCandidates.length - 1),
                );
              }}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-slate-950/55"></div>

            <div className="relative z-10 min-h-[82vh] grid lg:grid-cols-[1.2fr_420px] items-center gap-8 p-6 md:p-10">
              <div className="text-white max-w-2xl">
                <p className="inline-flex items-center rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em]">
                  EduBoost
                </p>
                <h1 className="mt-5 text-4xl md:text-6xl font-black leading-tight">
                  L’espace d’apprentissage des étudiant(e)s en communication
                </h1>
                <p className="mt-5 text-lg md:text-2xl text-slate-100/90">
                  Cours, contenu, notes, balado et assistant IA dans une seule plateforme.
                </p>
              </div>

              <div className="w-full bg-white/95 backdrop-blur rounded-3xl shadow-2xl p-8 border border-white/70">
                <h2 className="text-3xl font-black text-slate-900 mb-2">Accès protégé</h2>
                <p className="text-slate-600 mb-6">Entrez le mot de passe pour accéder à l'application.</p>

                <form onSubmit={handleLogin} className="space-y-4">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Mot de passe</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Votre mot de passe"
                      required
                    />
                  </label>

                  {authError && (
                    <p className="text-sm text-red-600 font-medium">{authError}</p>
                  )}

                  <button
                    type="submit"
                    className="w-full py-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition-colors"
                  >
                    Se connecter ({loginRole === 'professor' ? 'Professeur' : 'Étudiant'})
                  </button>
                </form>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setLoginRole('student')}
                    className={`rounded-xl px-3 py-2 text-sm font-semibold border ${loginRole === 'student' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300'}`}
                  >
                    Étudiant
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoginRole('professor')}
                    className={`rounded-xl px-3 py-2 text-sm font-semibold border ${loginRole === 'professor' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300'}`}
                  >
                    Professeur
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {authChecked && isAuthenticated && (
          <>
            {loading && (
              <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/90 backdrop-blur-md">
                <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-lg font-medium text-slate-700 animate-pulse">{loading}</p>
              </div>
            )}

            <div className="lg:flex lg:items-start lg:gap-8">
              <aside className="hidden lg:block lg:w-64 xl:w-72 shrink-0">
                <div
                  className="sticky top-6 h-[calc(100vh-3rem)] rounded-[28px] border border-slate-800/70 p-4 text-slate-300 shadow-2xl shadow-slate-950/80 flex flex-col"
                  style={{
                    backgroundColor: '#020617',
                    backgroundImage:
                      'radial-gradient(circle at 85% 0%, rgba(59,130,246,0.20) 0%, rgba(2,6,23,0) 34%), radial-gradient(circle at 0% 100%, rgba(56,189,248,0.10) 0%, rgba(2,6,23,0) 48%)',
                  }}
                >
                  <p className="text-xs tracking-[0.24em] font-extrabold uppercase text-slate-500 mb-4">Menu principal</p>

                  <nav className="space-y-2">
                    {mainMenuItems.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => {
                          if (item.key === 'ACCUEIL') {
                            setMenuSection('ACCUEIL');
                            setView(AppView.DASHBOARD);
                            return;
                          }
                          if (item.key === 'NOTES') {
                            setMenuSection('NOTES');
                            return;
                          }
                          if (item.key === 'CONTENU') {
                            setMenuSection('CONTENU');
                            return;
                          }
                          if (item.key === 'BALADO') {
                            setMenuSection('BALADO');
                            return;
                          }
                          if (item.key === 'BLOG') {
                            setMenuSection('BLOG');
                            return;
                          }
                          if (item.key === 'MEMO') {
                            setMenuSection('MEMO');
                            return;
                          }
                          if (item.key === 'ASSISTANT') {
                            setMenuSection('ASSISTANT');
                            return;
                          }
                          if (item.key === 'CONTACT') {
                            setMenuSection('CONTACT');
                            return;
                          }
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-4 rounded-2xl text-left font-extrabold text-xl transition-colors ${
                          item.key && menuSection === item.key
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/70'
                        }`}
                      >
                        <i className={`fas ${item.icon} text-lg`}></i>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </nav>

                  <div className="mt-auto pt-6">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuSection('ACCUEIL');
                        setView(AppView.DASHBOARD);
                        setSelectedTopic(null);
                      }}
                      className="w-full flex items-center justify-center gap-2 rounded-2xl bg-slate-900/90 border border-slate-800 px-4 py-4 text-xl font-extrabold text-slate-100 hover:bg-slate-800 transition-colors"
                    >
                      <i className="fas fa-right-left text-base"></i>
                      Changer de cours
                    </button>
                  </div>
                </div>
              </aside>

              <section className="flex-1">
                {menuSection === 'ACCUEIL' && view === AppView.DASHBOARD && (
                  <div>
                    <div className="mb-12 text-center">
                      <h1 className="text-4xl md:text-6xl font-black text-slate-900 mb-4 leading-tight">
                        Bienvenue dans votre appli d'étudiant(e)s en communication
                      </h1>
                      <p className="text-xl md:text-2xl text-slate-600 font-medium">
                        Veuillez sélectionner un cours pour accéder à vos ressources personnalisées.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          logout();
                          setIsAuthenticated(false);
                          setUserRole('student');
                          setLoginRole('student');
                          setView(AppView.DASHBOARD);
                          setSelectedTopic(null);
                        }}
                        className="mt-6 inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                      >
                        Déconnexion
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {visibleTopics.map((topic, index) => {
                        const style = cardAccentStyles[index % cardAccentStyles.length];
                        return (
                        <div 
                          key={topic.id}
                          onClick={() => startTopic(topic)}
                          className="relative bg-white rounded-3xl p-8 md:p-10 cursor-pointer border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all group overflow-hidden"
                        >
                          <div className={`absolute -top-8 -right-8 w-36 h-36 rounded-full ${style.bubble}`}></div>
                          <div className={`relative w-16 h-16 rounded-2xl ${style.icon} flex items-center justify-center mb-8`}>
                            <i className={`fas ${topic.icon} text-2xl`}></i>
                          </div>
                          <h3 className="relative text-2xl md:text-3xl font-black text-slate-900 mb-3 leading-tight">{topic.title}</h3>
                          <p className="relative text-xl md:text-2xl text-slate-600 leading-relaxed">{topic.description}</p>
                          
                          <div className="relative mt-8 flex items-center text-indigo-600 font-extrabold text-xl md:text-2xl">
                            <span>Accéder au cours</span>
                            <i className="fas fa-arrow-right ml-2 group-hover:translate-x-1 transition-transform"></i>
                          </div>
                        </div>
                        );
                      })}
                      <div
                        onClick={() => setMenuSection('BALADO')}
                        className="relative bg-white rounded-3xl p-8 md:p-10 cursor-pointer border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all group overflow-hidden"
                      >
                        <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-emerald-50"></div>
                        <div className="relative w-16 h-16 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mb-8">
                          <i className="fas fa-podcast text-2xl"></i>
                        </div>
                        <h3 className="relative text-2xl md:text-3xl font-black text-slate-900 mb-3 leading-tight">Balado</h3>
                        <p className="relative text-xl md:text-2xl text-slate-600 leading-relaxed">
                          Ouvre le balado Spotify depuis l'accueil des cours.
                        </p>
                        <div className="relative mt-8 flex items-center text-emerald-600 font-extrabold text-xl md:text-2xl">
                          <span>Accéder</span>
                          <i className="fas fa-arrow-right ml-2 group-hover:translate-x-1 transition-transform"></i>
                        </div>
                      </div>

                      <div
                        onClick={() => setMenuSection('ASSISTANT')}
                        className="relative bg-white rounded-3xl p-8 md:p-10 cursor-pointer border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all group overflow-hidden"
                      >
                        <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-indigo-50"></div>
                        <div className="relative w-16 h-16 rounded-2xl bg-indigo-600 text-white flex items-center justify-center mb-8">
                          <i className="fas fa-robot text-2xl"></i>
                        </div>
                        <h3 className="relative text-2xl md:text-3xl font-black text-slate-900 mb-3 leading-tight">Assistant IA</h3>
                        <p className="relative text-xl md:text-2xl text-slate-600 leading-relaxed">
                          Lance l'assistant pédagogique depuis l'accueil des cours.
                        </p>
                        <div className="relative mt-8 flex items-center text-indigo-600 font-extrabold text-xl md:text-2xl">
                          <span>Accéder</span>
                          <i className="fas fa-arrow-right ml-2 group-hover:translate-x-1 transition-transform"></i>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {menuSection === 'ACCUEIL' && view === AppView.TOPIC_DETAIL && selectedTopic && (
                  <div className="animate-in fade-in duration-500">
                    <button 
                      onClick={() => setView(AppView.DASHBOARD)}
                      className="flex items-center text-slate-500 hover:text-indigo-600 mb-6 font-medium transition-colors"
                    >
                      <i className="fas fa-arrow-left mr-2"></i>
                      Retour aux cours
                    </button>

                    <div className="flex flex-col lg:flex-row gap-8">
                      <div className="flex-1">
                        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm mb-8">
                          <div className="flex items-center space-x-3 mb-4">
                            <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold uppercase tracking-wider">
                              {selectedTopic.category}
                            </span>
                          </div>
                          <h1 className="text-4xl font-black text-slate-900 mb-6 leading-tight">{selectedTopic.title}</h1>
                          
                          {currentSession?.summary ? (
                            <div className="prose prose-slate max-w-none mb-10">
                              <h2 className="text-xl font-bold text-slate-800 mb-4 border-l-4 border-indigo-600 pl-4">Résumé IA</h2>
                              <div className="text-slate-600 leading-relaxed space-y-4" dangerouslySetInnerHTML={{ __html: currentSession.summary.replace(/\n/g, '<br/>') }} />
                            </div>
                          ) : (
                            <div className="h-64 flex items-center justify-center bg-slate-50 rounded-xl animate-pulse text-slate-400">
                              Chargement du résumé...
                            </div>
                          )}

                          <hr className="border-slate-100 my-10" />

                          <div className="prose prose-slate max-w-none">
                            <h2 className="text-xl font-bold text-slate-800 mb-4">Contenu Complet</h2>
                            <p className="text-slate-500 italic leading-relaxed whitespace-pre-line">{selectedTopic.content}</p>
                          </div>
                        </div>
                      </div>

                      <div className="w-full lg:w-80 space-y-6">
                        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center">
                            <i className="fas fa-bolt text-yellow-500 mr-2"></i>
                            Auto-Évaluation
                          </h3>
                          <p className="text-sm text-slate-500 mb-6">Testez vos connaissances avec des flashcards générées à partir du cours.</p>
                          <button 
                            disabled={!currentSession?.flashcards?.length}
                            onClick={() => setShowFlashcards(true)}
                            className="w-full py-3 border-2 border-indigo-600 text-indigo-600 rounded-xl font-bold hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Réviser ({currentSession?.flashcards?.length || 0} cartes)
                          </button>
                        </div>

                        <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl shadow-indigo-200/20">
                          <h3 className="font-bold mb-4">Votre Progression</h3>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-slate-400">Lecture terminée</span>
                            <span className="text-xs font-bold text-indigo-400">100%</span>
                          </div>
                          <div className="h-2 w-full bg-slate-800 rounded-full mb-6">
                            <div className="h-full w-full bg-indigo-500 rounded-full"></div>
                          </div>
                          <div className="p-4 bg-white/5 rounded-xl border border-white/10 text-xs leading-relaxed text-slate-300 italic">
                            "La répétition espacée via les flashcards augmente la rétention de 60%."
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {menuSection === 'NOTES' && (
                  <div className="space-y-8">
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Notes Evernote</h1>
                      <p className="text-slate-600 text-lg">
                        {canEditResources
                          ? 'Ajoute tes notes de cours et retrouve-les ici.'
                          : 'Notes ajoutées par le professeur.'}
                      </p>
                      {!canEditResources && (
                        <p className="mt-3 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                          Mode étudiant: consultation seulement. Seul le professeur peut ajouter ou supprimer des notes.
                        </p>
                      )}
                      <div className="mt-5 max-w-md">
                        <label className="block">
                          <span className="text-sm font-semibold text-slate-700">Cours lié</span>
                          <select
                            value={resourceCourseId}
                            onChange={(event) => setResourceCourseId(event.target.value)}
                            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            {visibleTopics.map((topic) => (
                              <option key={topic.id} value={topic.id}>{topic.title}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>

                    {canEditResources && (
                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-6">Ajouter une note</h2>
                        <form onSubmit={addEvernoteNote} className="space-y-4">
                        <label className="block">
                          <span className="text-sm font-semibold text-slate-700">Titre</span>
                          <input
                            type="text"
                            value={noteTitle}
                            onChange={(event) => setNoteTitle(event.target.value)}
                            placeholder="Ex: Plan de relations médias"
                            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            required
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm font-semibold text-slate-700">Contenu</span>
                          <textarea
                            value={noteContent}
                            onChange={(event) => setNoteContent(event.target.value)}
                            placeholder="Optionnel si tu mets un lien Evernote"
                            className="mt-2 w-full min-h-36 rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm font-semibold text-slate-700">Lien Evernote</span>
                          <input
                            type="url"
                            value={noteLink}
                            onChange={(event) => setNoteLink(event.target.value)}
                            placeholder="https://www.evernote.com/..."
                            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </label>
                        <p className="text-xs text-slate-500">Ajoute du contenu, un lien Evernote, ou les deux.</p>

                          <button
                            type="submit"
                            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors"
                          >
                            <i className="fas fa-plus"></i>
                            Ajouter la note
                          </button>
                        </form>
                      </div>
                    )}

                    <div className="space-y-4">
                      <h2 className="text-2xl font-black text-slate-900">
                        Mes notes - {resourceCourse?.title || 'Cours'} ({filteredEvernoteNotes.length})
                      </h2>
                      {filteredEvernoteNotes.length === 0 && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-500">
                          Aucune note pour ce cours pour le moment.
                        </div>
                      )}
                      {filteredEvernoteNotes.map((note) => (
                        <article key={note.id} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h3 className="text-xl font-black text-slate-900">{note.title}</h3>
                          <p className="text-sm text-slate-400 mt-1">
                            {new Date(note.createdAt).toLocaleString('fr-FR')}
                          </p>
                          {note.link && (
                            <a
                              href={note.link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 mt-3 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                            >
                              <i className="fas fa-up-right-from-square"></i>
                              Ouvrir le lien Evernote
                            </a>
                          )}
                        </div>
                            {canEditResources && (
                              <button
                                type="button"
                                onClick={() => deleteEvernoteNote(note.id)}
                                className="text-sm font-semibold text-rose-600 hover:text-rose-700"
                              >
                                Supprimer
                              </button>
                            )}
                          </div>
                          {note.content && (
                            <p className="text-slate-700 mt-4 whitespace-pre-line">{note.content}</p>
                          )}
                        </article>
                      ))}
                    </div>
                  </div>
                )}

                {menuSection === 'CONTENU' && (
                  <div className="space-y-8">
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Contenu</h1>
                      <p className="text-slate-600 text-lg">
                        {canEditResources
                          ? 'Ajoute des documents PDF et des hyperliens utiles pour tes cours.'
                          : 'Documents ajoutés par le professeur.'}
                      </p>
                      {!canEditResources && (
                        <p className="mt-3 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                          Mode étudiant: consultation seulement. Seul le professeur peut ajouter ou supprimer du contenu.
                        </p>
                      )}
                      <div className="mt-5 max-w-md">
                        <label className="block">
                          <span className="text-sm font-semibold text-slate-700">Cours lié</span>
                          <select
                            value={resourceCourseId}
                            onChange={(event) => setResourceCourseId(event.target.value)}
                            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            {visibleTopics.map((topic) => (
                              <option key={topic.id} value={topic.id}>{topic.title}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>

                    {canEditResources && (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-6">Ajouter un hyperlien</h2>
                        <form onSubmit={addContentLink} className="space-y-4">
                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Titre</span>
                            <input
                              type="text"
                              value={contentTitle}
                              onChange={(event) => setContentTitle(event.target.value)}
                              placeholder="Ex: Guide de communication"
                              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              required
                            />
                          </label>
                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">URL</span>
                            <input
                              type="url"
                              value={contentUrl}
                              onChange={(event) => setContentUrl(event.target.value)}
                              placeholder="https://..."
                              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              required
                            />
                          </label>
                          <button
                            type="submit"
                            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors"
                          >
                            <i className="fas fa-link"></i>
                            Ajouter le lien
                          </button>
                        </form>
                      </div>

                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-6">Ajouter un PDF</h2>
                        <form onSubmit={addPdfContent} className="space-y-4">
                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Titre</span>
                            <input
                              type="text"
                              value={pdfTitle}
                              onChange={(event) => setPdfTitle(event.target.value)}
                              placeholder="Ex: Plan de cours Semaine 1"
                              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              required
                            />
                          </label>
                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Document PDF</span>
                            <input
                              type="file"
                              name="pdf-file"
                              accept="application/pdf"
                              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 bg-white"
                              required
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={uploadingPdf}
                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-white font-bold hover:bg-emerald-700 transition-colors disabled:opacity-60"
                          >
                            <i className="fas fa-file-pdf"></i>
                            {uploadingPdf ? 'Import en cours...' : 'Ajouter le PDF'}
                          </button>
                        </form>
                      </div>
                      </div>
                    )}

                    <div className="space-y-4">
                      <h2 className="text-2xl font-black text-slate-900">
                        Contenus ajoutés - {resourceCourse?.title || 'Cours'} ({filteredContentItems.length})
                      </h2>
                      {filteredContentItems.length === 0 && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-500">
                          Aucun document ou lien ajouté pour ce cours.
                        </div>
                      )}
                      {filteredContentItems.map((item) => (
                        <article key={item.id} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${item.type === 'PDF' ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}>
                                  {item.type}
                                </span>
                              </div>
                              <h3 className="text-xl font-black text-slate-900">{item.title}</h3>
                              <p className="text-sm text-slate-400 mt-1">
                                {new Date(item.createdAt).toLocaleString('fr-FR')}
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  void openContentItem(item);
                                }}
                                className="inline-flex items-center gap-2 mt-3 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                              >
                                <i className="fas fa-up-right-from-square"></i>
                                Ouvrir
                              </button>
                            </div>
                            {canEditResources && (
                              <button
                                type="button"
                                onClick={() => deleteContentItem(item.id)}
                                className="text-sm font-semibold text-rose-600 hover:text-rose-700"
                              >
                                Supprimer
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                )}

                {menuSection === 'BALADO' && (
                  <div className="space-y-8">
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Comprendre les RP le temps d'un café.</h1>
                      <p className="text-slate-600 text-lg">Tous les épisodes du balado sont disponibles ici et dans Spotify.</p>
                    </div>

                    {podcastLoading && (
                      <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-500">
                        Chargement des épisodes...
                      </div>
                    )}

                    {podcastError && (
                      <div className="bg-rose-50 rounded-2xl border border-rose-200 p-6 text-rose-700">
                        {podcastError}
                      </div>
                    )}

                    {!podcastLoading && !podcastError && podcastEpisodes.length === 0 && (
                      <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-500">
                        Aucun épisode trouvé pour le moment.
                      </div>
                    )}

                    {!podcastLoading && podcastEpisodes.length > 0 && (
                      <div className="space-y-4">
                        {podcastEpisodes.map((episode, index) => (
                          <article key={`${episode.title}-${index}`} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                            <h2 className="text-xl font-black text-slate-900">{episode.title}</h2>
                            {episode.pubDate && (
                              <p className="text-sm text-slate-400 mt-1">
                                {new Date(episode.pubDate).toLocaleDateString('fr-FR', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                })}
                              </p>
                            )}
                            {episode.description && (
                              <p className="text-slate-700 mt-3">{episode.description}</p>
                            )}
                            {episode.audioUrl && (
                              <audio controls preload="none" className="mt-4 w-full">
                                <source src={episode.audioUrl} />
                              </audio>
                            )}
                            {episode.link && (
                              <a
                                href={episode.link}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 mt-4 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                              >
                                <i className="fas fa-up-right-from-square"></i>
                                Ouvrir l'épisode
                              </a>
                            )}
                          </article>
                        ))}
                      </div>
                    )}

                    <a
                      href={spotifyShowUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-white font-bold hover:bg-emerald-700 transition-colors"
                    >
                      <i className="fas fa-up-right-from-square"></i>
                      Ouvrir dans Spotify
                    </a>
                  </div>
                )}

                {menuSection === 'BLOG' && (
                  <div className="space-y-8">
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Blog du prof</h1>
                      <p className="text-slate-600 text-lg">Tous les articles du prof sont disponibles ici.</p>
                    </div>

                    <div className="bg-white rounded-3xl border border-slate-200 p-4 md:p-6 shadow-sm">
                      <iframe
                        title="Blog Stepru"
                        src={blogUrl}
                        width="100%"
                        height="900"
                        loading="lazy"
                        className="rounded-2xl"
                      />
                    </div>

                    <a
                      href={blogUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors"
                    >
                      <i className="fas fa-up-right-from-square"></i>
                      Ouvrir le blog
                    </a>
                  </div>
                )}

                {menuSection === 'MEMO' && (
                  <div className="space-y-8">
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Cartes mémo</h1>
                      <p className="text-slate-600 text-lg">
                        {canEditResources
                          ? 'Génère et révise les flashcards par cours.'
                          : 'Flashcards générées par le professeur pour ce cours.'}
                      </p>
                      <div className="mt-5 max-w-md">
                        <label className="block">
                          <span className="text-sm font-semibold text-slate-700">Cours lié</span>
                          <select
                            value={resourceCourseId}
                            onChange={(event) => setResourceCourseId(event.target.value)}
                            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            {visibleTopics.map((topic) => (
                              <option key={topic.id} value={topic.id}>{topic.title}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>

                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <div className="flex flex-wrap items-center gap-4">
                        <button
                          type="button"
                          onClick={() => {
                            void ensureCourseSession(resourceCourseId);
                          }}
                          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors"
                        >
                          <i className="fas fa-bolt"></i>
                          Générer les cartes du cours
                        </button>
                        <button
                          type="button"
                          disabled={!sessionData[resourceCourseId]?.flashcards?.length}
                          onClick={() => setShowFlashcards(true)}
                          className="inline-flex items-center gap-2 rounded-xl border-2 border-indigo-600 px-5 py-3 text-indigo-600 font-bold hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Réviser en mode flashcards
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h2 className="text-2xl font-black text-slate-900">
                        Cartes du cours - {resourceCourse?.title || 'Cours'} ({sessionData[resourceCourseId]?.flashcards?.length || 0})
                      </h2>
                      {!sessionData[resourceCourseId]?.flashcards?.length && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-500">
                          Aucune carte mémo pour ce cours. Clique sur "Générer les cartes du cours".
                        </div>
                      )}
                      {(sessionData[resourceCourseId]?.flashcards || []).map((card) => (
                        <article key={card.id} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                          <p className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-2">Question</p>
                          <h3 className="text-xl font-black text-slate-900">{card.question}</h3>
                          <hr className="my-4 border-slate-100" />
                          <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-2">Réponse</p>
                          <p className="text-slate-700">{card.answer}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                )}

                {menuSection === 'ASSISTANT' && (
                  <div className="space-y-8">
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Stépru le prof de comm.</h1>
                      <p className="text-slate-600 text-lg">
                        Accès direct à notre agent conversationnel.
                      </p>
                    </div>

                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-6">
                        <h2 className="text-2xl font-black text-slate-900 mb-3">Disponible gratuitement pour les étudiant(e)s</h2>
                        <p className="text-slate-700 text-lg">
                          Cliquez sur la bouton ci-dessous pour un ouvrir l'assistant chatGPT gratuitement et posez vos questions reliées au cours, à la communication et aux relations publiques.
                        </p>
                      </div>

                      <a
                        href={assistantUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-6 inline-flex items-center gap-3 rounded-xl bg-indigo-600 px-6 py-3 text-white font-bold hover:bg-indigo-700 transition-colors"
                      >
                        <i className="fas fa-robot"></i>
                        Ouvrir l'Assistant IA
                      </a>
                    </div>
                  </div>
                )}

                {menuSection === 'CONTACT' && (
                  <div className="space-y-8">
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Contact</h1>
                      <p className="text-slate-600 text-lg">
                        Besoin d'aide? Écris-nous et nous te répondrons rapidement.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-3 flex items-center gap-2">
                          <i className="fas fa-envelope text-indigo-600"></i>
                          Contact
                        </h2>
                        <p className="text-slate-600 mb-6">
                          Pour toute question pédagogique, technique, ou juste pour prendre contact.
                        </p>
                        <a
                          href={contactUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors"
                        >
                          Ouvrir le formulaire de contact
                        </a>
                      </div>

                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-3 flex items-center gap-2">
                          <i className="fas fa-robot text-emerald-600"></i>
                          Assistant IA
                        </h2>
                        <p className="text-slate-600 mb-6">
                          Pour des questions de cours immédiates, utilise l'assistant.
                        </p>
                        <a
                          href={assistantUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-white font-bold hover:bg-emerald-700 transition-colors"
                        >
                          Ouvrir l'Assistant IA
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>

      {showFlashcards && flashcardsForModal.length > 0 && (
        <FlashcardDeck 
          cards={flashcardsForModal} 
          onClose={() => setShowFlashcards(false)} 
        />
      )}
    </div>
  );
};

export default App;
