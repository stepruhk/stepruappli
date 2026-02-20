
import React, { useEffect, useState } from 'react';
import { Topic, AppView, StudySession } from './types.ts';
import { INITIAL_TOPICS } from './constants.ts';
import ciLogo from './assets/ci-logo.png';
import {
  checkAuthStatus,
  createCourseContent,
  createEvernoteNote,
  generateFlashcards,
  getAccessMetrics,
  listCourseContent,
  listEvernoteNotes,
  loginWithPassword,
  logout,
  removeCourseContent,
  removeEvernoteNote,
  saveCourseOrder,
  summarizeContent,
  updateCourseContent,
  updateEvernoteNote,
  type AccessMetrics,
  type EvernoteNote,
  type LearningContentItem,
  type OrderEntityType,
  type UserRole,
} from './services/openaiService.ts';
import FlashcardDeck from './components/FlashcardDeck.tsx';

type MenuSection = 'ACCUEIL' | 'CONTENU' | 'ANNONCES' | 'MEMO' | 'BALADO' | 'BLOG' | 'ASSISTANT' | 'CONTACT';
type PodcastEpisode = {
  title: string;
  link?: string;
  pubDate?: string;
  description?: string;
  audioUrl?: string;
};
const GENERAL_COURSE_ID = 'general';
const ANNOUNCEMENTS_COURSE_ID = 'announcements';
const PROFESSOR_PROFILE_PREFIX = 'professor-profile:';
const PROFESSOR_BIO_TITLE = '__PROF_BIO__';
const PROFESSOR_SOCIAL_PREFIX = '[SOCIAL] ';
const PROFESSOR_PUBLICATION_PREFIX = '[PUBLICATION] ';
const PROFESSOR_LITERATURE_PREFIX = '[LITERATURE] ';

const App: React.FC = () => {
  const visibleTopics = INITIAL_TOPICS;
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
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteTitle, setEditNoteTitle] = useState('');
  const [editNoteContent, setEditNoteContent] = useState('');
  const [editNoteLink, setEditNoteLink] = useState('');
  const [evernoteNotesByCourse, setEvernoteNotesByCourse] = useState<Record<string, EvernoteNote[]>>({});
  const [contentTitle, setContentTitle] = useState('');
  const [contentUrl, setContentUrl] = useState('');
  const [pdfTitle, setPdfTitle] = useState('');
  const [editingContentId, setEditingContentId] = useState<string | null>(null);
  const [editContentTitle, setEditContentTitle] = useState('');
  const [editContentUrl, setEditContentUrl] = useState('');
  const [editContentType, setEditContentType] = useState<'PDF' | 'LIEN'>('LIEN');
  const [contentItemsByCourse, setContentItemsByCourse] = useState<Record<string, LearningContentItem[]>>({});
  const [professorBioText, setProfessorBioText] = useState('');
  const [socialLinkTitle, setSocialLinkTitle] = useState('');
  const [socialLinkUrl, setSocialLinkUrl] = useState('');
  const [publicationTitle, setPublicationTitle] = useState('');
  const [publicationUrl, setPublicationUrl] = useState('');
  const [literatureTitle, setLiteratureTitle] = useState('');
  const [literatureCitation, setLiteratureCitation] = useState('');
  const [literatureUrl, setLiteratureUrl] = useState('');
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
  const zoomSchedulerUrl = 'https://scheduler.zoom.us/stephane-prudhomme';
  const [podcastEpisodes, setPodcastEpisodes] = useState<PodcastEpisode[]>([]);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [podcastError, setPodcastError] = useState<string | null>(null);
  const [accessMetrics, setAccessMetrics] = useState<AccessMetrics | null>(null);
  const [accessMetricsLoading, setAccessMetricsLoading] = useState(false);
  const [accessMetricsError, setAccessMetricsError] = useState<string | null>(null);

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
    if (resourceCourseId === GENERAL_COURSE_ID || resourceCourseId === ANNOUNCEMENTS_COURSE_ID) return;
    if (!visibleTopics.some((topic) => topic.id === resourceCourseId)) {
      setResourceCourseId(visibleTopics[0]?.id || '');
    }
  }, [resourceCourseId, visibleTopics]);

  useEffect(() => {
    if (menuSection === 'ACCUEIL' && view === AppView.TOPIC_DETAIL && selectedTopic && resourceCourseId !== selectedTopic.id) {
      setResourceCourseId(selectedTopic.id);
    }
  }, [menuSection, view, selectedTopic, resourceCourseId]);

  useEffect(() => {
    const loadCourseResources = async () => {
      if (!authChecked || !isAuthenticated || !resourceCourseId) return;
      try {
        const [notes, resources] = await Promise.all([
          listEvernoteNotes(resourceCourseId),
          listCourseContent(resourceCourseId),
        ]);
        setEvernoteNotesByCourse((prev) => ({ ...prev, [resourceCourseId]: notes }));
        setContentItemsByCourse((prev) => ({ ...prev, [resourceCourseId]: resources }));
      } catch (error) {
        console.error(error);
      }
    };

    void loadCourseResources();
  }, [authChecked, isAuthenticated, resourceCourseId]);

  useEffect(() => {
    const loadProfessorSection = async () => {
      if (!authChecked || !isAuthenticated || !selectedTopic) return;
      const profileCourseId = `${PROFESSOR_PROFILE_PREFIX}${selectedTopic.id}`;
      try {
        const [notes, resources] = await Promise.all([
          listEvernoteNotes(profileCourseId),
          listCourseContent(profileCourseId),
        ]);
        setEvernoteNotesByCourse((prev) => ({ ...prev, [profileCourseId]: notes }));
        setContentItemsByCourse((prev) => ({ ...prev, [profileCourseId]: resources }));
      } catch (error) {
        console.error(error);
      }
    };

    void loadProfessorSection();
  }, [authChecked, isAuthenticated, selectedTopic]);

  useEffect(() => {
    if (!selectedTopic) {
      setProfessorBioText('');
      return;
    }
    const profileCourseId = `${PROFESSOR_PROFILE_PREFIX}${selectedTopic.id}`;
    const bioNote = (evernoteNotesByCourse[profileCourseId] || []).find((note) => note.title === PROFESSOR_BIO_TITLE);
    setProfessorBioText(bioNote?.content || '');
  }, [selectedTopic, evernoteNotesByCourse]);

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

  useEffect(() => {
    const loadAccessMetrics = async () => {
      if (!authChecked || !isAuthenticated || userRole !== 'professor') return;
      if (menuSection !== 'CONTACT') return;

      setAccessMetricsLoading(true);
      setAccessMetricsError(null);
      try {
        const metrics = await getAccessMetrics();
        setAccessMetrics(metrics);
      } catch (error) {
        console.error(error);
        setAccessMetricsError('Impossible de charger le compteur pour le moment.');
      } finally {
        setAccessMetricsLoading(false);
      }
    };

    void loadAccessMetrics();
  }, [authChecked, isAuthenticated, menuSection, userRole]);

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
      logout();
      setIsAuthenticated(false);
      setUserRole('student');
      setAuthError('Mot de passe incorrect. Réessayez.');
    }
  };

  const startTopic = async (topic: Topic) => {
    setMenuSection('ACCUEIL');
    setResourceCourseId(topic.id);
    setSelectedTopic(topic);
    setView(AppView.TOPIC_DETAIL);

    if (sessionData[topic.id]) return;
    setSessionData((prev) => ({
      ...prev,
      [topic.id]: { topicId: topic.id, summary: '', flashcards: [] },
    }));
  };

  const currentSession = selectedTopic ? sessionData[selectedTopic.id] : null;
  const resourceCourse = visibleTopics.find((topic) => topic.id === resourceCourseId) || null;
  const activeResourceCourseId =
    menuSection === 'ACCUEIL' && view === AppView.TOPIC_DETAIL && selectedTopic
      ? selectedTopic.id
      : resourceCourseId;
  const filteredEvernoteNotes = evernoteNotesByCourse[resourceCourseId] || [];
  const filteredContentItems = contentItemsByCourse[resourceCourseId] || [];
  const selectedTopicNotes = selectedTopic
    ? (evernoteNotesByCourse[selectedTopic.id] || [])
    : [];
  const announcementNotes = evernoteNotesByCourse[ANNOUNCEMENTS_COURSE_ID] || [];
  const selectedTopicContentItems = selectedTopic
    ? (contentItemsByCourse[selectedTopic.id] || [])
    : [];
  const professorProfileCourseId = selectedTopic ? `${PROFESSOR_PROFILE_PREFIX}${selectedTopic.id}` : '';
  const professorProfileNotes = professorProfileCourseId ? (evernoteNotesByCourse[professorProfileCourseId] || []) : [];
  const professorBioNote = professorProfileNotes.find((note) => note.title === PROFESSOR_BIO_TITLE) || null;
  const professorLiteratureNotes = professorProfileNotes.filter((note) => note.title.startsWith(PROFESSOR_LITERATURE_PREFIX));
  const professorSectionItems = professorProfileCourseId ? (contentItemsByCourse[professorProfileCourseId] || []) : [];
  const professorSocialLinks = professorSectionItems.filter((item) => item.title.startsWith(PROFESSOR_SOCIAL_PREFIX));
  const professorPublications = professorSectionItems.filter((item) => item.title.startsWith(PROFESSOR_PUBLICATION_PREFIX));
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
      icon: 'bg-rose-600 text-white',
      bubble: 'bg-rose-50',
    },
    {
      icon: 'bg-amber-600 text-white',
      bubble: 'bg-amber-50',
    },
    {
      icon: 'bg-sky-600 text-white',
      bubble: 'bg-sky-50',
    },
    {
      icon: 'bg-violet-600 text-white',
      bubble: 'bg-violet-50',
    },
  ];
  const mainMenuItems = [
    { label: 'Accueil', icon: 'fa-border-all', key: 'ACCUEIL' as const },
    { label: 'Contenu', icon: 'fa-file-lines', key: 'CONTENU' as const },
    { label: 'Cartes mémo', icon: 'fa-bolt', key: 'MEMO' as const },
    { label: 'Balado', icon: 'fa-podcast', key: 'BALADO' as const },
    { label: 'Blog', icon: 'fa-newspaper', key: 'BLOG' as const },
    { label: 'Assistant IA', icon: 'fa-robot', key: 'ASSISTANT' as const },
    { label: 'Annonces', icon: 'fa-bullhorn', key: 'ANNONCES' as const },
    { label: 'Contact', icon: 'fa-envelope', key: 'CONTACT' as const },
  ];
  const canEditResources = userRole === 'professor';

  const persistOrder = async (entityType: OrderEntityType, courseId: string, orderedIds: string[]) => {
    await saveCourseOrder(entityType, courseId, orderedIds);
  };

  const moveNoteItem = async (
    courseId: string,
    noteId: string,
    direction: 'up' | 'down',
    predicate?: (note: EvernoteNote) => boolean,
  ) => {
    const current = evernoteNotesByCourse[courseId] || [];
    const filterFn = predicate || (() => true);
    const subset = current.filter(filterFn);
    const index = subset.findIndex((item) => item.id === noteId);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= subset.length) return;

    const movedSubset = [...subset];
    [movedSubset[index], movedSubset[targetIndex]] = [movedSubset[targetIndex], movedSubset[index]];

    let pointer = 0;
    const next = current.map((item) => (filterFn(item) ? movedSubset[pointer++] : item));
    setEvernoteNotesByCourse((prev) => ({ ...prev, [courseId]: next }));

    try {
      await persistOrder('notes', courseId, next.map((item) => item.id));
    } catch (error) {
      console.error(error);
      setEvernoteNotesByCourse((prev) => ({ ...prev, [courseId]: current }));
      handleAuthError(error);
      alert(`Impossible de changer l'ordre des notes. ${getErrorMessage(error)}`);
    }
  };

  const moveContentItem = async (
    courseId: string,
    itemId: string,
    direction: 'up' | 'down',
    predicate?: (item: LearningContentItem) => boolean,
  ) => {
    const current = contentItemsByCourse[courseId] || [];
    const filterFn = predicate || (() => true);
    const subset = current.filter(filterFn);
    const index = subset.findIndex((item) => item.id === itemId);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= subset.length) return;

    const movedSubset = [...subset];
    [movedSubset[index], movedSubset[targetIndex]] = [movedSubset[targetIndex], movedSubset[index]];

    let pointer = 0;
    const next = current.map((item) => (filterFn(item) ? movedSubset[pointer++] : item));
    setContentItemsByCourse((prev) => ({ ...prev, [courseId]: next }));

    try {
      await persistOrder('resources', courseId, next.map((item) => item.id));
    } catch (error) {
      console.error(error);
      setContentItemsByCourse((prev) => ({ ...prev, [courseId]: current }));
      handleAuthError(error);
      alert(`Impossible de changer l'ordre des contenus. ${getErrorMessage(error)}`);
    }
  };

  const addEvernoteNote = async (event: React.FormEvent) => {
    event.preventDefault();
    const courseId = activeResourceCourseId;
    if (!courseId) return;
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
        courseId,
        title,
        content,
        link: link || undefined,
      });
      setEvernoteNotesByCourse((prev) => ({
        ...prev,
        [courseId]: [newNote, ...(prev[courseId] || [])],
      }));
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
    const courseId = activeResourceCourseId;
    try {
      await removeEvernoteNote(id);
      if (!courseId) return;
      setEvernoteNotesByCourse((prev) => ({
        ...prev,
        [courseId]: (prev[courseId] || []).filter((note) => note.id !== id),
      }));
    } catch (error) {
      console.error(error);
      alert("Impossible de supprimer la note.");
    }
  };

  const addContentLink = async (event: React.FormEvent) => {
    event.preventDefault();
    const courseId = activeResourceCourseId;
    if (!courseId) return;
    const title = contentTitle.trim();
    const rawUrl = contentUrl.trim();
    if (!title || !rawUrl) return;
    const normalizedUrl = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
      ? rawUrl
      : `https://${rawUrl}`;

    try {
      const item = await createCourseContent({
        courseId,
        type: 'LIEN',
        title,
        url: normalizedUrl,
      });
      setContentItemsByCourse((prev) => ({
        ...prev,
        [courseId]: [item, ...(prev[courseId] || [])],
      }));
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
    const courseId = activeResourceCourseId;
    if (!courseId) return;
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem('pdf-file') as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    const title = pdfTitle.trim();
    if (!file || !title) return;

    setUploadingPdf(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const item = await createCourseContent({
        courseId,
        type: 'PDF',
        title,
        url: dataUrl,
      });
      setContentItemsByCourse((prev) => ({
        ...prev,
        [courseId]: [item, ...(prev[courseId] || [])],
      }));
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
    const courseId = activeResourceCourseId;
    try {
      await removeCourseContent(id);
      if (!courseId) return;
      setContentItemsByCourse((prev) => ({
        ...prev,
        [courseId]: (prev[courseId] || []).filter((item) => item.id !== id),
      }));
    } catch (error) {
      console.error(error);
      alert("Impossible de supprimer ce contenu.");
    }
  };

  const startEditNote = (note: EvernoteNote) => {
    setEditingNoteId(note.id);
    setEditNoteTitle(note.title);
    setEditNoteContent(note.content || '');
    setEditNoteLink(note.link || '');
  };

  const cancelEditNote = () => {
    setEditingNoteId(null);
    setEditNoteTitle('');
    setEditNoteContent('');
    setEditNoteLink('');
  };

  const saveEditNote = async (note: EvernoteNote) => {
    const title = editNoteTitle.trim();
    const content = editNoteContent.trim();
    const rawLink = editNoteLink.trim();
    const link = rawLink
      ? rawLink.startsWith('http://') || rawLink.startsWith('https://')
        ? rawLink
        : `https://${rawLink}`
      : '';
    if (!title || (!content && !link)) return;

    try {
      const updated = await updateEvernoteNote(note.id, {
        title,
        content,
        link: link || undefined,
      });
      setEvernoteNotesByCourse((prev) => ({
        ...prev,
        [note.courseId]: (prev[note.courseId] || []).map((entry) => (entry.id === note.id ? updated : entry)),
      }));
      cancelEditNote();
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible de modifier la note. ${getErrorMessage(error)}`);
    }
  };

  const startEditContent = (item: LearningContentItem) => {
    setEditingContentId(item.id);
    setEditContentTitle(item.title);
    setEditContentUrl(item.type === 'LIEN' ? item.url : '');
    setEditContentType(item.type);
  };

  const cancelEditContent = () => {
    setEditingContentId(null);
    setEditContentTitle('');
    setEditContentUrl('');
    setEditContentType('LIEN');
  };

  const saveEditContent = async (item: LearningContentItem) => {
    const title = editContentTitle.trim();
    if (!title) return;
    const rawUrl = editContentType === 'LIEN' ? editContentUrl.trim() : item.url;
    if (!rawUrl) return;
    const url = editContentType === 'LIEN'
      ? (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `https://${rawUrl}`)
      : rawUrl;

    try {
      const updated = await updateCourseContent(item.id, {
        type: editContentType,
        title,
        url,
      });
      setContentItemsByCourse((prev) => ({
        ...prev,
        [item.courseId]: (prev[item.courseId] || []).map((entry) => (entry.id === item.id ? updated : entry)),
      }));
      cancelEditContent();
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible de modifier le contenu. ${getErrorMessage(error)}`);
    }
  };

  const getProfessorItemLabel = (title: string) =>
    title
      .replace(PROFESSOR_SOCIAL_PREFIX, '')
      .replace(PROFESSOR_PUBLICATION_PREFIX, '')
      .replace(PROFESSOR_LITERATURE_PREFIX, '')
      .trim();

  const saveProfessorBio = async () => {
    if (!selectedTopic) return;
    const profileCourseId = `${PROFESSOR_PROFILE_PREFIX}${selectedTopic.id}`;
    const content = professorBioText.trim();
    if (!content) return;

    try {
      if (professorBioNote) {
        const updated = await updateEvernoteNote(professorBioNote.id, {
          title: PROFESSOR_BIO_TITLE,
          content,
        });
        setEvernoteNotesByCourse((prev) => ({
          ...prev,
          [profileCourseId]: (prev[profileCourseId] || []).map((note) => (note.id === updated.id ? updated : note)),
        }));
      } else {
        const created = await createEvernoteNote({
          courseId: profileCourseId,
          title: PROFESSOR_BIO_TITLE,
          content,
        });
        setEvernoteNotesByCourse((prev) => ({
          ...prev,
          [profileCourseId]: [created, ...(prev[profileCourseId] || [])],
        }));
      }
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible d'enregistrer la bio. ${getErrorMessage(error)}`);
    }
  };

  const addProfessorSocialLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTopic) return;
    const profileCourseId = `${PROFESSOR_PROFILE_PREFIX}${selectedTopic.id}`;
    const title = socialLinkTitle.trim();
    const rawUrl = socialLinkUrl.trim();
    if (!title || !rawUrl) return;
    const url = rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `https://${rawUrl}`;

    try {
      const created = await createCourseContent({
        courseId: profileCourseId,
        type: 'LIEN',
        title: `${PROFESSOR_SOCIAL_PREFIX}${title}`,
        url,
      });
      setContentItemsByCourse((prev) => ({
        ...prev,
        [profileCourseId]: [created, ...(prev[profileCourseId] || [])],
      }));
      setSocialLinkTitle('');
      setSocialLinkUrl('');
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible d'ajouter le lien social. ${getErrorMessage(error)}`);
    }
  };

  const addProfessorPublication = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTopic) return;
    const profileCourseId = `${PROFESSOR_PROFILE_PREFIX}${selectedTopic.id}`;
    const title = publicationTitle.trim();
    const rawUrl = publicationUrl.trim();
    if (!title || !rawUrl) return;
    const url = rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `https://${rawUrl}`;

    try {
      const created = await createCourseContent({
        courseId: profileCourseId,
        type: 'LIEN',
        title: `${PROFESSOR_PUBLICATION_PREFIX}${title}`,
        url,
      });
      setContentItemsByCourse((prev) => ({
        ...prev,
        [profileCourseId]: [created, ...(prev[profileCourseId] || [])],
      }));
      setPublicationTitle('');
      setPublicationUrl('');
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible d'ajouter la publication. ${getErrorMessage(error)}`);
    }
  };

  const addProfessorLiterature = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTopic) return;
    const profileCourseId = `${PROFESSOR_PROFILE_PREFIX}${selectedTopic.id}`;
    const title = literatureTitle.trim();
    const citation = literatureCitation.trim();
    const rawUrl = literatureUrl.trim();
    if (!title || !rawUrl) return;
    const url = rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `https://${rawUrl}`;

    try {
      const created = await createEvernoteNote({
        courseId: profileCourseId,
        title: `${PROFESSOR_LITERATURE_PREFIX}${title}`,
        content: citation,
        link: url,
      });
      setEvernoteNotesByCourse((prev) => ({
        ...prev,
        [profileCourseId]: [created, ...(prev[profileCourseId] || [])],
      }));
      setLiteratureTitle('');
      setLiteratureCitation('');
      setLiteratureUrl('');
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible d'ajouter cette référence. ${getErrorMessage(error)}`);
    }
  };

  const deleteProfessorLiterature = async (noteId: string) => {
    if (!selectedTopic) return;
    const profileCourseId = `${PROFESSOR_PROFILE_PREFIX}${selectedTopic.id}`;
    try {
      await removeEvernoteNote(noteId);
      setEvernoteNotesByCourse((prev) => ({
        ...prev,
        [profileCourseId]: (prev[profileCourseId] || []).filter((entry) => entry.id !== noteId),
      }));
    } catch (error) {
      console.error(error);
      alert("Impossible de supprimer cette lecture.");
    }
  };

  const deleteProfessorItem = async (item: LearningContentItem) => {
    if (!selectedTopic) return;
    const profileCourseId = `${PROFESSOR_PROFILE_PREFIX}${selectedTopic.id}`;
    try {
      await removeCourseContent(item.id);
      setContentItemsByCourse((prev) => ({
        ...prev,
        [profileCourseId]: (prev[profileCourseId] || []).filter((entry) => entry.id !== item.id),
      }));
    } catch (error) {
      console.error(error);
      alert("Impossible de supprimer cet élément.");
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
    if (!topic.content.trim()) {
      setSessionData((prev) => ({
        ...prev,
        [courseId]: { topicId: courseId, summary: '', flashcards: [] },
      }));
      return;
    }

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

  const navigateToMenuSection = (section: MenuSection) => {
    if (section === 'ACCUEIL') {
      setMenuSection('ACCUEIL');
      setView(AppView.DASHBOARD);
      setSelectedTopic(null);
      return;
    }
    if (section === 'CONTENU') {
      setView(AppView.DASHBOARD);
      setResourceCourseId(GENERAL_COURSE_ID);
      setMenuSection(section);
      return;
    }
    if (section === 'ANNONCES') {
      setView(AppView.DASHBOARD);
      setResourceCourseId(ANNOUNCEMENTS_COURSE_ID);
      setMenuSection(section);
      return;
    }
    if (section === 'MEMO' && resourceCourseId === GENERAL_COURSE_ID) {
      setResourceCourseId(visibleTopics[0]?.id || '');
    }
    setMenuSection(section);
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
                  Cours, contenu, balado, assistant IA, et cartes mémo dans une seule plateforme.
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
                  <div className="mt-1">
                    <a
                      href="https://credibilityinstitute.com/contact"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      Vous n'avez pas le mot de passe ?
                    </a>
                  </div>

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

            <div className="md:hidden mb-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex gap-2 overflow-x-auto pb-2">
                {mainMenuItems.map((item) => (
                  <button
                    key={`mobile-${item.label}`}
                    type="button"
                    onClick={() => navigateToMenuSection(item.key)}
                    className={`shrink-0 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold border transition-colors ${
                      menuSection === item.key
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    <i className={`fas ${item.icon} text-xs`}></i>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => navigateToMenuSection('ACCUEIL')}
                className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700"
              >
                <i className="fas fa-right-left text-xs"></i>
                Changer de cours
              </button>
            </div>

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
                        onClick={() => navigateToMenuSection(item.key)}
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
                        const isCredibilityCourse = topic.id === '5';
                        return (
                        <div 
                          key={topic.id}
                          onClick={() => startTopic(topic)}
                          className="relative bg-white rounded-3xl p-8 md:p-10 cursor-pointer border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all group overflow-hidden"
                        >
                          <div className={`absolute -top-8 -right-8 w-36 h-36 rounded-full ${style.bubble}`}></div>
                          <div className={`relative w-16 h-16 rounded-2xl ${isCredibilityCourse ? 'bg-white border border-slate-200' : style.icon} flex items-center justify-center mb-8 overflow-hidden`}>
                            {isCredibilityCourse ? (
                              <img src={ciLogo} alt="" className="w-12 h-12 object-contain" />
                            ) : (
                              <i className={`fas ${topic.icon} text-2xl`}></i>
                            )}
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

                    <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm mb-8">
                      <div className="flex items-center space-x-3 mb-4">
                        <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold uppercase tracking-wider">
                          {selectedTopic.category}
                        </span>
                      </div>
                      <h1 className="text-4xl font-black text-slate-900 mb-6 leading-tight">{selectedTopic.title}</h1>
                      <div className="h-24 flex items-center justify-center bg-slate-50 rounded-xl text-slate-500">
                        Contenu à venir pour ce cours.
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-2">Contenu du cours</h2>
                        <p className="text-slate-600 mb-6">
                          Documents et liens spécifiques à ce cours.
                        </p>

                        {canEditResources && (
                          <div className="space-y-4 mb-6">
                            <form onSubmit={addContentLink} className="space-y-3 rounded-2xl border border-slate-200 p-4">
                              <h3 className="font-bold text-slate-900">Ajouter un hyperlien</h3>
                              <input
                                type="text"
                                value={contentTitle}
                                onChange={(event) => setContentTitle(event.target.value)}
                                placeholder="Titre du lien"
                                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                              <input
                                type="url"
                                value={contentUrl}
                                onChange={(event) => setContentUrl(event.target.value)}
                                placeholder="https://..."
                                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                              <button
                                type="submit"
                                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-white font-bold hover:bg-indigo-700 transition-colors"
                              >
                                <i className="fas fa-link"></i>
                                Ajouter le lien
                              </button>
                            </form>

                            <form onSubmit={addPdfContent} className="space-y-3 rounded-2xl border border-slate-200 p-4">
                              <h3 className="font-bold text-slate-900">Ajouter un PDF</h3>
                              <input
                                type="text"
                                value={pdfTitle}
                                onChange={(event) => setPdfTitle(event.target.value)}
                                placeholder="Titre du PDF"
                                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                              <input
                                type="file"
                                name="pdf-file"
                                accept="application/pdf"
                                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 bg-white"
                                required
                              />
                              <button
                                type="submit"
                                disabled={uploadingPdf}
                                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-white font-bold hover:bg-emerald-700 transition-colors disabled:opacity-60"
                              >
                                <i className="fas fa-file-pdf"></i>
                                {uploadingPdf ? 'Import en cours...' : 'Ajouter le PDF'}
                              </button>
                            </form>
                          </div>
                        )}

                        <div className="space-y-3">
                          {selectedTopicContentItems.length === 0 && (
                            <div className="rounded-2xl border border-slate-200 p-4 text-slate-500">
                              Aucun document ou lien pour ce cours.
                            </div>
                          )}
                          {selectedTopicContentItems.map((item, index) => (
                            <article key={item.id} className="rounded-2xl border border-slate-200 p-4">
                              {canEditResources && editingContentId === item.id ? (
                                <form
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    void saveEditContent(item);
                                  }}
                                  className="space-y-3"
                                >
                                  <input
                                    type="text"
                                    value={editContentTitle}
                                    onChange={(event) => setEditContentTitle(event.target.value)}
                                    className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    required
                                  />
                                  {editContentType === 'LIEN' ? (
                                    <input
                                      type="url"
                                      value={editContentUrl}
                                      onChange={(event) => setEditContentUrl(event.target.value)}
                                      className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                      required
                                    />
                                  ) : (
                                    <p className="text-xs text-slate-500">
                                      Pour remplacer le PDF, supprimez-le puis ajoutez un nouveau fichier.
                                    </p>
                                  )}
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="submit"
                                      className="rounded-xl bg-indigo-600 px-4 py-2 text-white text-sm font-bold hover:bg-indigo-700"
                                    >
                                      Enregistrer
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelEditContent}
                                      className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
                                    >
                                      Annuler
                                    </button>
                                  </div>
                                </form>
                              ) : (
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${item.type === 'PDF' ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}>
                                      {item.type}
                                    </span>
                                    <h3 className="text-lg font-black text-slate-900 mt-2">{item.title}</h3>
                                    <button
                                      type="button"
                                      onClick={() => { void openContentItem(item); }}
                                      className="inline-flex items-center gap-2 mt-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                                    >
                                      <i className="fas fa-up-right-from-square"></i>
                                      Ouvrir
                                    </button>
                                  </div>
                                  {canEditResources && (
                                    <div className="flex items-center gap-3">
                                      <button
                                        type="button"
                                        onClick={() => { void moveContentItem(item.courseId, item.id, 'up'); }}
                                        disabled={index === 0}
                                        className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Monter"
                                      >
                                        <i className="fas fa-arrow-up"></i>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { void moveContentItem(item.courseId, item.id, 'down'); }}
                                        disabled={index === selectedTopicContentItems.length - 1}
                                        className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Descendre"
                                      >
                                        <i className="fas fa-arrow-down"></i>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => startEditContent(item)}
                                        className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                                      >
                                        Modifier
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => deleteContentItem(item.id)}
                                        className="text-sm font-semibold text-rose-600 hover:text-rose-700"
                                      >
                                        Supprimer
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-2">Notes Evernote du cours</h2>
                        <p className="text-slate-600 mb-6">
                          Notes et liens Evernote spécifiques à ce cours.
                        </p>

                        {canEditResources && (
                          <form onSubmit={addEvernoteNote} className="space-y-3 mb-6 rounded-2xl border border-slate-200 p-4">
                            <h3 className="font-bold text-slate-900">Ajouter une note</h3>
                            <input
                              type="text"
                              value={noteTitle}
                              onChange={(event) => setNoteTitle(event.target.value)}
                              placeholder="Titre de la note"
                              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              required
                            />
                            <textarea
                              value={noteContent}
                              onChange={(event) => setNoteContent(event.target.value)}
                              placeholder="Contenu de la note (optionnel si lien Evernote)"
                              className="w-full min-h-28 rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <input
                              type="url"
                              value={noteLink}
                              onChange={(event) => setNoteLink(event.target.value)}
                              placeholder="https://www.evernote.com/..."
                              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <button
                              type="submit"
                              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-white font-bold hover:bg-indigo-700 transition-colors"
                            >
                              <i className="fas fa-plus"></i>
                              Ajouter la note
                            </button>
                          </form>
                        )}

                        <div className="space-y-3">
                          {selectedTopicNotes.length === 0 && (
                            <div className="rounded-2xl border border-slate-200 p-4 text-slate-500">
                              Aucune note pour ce cours.
                            </div>
                          )}
                          {selectedTopicNotes.map((note, index) => (
                            <article key={note.id} className="rounded-2xl border border-slate-200 p-4">
                              {canEditResources && editingNoteId === note.id ? (
                                <form
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    void saveEditNote(note);
                                  }}
                                  className="space-y-3"
                                >
                                  <input
                                    type="text"
                                    value={editNoteTitle}
                                    onChange={(event) => setEditNoteTitle(event.target.value)}
                                    className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    required
                                  />
                                  <textarea
                                    value={editNoteContent}
                                    onChange={(event) => setEditNoteContent(event.target.value)}
                                    className="w-full min-h-24 rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    placeholder="Contenu (optionnel si lien)"
                                  />
                                  <input
                                    type="url"
                                    value={editNoteLink}
                                    onChange={(event) => setEditNoteLink(event.target.value)}
                                    className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    placeholder="https://www.evernote.com/..."
                                  />
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="submit"
                                      className="rounded-xl bg-indigo-600 px-4 py-2 text-white text-sm font-bold hover:bg-indigo-700"
                                    >
                                      Enregistrer
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelEditNote}
                                      className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
                                    >
                                      Annuler
                                    </button>
                                  </div>
                                </form>
                              ) : (
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <h3 className="text-lg font-black text-slate-900">{note.title}</h3>
                                    {note.link && (
                                      <a
                                        href={note.link}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-2 mt-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                                      >
                                        <i className="fas fa-up-right-from-square"></i>
                                        Ouvrir le lien Evernote
                                      </a>
                                    )}
                                    {note.content && (
                                      <p className="text-slate-700 mt-3 whitespace-pre-line">{note.content}</p>
                                    )}
                                  </div>
                                  {canEditResources && (
                                    <div className="flex items-center gap-3">
                                      <button
                                        type="button"
                                        onClick={() => { void moveNoteItem(note.courseId, note.id, 'up'); }}
                                        disabled={index === 0}
                                        className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Monter"
                                      >
                                        <i className="fas fa-arrow-up"></i>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { void moveNoteItem(note.courseId, note.id, 'down'); }}
                                        disabled={index === selectedTopicNotes.length - 1}
                                        className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Descendre"
                                      >
                                        <i className="fas fa-arrow-down"></i>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => startEditNote(note)}
                                        className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                                      >
                                        Modifier
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => deleteEvernoteNote(note.id)}
                                        className="text-sm font-semibold text-rose-600 hover:text-rose-700"
                                      >
                                        Supprimer
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h2 className="text-2xl font-black text-slate-900 mb-2">Votre professeur</h2>
                      <p className="text-slate-600 mb-6">
                        Bio, liens de réseaux sociaux et publications pour ce cours.
                      </p>

                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                        <div className="rounded-2xl border border-slate-200 p-5">
                          <h3 className="text-lg font-black text-slate-900 mb-3">Bio</h3>
                          {canEditResources ? (
                            <div className="space-y-3">
                              <textarea
                                value={professorBioText}
                                onChange={(event) => setProfessorBioText(event.target.value)}
                                placeholder="Ajoutez votre bio pour ce cours..."
                                className="w-full min-h-36 rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                              <button
                                type="button"
                                onClick={() => { void saveProfessorBio(); }}
                                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-white font-bold hover:bg-indigo-700 transition-colors"
                              >
                                <i className="fas fa-save"></i>
                                Enregistrer la bio
                              </button>
                            </div>
                          ) : (
                            <p className="text-slate-700 whitespace-pre-line">
                              {professorBioNote?.content || 'Bio à venir.'}
                            </p>
                          )}
                        </div>

                        <div className="rounded-2xl border border-slate-200 p-5">
                          <h3 className="text-lg font-black text-slate-900 mb-3">Réseaux sociaux</h3>
                          {canEditResources && (
                            <form onSubmit={addProfessorSocialLink} className="space-y-3 mb-4">
                              <input
                                type="text"
                                value={socialLinkTitle}
                                onChange={(event) => setSocialLinkTitle(event.target.value)}
                                placeholder="Ex: LinkedIn"
                                className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                              <input
                                type="url"
                                value={socialLinkUrl}
                                onChange={(event) => setSocialLinkUrl(event.target.value)}
                                placeholder="https://..."
                                className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                              <button
                                type="submit"
                                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-white text-sm font-bold hover:bg-indigo-700 transition-colors"
                              >
                                <i className="fas fa-plus"></i>
                                Ajouter
                              </button>
                            </form>
                          )}
                          <div className="space-y-2">
                            {professorSocialLinks.length === 0 && (
                              <p className="text-slate-500 text-sm">Aucun lien social pour ce cours.</p>
                            )}
                            {professorSocialLinks.map((item, index) => (
                              <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-indigo-600 hover:text-indigo-700 font-semibold text-sm"
                                >
                                  {getProfessorItemLabel(item.title)}
                                </a>
                                {canEditResources && (
                                  <div className="flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void moveContentItem(
                                          item.courseId,
                                          item.id,
                                          'up',
                                          (entry) => entry.title.startsWith(PROFESSOR_SOCIAL_PREFIX),
                                        );
                                      }}
                                      disabled={index === 0}
                                      className="text-xs font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="Monter"
                                    >
                                      <i className="fas fa-arrow-up"></i>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void moveContentItem(
                                          item.courseId,
                                          item.id,
                                          'down',
                                          (entry) => entry.title.startsWith(PROFESSOR_SOCIAL_PREFIX),
                                        );
                                      }}
                                      disabled={index === professorSocialLinks.length - 1}
                                      className="text-xs font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="Descendre"
                                    >
                                      <i className="fas fa-arrow-down"></i>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteProfessorItem(item)}
                                      className="text-xs font-semibold text-rose-600 hover:text-rose-700"
                                    >
                                      Supprimer
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 p-5">
                          <h3 className="text-lg font-black text-slate-900 mb-3">Publications</h3>
                          {canEditResources && (
                            <form onSubmit={addProfessorPublication} className="space-y-3 mb-4">
                              <input
                                type="text"
                                value={publicationTitle}
                                onChange={(event) => setPublicationTitle(event.target.value)}
                                placeholder="Titre de publication"
                                className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                              <input
                                type="url"
                                value={publicationUrl}
                                onChange={(event) => setPublicationUrl(event.target.value)}
                                placeholder="https://..."
                                className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                              <button
                                type="submit"
                                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-white text-sm font-bold hover:bg-indigo-700 transition-colors"
                              >
                                <i className="fas fa-plus"></i>
                                Ajouter
                              </button>
                            </form>
                          )}
                          <div className="space-y-2">
                            {professorPublications.length === 0 && (
                              <p className="text-slate-500 text-sm">Aucune publication pour ce cours.</p>
                            )}
                            {professorPublications.map((item, index) => (
                              <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-indigo-600 hover:text-indigo-700 font-semibold text-sm"
                                >
                                  {getProfessorItemLabel(item.title)}
                                </a>
                                {canEditResources && (
                                  <div className="flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void moveContentItem(
                                          item.courseId,
                                          item.id,
                                          'up',
                                          (entry) => entry.title.startsWith(PROFESSOR_PUBLICATION_PREFIX),
                                        );
                                      }}
                                      disabled={index === 0}
                                      className="text-xs font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="Monter"
                                    >
                                      <i className="fas fa-arrow-up"></i>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void moveContentItem(
                                          item.courseId,
                                          item.id,
                                          'down',
                                          (entry) => entry.title.startsWith(PROFESSOR_PUBLICATION_PREFIX),
                                        );
                                      }}
                                      disabled={index === professorPublications.length - 1}
                                      className="text-xs font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="Descendre"
                                    >
                                      <i className="fas fa-arrow-down"></i>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteProfessorItem(item)}
                                      className="text-xs font-semibold text-rose-600 hover:text-rose-700"
                                    >
                                      Supprimer
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 p-5">
                          <h3 className="text-lg font-black text-slate-900 mb-3">Lectures recommandées</h3>
                          {canEditResources && (
                            <form onSubmit={addProfessorLiterature} className="space-y-3 mb-4">
                              <input
                                type="text"
                                value={literatureTitle}
                                onChange={(event) => setLiteratureTitle(event.target.value)}
                                placeholder="Titre du livre"
                                className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                              <textarea
                                value={literatureCitation}
                                onChange={(event) => setLiteratureCitation(event.target.value)}
                                placeholder="Citation"
                                className="w-full min-h-24 rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                              <input
                                type="url"
                                value={literatureUrl}
                                onChange={(event) => setLiteratureUrl(event.target.value)}
                                placeholder="https://..."
                                className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                              <button
                                type="submit"
                                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-white text-sm font-bold hover:bg-indigo-700 transition-colors"
                              >
                                <i className="fas fa-plus"></i>
                                Ajouter
                              </button>
                            </form>
                          )}
                          <div className="space-y-2">
                            {professorLiteratureNotes.length === 0 && (
                              <p className="text-slate-500 text-sm">Aucune lecture recommandée pour ce cours.</p>
                            )}
                            {professorLiteratureNotes.map((note, index) => (
                              <div key={note.id} className="rounded-xl border border-slate-200 px-3 py-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-slate-900 font-semibold text-sm">
                                      {note.title.replace(PROFESSOR_LITERATURE_PREFIX, '').trim()}
                                    </p>
                                    {note.content && (
                                      <p className="text-slate-600 text-sm mt-1 whitespace-pre-line">{note.content}</p>
                                    )}
                                    {note.link && (
                                      <a
                                        href={note.link}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-2 mt-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                                      >
                                        <i className="fas fa-up-right-from-square"></i>
                                        Ouvrir le lien
                                      </a>
                                    )}
                                  </div>
                                {canEditResources && (
                                  <div className="flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void moveNoteItem(
                                          note.courseId,
                                          note.id,
                                          'up',
                                          (entry) => entry.title.startsWith(PROFESSOR_LITERATURE_PREFIX),
                                        );
                                      }}
                                      disabled={index === 0}
                                      className="text-xs font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="Monter"
                                    >
                                      <i className="fas fa-arrow-up"></i>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void moveNoteItem(
                                          note.courseId,
                                          note.id,
                                          'down',
                                          (entry) => entry.title.startsWith(PROFESSOR_LITERATURE_PREFIX),
                                        );
                                      }}
                                      disabled={index === professorLiteratureNotes.length - 1}
                                      className="text-xs font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="Descendre"
                                    >
                                      <i className="fas fa-arrow-down"></i>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteProfessorLiterature(note.id)}
                                      className="text-xs font-semibold text-rose-600 hover:text-rose-700"
                                    >
                                      Supprimer
                                    </button>
                                  </div>
                                )}
                              </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {menuSection === 'CONTENU' && (
                  <div className="space-y-8">
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Contenu</h1>
                      <p className="text-slate-600 text-lg">
                        {canEditResources
                          ? 'Ajoute ici des documents et liens généraux.'
                          : 'Documents généraux ajoutés par le professeur.'}
                      </p>
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
                        Contenus généraux ({filteredContentItems.length})
                      </h2>
                      {filteredContentItems.length === 0 && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-500">
                          Aucun document ou lien général pour le moment.
                        </div>
                      )}
                      {filteredContentItems.map((item, index) => (
                        <article key={item.id} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                          {canEditResources && editingContentId === item.id ? (
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                void saveEditContent(item);
                              }}
                              className="space-y-3"
                            >
                              <input
                                type="text"
                                value={editContentTitle}
                                onChange={(event) => setEditContentTitle(event.target.value)}
                                className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                              {editContentType === 'LIEN' ? (
                                <input
                                  type="url"
                                  value={editContentUrl}
                                  onChange={(event) => setEditContentUrl(event.target.value)}
                                  className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  required
                                />
                              ) : (
                                <p className="text-xs text-slate-500">
                                  Pour remplacer le PDF, supprimez-le puis ajoutez un nouveau fichier.
                                </p>
                              )}
                              <div className="flex items-center gap-2">
                                <button
                                  type="submit"
                                  className="rounded-xl bg-indigo-600 px-4 py-2 text-white text-sm font-bold hover:bg-indigo-700"
                                >
                                  Enregistrer
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditContent}
                                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
                                >
                                  Annuler
                                </button>
                              </div>
                            </form>
                          ) : (
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
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => { void moveContentItem(item.courseId, item.id, 'up'); }}
                                    disabled={index === 0}
                                    className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="Monter"
                                  >
                                    <i className="fas fa-arrow-up"></i>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { void moveContentItem(item.courseId, item.id, 'down'); }}
                                    disabled={index === filteredContentItems.length - 1}
                                    className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="Descendre"
                                  >
                                    <i className="fas fa-arrow-down"></i>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startEditContent(item)}
                                    className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                                  >
                                    Modifier
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteContentItem(item.id)}
                                    className="text-sm font-semibold text-rose-600 hover:text-rose-700"
                                  >
                                    Supprimer
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </article>
                      ))}
                    </div>

                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h2 className="text-2xl font-black text-slate-900 mb-2">Notes générales</h2>
                      <p className="text-slate-600 text-lg mb-6">
                        {canEditResources
                          ? 'Ajoute ici des notes générales pour tous les cours.'
                          : 'Notes générales ajoutées par le professeur.'}
                      </p>

                      {canEditResources && (
                        <form onSubmit={addEvernoteNote} className="space-y-4 mb-8">
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
                      )}

                      <div className="space-y-4">
                        <h3 className="text-xl font-black text-slate-900">
                          Notes générales ({filteredEvernoteNotes.length})
                        </h3>
                        {filteredEvernoteNotes.length === 0 && (
                          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-500">
                            Aucune note générale pour le moment.
                          </div>
                        )}
                        {filteredEvernoteNotes.map((note, index) => (
                          <article key={note.id} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                            {canEditResources && editingNoteId === note.id ? (
                              <form
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void saveEditNote(note);
                                }}
                                className="space-y-3"
                              >
                                <input
                                  type="text"
                                  value={editNoteTitle}
                                  onChange={(event) => setEditNoteTitle(event.target.value)}
                                  className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  required
                                />
                                <textarea
                                  value={editNoteContent}
                                  onChange={(event) => setEditNoteContent(event.target.value)}
                                  className="w-full min-h-24 rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  placeholder="Contenu (optionnel si lien)"
                                />
                                <input
                                  type="url"
                                  value={editNoteLink}
                                  onChange={(event) => setEditNoteLink(event.target.value)}
                                  className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  placeholder="https://www.evernote.com/..."
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    type="submit"
                                    className="rounded-xl bg-indigo-600 px-4 py-2 text-white text-sm font-bold hover:bg-indigo-700"
                                  >
                                    Enregistrer
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditNote}
                                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
                                  >
                                    Annuler
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <>
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
                                    <div className="flex items-center gap-3">
                                      <button
                                        type="button"
                                        onClick={() => { void moveNoteItem(note.courseId, note.id, 'up'); }}
                                        disabled={index === 0}
                                        className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Monter"
                                      >
                                        <i className="fas fa-arrow-up"></i>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { void moveNoteItem(note.courseId, note.id, 'down'); }}
                                        disabled={index === filteredEvernoteNotes.length - 1}
                                        className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Descendre"
                                      >
                                        <i className="fas fa-arrow-down"></i>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => startEditNote(note)}
                                        className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                                      >
                                        Modifier
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => deleteEvernoteNote(note.id)}
                                        className="text-sm font-semibold text-rose-600 hover:text-rose-700"
                                      >
                                        Supprimer
                                      </button>
                                    </div>
                                  )}
                                </div>
                                {note.content && (
                                  <p className="text-slate-700 mt-4 whitespace-pre-line">{note.content}</p>
                                )}
                              </>
                            )}
                          </article>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {menuSection === 'ANNONCES' && (
                  <div className="space-y-8">
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Annonces</h1>
                      <p className="text-slate-600 text-lg">
                        {canEditResources
                          ? 'Publie ici les annonces importantes pour toute la classe.'
                          : 'Consulte les annonces publiées par le professeur.'}
                      </p>
                    </div>

                    {canEditResources && (
                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-6">Publier une annonce</h2>
                        <form onSubmit={addEvernoteNote} className="space-y-4">
                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Titre</span>
                            <input
                              type="text"
                              value={noteTitle}
                              onChange={(event) => setNoteTitle(event.target.value)}
                              placeholder="Ex: Examen - date importante"
                              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              required
                            />
                          </label>
                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Message</span>
                            <textarea
                              value={noteContent}
                              onChange={(event) => setNoteContent(event.target.value)}
                              placeholder="Écris ton annonce ici..."
                              className="mt-2 w-full min-h-32 rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          </label>
                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Lien (optionnel)</span>
                            <input
                              type="url"
                              value={noteLink}
                              onChange={(event) => setNoteLink(event.target.value)}
                              placeholder="https://..."
                              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          </label>

                          <button
                            type="submit"
                            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors"
                          >
                            <i className="fas fa-plus"></i>
                            Publier l'annonce
                          </button>
                        </form>
                      </div>
                    )}

                    <div className="space-y-4">
                      <h2 className="text-2xl font-black text-slate-900">
                        Annonces ({announcementNotes.length})
                      </h2>
                      {announcementNotes.length === 0 && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-500">
                          Aucune annonce pour le moment.
                        </div>
                      )}
                      {announcementNotes.map((note, index) => (
                        <article key={note.id} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                          {canEditResources && editingNoteId === note.id ? (
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                void saveEditNote(note);
                              }}
                              className="space-y-3"
                            >
                              <input
                                type="text"
                                value={editNoteTitle}
                                onChange={(event) => setEditNoteTitle(event.target.value)}
                                className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                              <textarea
                                value={editNoteContent}
                                onChange={(event) => setEditNoteContent(event.target.value)}
                                className="w-full min-h-24 rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="Message de l'annonce"
                              />
                              <input
                                type="url"
                                value={editNoteLink}
                                onChange={(event) => setEditNoteLink(event.target.value)}
                                className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="https://..."
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  type="submit"
                                  className="rounded-xl bg-indigo-600 px-4 py-2 text-white text-sm font-bold hover:bg-indigo-700"
                                >
                                  Enregistrer
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditNote}
                                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
                                >
                                  Annuler
                                </button>
                              </div>
                            </form>
                          ) : (
                            <>
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <h3 className="text-xl font-black text-slate-900">{note.title}</h3>
                                  <p className="text-sm text-slate-500 mt-1">
                                    Date de parution : {new Date(note.createdAt).toLocaleString('fr-FR')}
                                  </p>
                                  {note.link && (
                                    <a
                                      href={note.link}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-2 mt-3 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                                    >
                                      <i className="fas fa-up-right-from-square"></i>
                                      Ouvrir le lien
                                    </a>
                                  )}
                                </div>
                                {canEditResources && (
                                  <div className="flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={() => { void moveNoteItem(note.courseId, note.id, 'up'); }}
                                      disabled={index === 0}
                                      className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="Monter"
                                    >
                                      <i className="fas fa-arrow-up"></i>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { void moveNoteItem(note.courseId, note.id, 'down'); }}
                                      disabled={index === announcementNotes.length - 1}
                                      className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="Descendre"
                                    >
                                      <i className="fas fa-arrow-down"></i>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => startEditNote(note)}
                                      className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                                    >
                                      Modifier
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteEvernoteNote(note.id)}
                                      className="text-sm font-semibold text-rose-600 hover:text-rose-700"
                                    >
                                      Supprimer
                                    </button>
                                  </div>
                                )}
                              </div>
                              {note.content && (
                                <p className="text-slate-700 mt-4 whitespace-pre-line">{note.content}</p>
                              )}
                            </>
                          )}
                        </article>
                      ))}
                    </div>
                  </div>
                )}

                {menuSection === 'BALADO' && (
                  <div className="space-y-8">
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Comprendre les RP le temps d'un café.</h1>
                      <p className="text-slate-600 text-lg">
                        Une chance unique pour les étudiant(e)s universitaires, nouveaux diplômé(e)s, et jeunes professionnel(le)s pour découvrir des discussions exclusives avec des pros des RP. Écoutez aussi des étudiants(es) qui partagent leurs réflexions et discussions sur leur apprentissage en comm strat et relations publiques. Apprenez-en davantage sur certains concepts grâce à des plongées profondes (deep dive).
                      </p>
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
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Stépru le prof de comm</h1>
                      <p className="text-slate-600 text-lg">
                        Accès direct à notre agent conversationnel.
                      </p>
                    </div>

                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-6">
                        <h2 className="text-2xl font-black text-slate-900 mb-3">Disponible gratuitement pour les étudiant(e)s</h2>
                        <p className="text-slate-700 text-lg">
                          Cliquez sur le bouton ci-dessous pour ouvrir l'assistant chatGPT gratuitement et posez vos questions reliées au cours, à la communication et aux relations publiques.
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
                          <i className="fas fa-video text-orange-600"></i>
                          Prendre un rendez-vous
                        </h2>
                        <p className="text-slate-600 mb-6">
                          Réserve une plage horaire directement via le calendrier Zoom.
                        </p>
                        <a
                          href={zoomSchedulerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-white font-bold hover:bg-orange-600 transition-colors"
                        >
                          Ouvrir le calendrier Zoom
                        </a>
                      </div>

                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm lg:col-span-2">
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

                      {canEditResources && (
                        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm lg:col-span-2">
                          <h2 className="text-2xl font-black text-slate-900 mb-2 flex items-center gap-2">
                            <i className="fas fa-chart-line text-indigo-600"></i>
                            Compteur d'accès à l'app
                          </h2>
                          <p className="text-slate-600 mb-6">
                            Statistiques des connexions réussies (visites).
                          </p>

                          {accessMetricsLoading && (
                            <p className="text-slate-500">Chargement des statistiques...</p>
                          )}

                          {accessMetricsError && (
                            <p className="text-rose-600">{accessMetricsError}</p>
                          )}

                          {!accessMetricsLoading && !accessMetricsError && accessMetrics && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                              <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                                <p className="text-xs uppercase tracking-wider text-slate-500 font-bold">Total</p>
                                <p className="text-3xl font-black text-slate-900">{accessMetrics.total}</p>
                              </div>
                              <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                                <p className="text-xs uppercase tracking-wider text-slate-500 font-bold">Aujourd'hui</p>
                                <p className="text-3xl font-black text-slate-900">{accessMetrics.today}</p>
                              </div>
                              <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                                <p className="text-xs uppercase tracking-wider text-slate-500 font-bold">Étudiants</p>
                                <p className="text-3xl font-black text-slate-900">{accessMetrics.student}</p>
                              </div>
                              <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                                <p className="text-xs uppercase tracking-wider text-slate-500 font-bold">Professeur</p>
                                <p className="text-3xl font-black text-slate-900">{accessMetrics.professor}</p>
                              </div>
                            </div>
                          )}

                          {!accessMetricsLoading && !accessMetricsError && accessMetrics && (
                            <p className="text-sm text-slate-500 mt-4">
                              Dernier accès: {accessMetrics.lastAccessAt
                                ? new Date(accessMetrics.lastAccessAt).toLocaleString('fr-FR')
                                : 'Aucun accès enregistré'}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>

            <footer className="mt-10 rounded-2xl border border-slate-200 bg-white px-6 py-4 text-xs text-slate-500 shadow-sm">
              <p>Ⓒ Stéphane Prud&apos;homme, Tous droits réservés 2026</p>
              <p className="mt-1">
                Partage, reproduction, utilisation du matériel avec approbation préliminaire et pour des fins éducatives seulement
              </p>
            </footer>
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
