
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Topic, AppView, StudySession, Flashcard, FlashcardCommonMistake } from './types.ts';
import { INITIAL_TOPICS } from './constants.ts';
import ciLogo from './assets/ci-logo.png';
import {
  checkAuthStatus,
  createRecruitmentOffer,
  createCourseFlashcard,
  createCourseContent,
  createEvernoteNote,
  getAccessMetrics,
  getAnalyticsSummary,
  listBlogPosts,
  listContactRequests,
  listCourseFlashcards,
  listCourseContent,
  listEvernoteNotes,
  listRecruitmentOffers,
  loginWithPassword,
  logout,
  removeContactRequest,
  removeCourseFlashcard,
  removeCourseContent,
  removeEvernoteNote,
  removeRecruitmentOffer,
  saveCourseOrder,
  submitContactRequest,
  trackAnalyticsEvent,
  unlockCourseWithPassword,
  updateCourseFlashcard,
  updateCourseContent,
  updateEvernoteNote,
  updateRecruitmentOffer,
  type AccessMetrics,
  type AnalyticsSummary,
  type BlogPost,
  type ContactRequest,
  type EvernoteNote,
  type LearningContentItem,
  type OrderEntityType,
  type RecruitmentOffer,
  type UserRole,
} from './services/openaiService.ts';
import FlashcardDeck from './components/FlashcardDeck.tsx';

type MenuSection = 'ACCUEIL' | 'CONTENU' | 'ANNONCES' | 'MEMO' | 'BALADO' | 'BLOG' | 'ASSISTANT' | 'RECRUTEMENT' | 'CONTACT';
type PodcastEpisode = {
  title: string;
  link?: string;
  pubDate?: string;
  description?: string;
  audioUrl?: string;
};
type AnnouncementMeta = {
  message: string;
  targetCourseId?: string;
  expiresAt?: string;
  important?: boolean;
  pinned?: boolean;
};
type AnnouncementItem = EvernoteNote & AnnouncementMeta;
type RecruitmentOpportunityType = RecruitmentOffer['opportunityType'];
type RecruitmentEmploymentType = NonNullable<RecruitmentOffer['employmentType']>;
type FavoriteKind = 'resource' | 'note' | 'literature';
type FavoriteItem = {
  id: string;
  kind: FavoriteKind;
  courseId: string;
  title: string;
  url?: string;
};
type StudentCourseProgress = {
  lastVisitedAt: string | null;
  viewedDocumentIds: string[];
  reviewedFlashcards: number;
};
type SearchResultItem = {
  id: string;
  kind: 'content' | 'note' | 'announcement' | 'literature';
  courseId: string;
  title: string;
  description: string;
  url?: string;
  createdAt: string;
};
type DuplicateModalState =
  | { kind: 'content'; item: LearningContentItem }
  | { kind: 'flashcard'; item: Flashcard }
  | null;

const GENERAL_COURSE_ID = 'general';
const ANNOUNCEMENTS_COURSE_ID = 'announcements';
const PROFESSOR_PROFILE_PREFIX = 'professor-profile:';
const PROFESSOR_BIO_TITLE = '__PROF_BIO__';
const PROFESSOR_SOCIAL_PREFIX = '[SOCIAL] ';
const PROFESSOR_PUBLICATION_PREFIX = '[PUBLICATION] ';
const PROFESSOR_LITERATURE_PREFIX = '[LITERATURE] ';
const ARCHIVED_RESOURCE_PREFIX = '[ARCHIVED] ';
const FAVORITES_STORAGE_KEY = 'eduboost_favorites_v1';
const STUDENT_PROGRESS_STORAGE_KEY = 'eduboost_student_progress_v1';
const ONBOARDING_STORAGE_KEY = 'eduboost_onboarding_seen_v1';
const CONTACT_REQUESTS_LAST_SEEN_STORAGE_KEY = 'eduboost_contact_requests_last_seen_v1';
const ANNOUNCEMENTS_LAST_SEEN_STORAGE_KEY = 'eduboost_announcements_last_seen_v1';
const CONTENT_LAST_SEEN_STORAGE_KEY = 'eduboost_content_last_seen_v1';
const RECRUITMENT_LAST_SEEN_STORAGE_KEY = 'eduboost_recruitment_last_seen_v1';
const PODCAST_LAST_SEEN_STORAGE_KEY = 'eduboost_podcast_last_seen_v1';
const BLOG_LAST_SEEN_STORAGE_KEY = 'eduboost_blog_last_seen_v1';
const NEW_ITEM_WINDOW_DAYS = 7;
const CONTACT_GENERAL_OPTION = 'Mot de passe général de l’appli';
const CONTACT_COURSE_OPTIONS = [
  'Relations médias et influenceurs',
  'Relations de presse',
  'Intro à la comm strat',
  'Théories de la communication',
  'Gérer la réputation',
  'Influence',
];
const RECRUITMENT_TYPE_OPTIONS: { value: RecruitmentOpportunityType; label: string }[] = [
  { value: 'STAGE_REMUNERE', label: 'Stage (rémunéré)' },
  { value: 'STAGE_NON_REMUNERE', label: 'Stage (non rémunéré)' },
  { value: 'EMPLOI', label: 'Emploi' },
  { value: 'EXPERIENCE_BENEVOLE', label: 'Expérience bénévole' },
];
const RECRUITMENT_EMPLOYMENT_OPTIONS: { value: RecruitmentEmploymentType; label: string }[] = [
  { value: 'TEMPS_PLEIN', label: 'Temps plein' },
  { value: 'TEMPS_PARTIEL', label: 'Temps partiel' },
  { value: 'EMPLOI_ETE', label: "Emploi d'été" },
];
const RECRUITMENT_EXPERIENCE_OPTIONS = [
  "Étudiant(e)s de 2e année de baccalauréat en communication",
  "Étudiant(e)s de 3e année de baccalauréat en communication",
  "Nouveaux diplômé(e)s, moins de 1 an d'expérience en communication",
  "2 ans d'expérience professionnelle en communication",
  "3 ans d'expérience professionnelle en communication",
];

const isRecentDate = (value?: string, days = NEW_ITEM_WINDOW_DAYS) => {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000;
};

const readLocalObject = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (_error) {
    return fallback;
  }
};

const writeLocalObject = <T,>(key: string, value: T) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const parseAnnouncementMeta = (note: EvernoteNote): AnnouncementItem => {
  let parsed: Partial<AnnouncementMeta> = {};
  if (note.content) {
    try {
      parsed = JSON.parse(note.content) as Partial<AnnouncementMeta>;
    } catch (_error) {
      parsed = {};
    }
  }
  const hasStructuredMessage = typeof parsed.message === 'string';
  return {
    ...note,
    message: hasStructuredMessage ? parsed.message || '' : note.content || '',
    targetCourseId: typeof parsed.targetCourseId === 'string' ? parsed.targetCourseId : '',
    expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : '',
    important: Boolean(parsed.important),
    pinned: Boolean(parsed.pinned),
  };
};

const serializeAnnouncementMeta = (input: AnnouncementMeta) =>
  JSON.stringify({
    message: input.message,
    targetCourseId: input.targetCourseId || '',
    expiresAt: input.expiresAt || '',
    important: Boolean(input.important),
    pinned: Boolean(input.pinned),
  });

const isArchivedResource = (item: LearningContentItem) => item.title.startsWith(ARCHIVED_RESOURCE_PREFIX);
const stripArchivedResourceTitle = (title: string) =>
  title.startsWith(ARCHIVED_RESOURCE_PREFIX) ? title.slice(ARCHIVED_RESOURCE_PREFIX.length).trimStart() : title;
const toArchivedResourceTitle = (title: string, archived: boolean) => {
  const clean = stripArchivedResourceTitle(title);
  return archived ? `${ARCHIVED_RESOURCE_PREFIX}${clean}` : clean;
};

const normalizeFlashcardDifficulty = (value?: number | string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(5, Math.round(parsed)));
};

const getFlashcardDifficultyLineStyle = (difficulty?: number | string) => {
  const level = normalizeFlashcardDifficulty(difficulty);
  const percentage = ((level - 1) / 4) * 100;
  return {
    level,
    percentage,
    barClassName: 'bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500',
  };
};

const createEmptyCommonMistake = (): FlashcardCommonMistake => ({
  answer: '',
  explanation: '',
});

const normalizeCommonMistakes = (items: FlashcardCommonMistake[] = []): FlashcardCommonMistake[] => {
  const normalized = items
    .map((item) => ({
      answer: (item.answer || '').trim(),
      explanation: (item.explanation || '').trim(),
    }))
    .filter((item) => item.answer && item.explanation);

  return normalized;
};

const ensureCommonMistakeDraftRows = (items: FlashcardCommonMistake[] = []): FlashcardCommonMistake[] => {
  const normalized = normalizeCommonMistakes(items);
  return normalized.length ? normalized : [createEmptyCommonMistake()];
};

const shuffleFlashcards = (cards: Flashcard[]): Flashcard[] => {
  const next = [...cards];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const App: React.FC = () => {
  const visibleTopics = INITIAL_TOPICS;
  const [view, setView] = useState<AppView>(AppView.DASHBOARD);
  const [menuSection, setMenuSection] = useState<MenuSection>('ACCUEIL');
  const [resourceCourseId, setResourceCourseId] = useState<string>(visibleTopics[0]?.id || '');
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [sessionData, setSessionData] = useState<Record<string, StudySession>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [flashcardModalCards, setFlashcardModalCards] = useState<Flashcard[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('student');
  const [authChecked, setAuthChecked] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [lockedCourseIds, setLockedCourseIds] = useState<string[]>([]);
  const [unlockedCourseIds, setUnlockedCourseIds] = useState<string[]>([]);
  const [coursePasswordTopic, setCoursePasswordTopic] = useState<Topic | null>(null);
  const [coursePasswordValue, setCoursePasswordValue] = useState('');
  const [coursePasswordError, setCoursePasswordError] = useState<string | null>(null);
  const [coursePasswordLoading, setCoursePasswordLoading] = useState(false);
  const [flashcardsByCourse, setFlashcardsByCourse] = useState<Record<string, Flashcard[]>>({});
  const [flashcardQuestion, setFlashcardQuestion] = useState('');
  const [flashcardAnswer, setFlashcardAnswer] = useState('');
  const [flashcardDifficulty, setFlashcardDifficulty] = useState('3');
  const [flashcardJustification, setFlashcardJustification] = useState('');
  const [flashcardCommonMistakes, setFlashcardCommonMistakes] = useState<FlashcardCommonMistake[]>([
    createEmptyCommonMistake(),
  ]);
  const [editingFlashcardId, setEditingFlashcardId] = useState<string | null>(null);
  const [editFlashcardQuestion, setEditFlashcardQuestion] = useState('');
  const [editFlashcardAnswer, setEditFlashcardAnswer] = useState('');
  const [editFlashcardDifficulty, setEditFlashcardDifficulty] = useState('3');
  const [editFlashcardJustification, setEditFlashcardJustification] = useState('');
  const [editFlashcardCommonMistakes, setEditFlashcardCommonMistakes] = useState<FlashcardCommonMistake[]>([
    createEmptyCommonMistake(),
  ]);
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
  const zoomSchedulerUrl = 'https://scheduler.zoom.us/stephane-prudhomme';
  const [podcastEpisodes, setPodcastEpisodes] = useState<PodcastEpisode[]>([]);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [podcastError, setPodcastError] = useState<string | null>(null);
  const [blogPosts, setBlogPosts] = useState<BlogPost[]>([]);
  const [blogLoading, setBlogLoading] = useState(false);
  const [blogError, setBlogError] = useState<string | null>(null);
  const [accessMetrics, setAccessMetrics] = useState<AccessMetrics | null>(null);
  const [accessMetricsLoading, setAccessMetricsLoading] = useState(false);
  const [accessMetricsError, setAccessMetricsError] = useState<string | null>(null);
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary | null>(null);
  const [analyticsSummaryLoading, setAnalyticsSummaryLoading] = useState(false);
  const [analyticsSummaryError, setAnalyticsSummaryError] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactUniversity, setContactUniversity] = useState('');
  const [contactCourseGroup, setContactCourseGroup] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSelections, setContactSelections] = useState<string[]>([]);
  const [contactSubmitLoading, setContactSubmitLoading] = useState(false);
  const [contactSubmitError, setContactSubmitError] = useState<string | null>(null);
  const [contactSubmitSuccess, setContactSubmitSuccess] = useState<string | null>(null);
  const [contactRequests, setContactRequests] = useState<ContactRequest[]>([]);
  const [contactRequestsLoading, setContactRequestsLoading] = useState(false);
  const [contactRequestsError, setContactRequestsError] = useState<string | null>(null);
  const [contactDeletingId, setContactDeletingId] = useState<string | null>(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactRequestsLastSeenAt, setContactRequestsLastSeenAt] = useState<string>(
    () => readLocalObject<string>(CONTACT_REQUESTS_LAST_SEEN_STORAGE_KEY, ''),
  );
  const [announcementsLastSeenAt, setAnnouncementsLastSeenAt] = useState<string>(
    () => readLocalObject<string>(ANNOUNCEMENTS_LAST_SEEN_STORAGE_KEY, ''),
  );
  const [contentLastSeenAt, setContentLastSeenAt] = useState<string>(
    () => readLocalObject<string>(CONTENT_LAST_SEEN_STORAGE_KEY, ''),
  );
  const [recruitmentLastSeenAt, setRecruitmentLastSeenAt] = useState<string>(
    () => readLocalObject<string>(RECRUITMENT_LAST_SEEN_STORAGE_KEY, ''),
  );
  const [podcastLastSeenAt, setPodcastLastSeenAt] = useState<string>(
    () => readLocalObject<string>(PODCAST_LAST_SEEN_STORAGE_KEY, ''),
  );
  const [blogLastSeenAt, setBlogLastSeenAt] = useState<string>(
    () => readLocalObject<string>(BLOG_LAST_SEEN_STORAGE_KEY, ''),
  );
  const [recruitmentOffers, setRecruitmentOffers] = useState<RecruitmentOffer[]>([]);
  const [recruitmentLoading, setRecruitmentLoading] = useState(false);
  const [recruitmentError, setRecruitmentError] = useState<string | null>(null);
  const [recruitmentTitle, setRecruitmentTitle] = useState('');
  const [recruitmentOpportunityType, setRecruitmentOpportunityType] = useState<RecruitmentOpportunityType>('STAGE_REMUNERE');
  const [recruitmentEmploymentType, setRecruitmentEmploymentType] = useState<RecruitmentEmploymentType>('TEMPS_PLEIN');
  const [recruitmentCandidateExperienceLevels, setRecruitmentCandidateExperienceLevels] = useState<string[]>([]);
  const [recruitmentCompanyName, setRecruitmentCompanyName] = useState('');
  const [recruitmentHourlySalary, setRecruitmentHourlySalary] = useState('');
  const [recruitmentCompanyLogoUrl, setRecruitmentCompanyLogoUrl] = useState('');
  const [recruitmentCompanyWebsiteUrl, setRecruitmentCompanyWebsiteUrl] = useState('');
  const [recruitmentDescription, setRecruitmentDescription] = useState('');
  const [recruitmentApplyBy, setRecruitmentApplyBy] = useState('');
  const [recruitmentApplyUrl, setRecruitmentApplyUrl] = useState('');
  const [editingRecruitmentId, setEditingRecruitmentId] = useState<string | null>(null);
  const [editRecruitmentTitle, setEditRecruitmentTitle] = useState('');
  const [editRecruitmentOpportunityType, setEditRecruitmentOpportunityType] = useState<RecruitmentOpportunityType>('STAGE_REMUNERE');
  const [editRecruitmentEmploymentType, setEditRecruitmentEmploymentType] = useState<RecruitmentEmploymentType>('TEMPS_PLEIN');
  const [editRecruitmentCandidateExperienceLevels, setEditRecruitmentCandidateExperienceLevels] = useState<string[]>([]);
  const [editRecruitmentCompanyName, setEditRecruitmentCompanyName] = useState('');
  const [editRecruitmentHourlySalary, setEditRecruitmentHourlySalary] = useState('');
  const [editRecruitmentCompanyLogoUrl, setEditRecruitmentCompanyLogoUrl] = useState('');
  const [editRecruitmentCompanyWebsiteUrl, setEditRecruitmentCompanyWebsiteUrl] = useState('');
  const [editRecruitmentDescription, setEditRecruitmentDescription] = useState('');
  const [editRecruitmentApplyBy, setEditRecruitmentApplyBy] = useState('');
  const [editRecruitmentApplyUrl, setEditRecruitmentApplyUrl] = useState('');
  const [recruitmentLogoInputKey, setRecruitmentLogoInputKey] = useState(0);
  const [editRecruitmentLogoInputKey, setEditRecruitmentLogoInputKey] = useState(0);
  const [previewAsStudent, setPreviewAsStudent] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [studentProgressByCourse, setStudentProgressByCourse] = useState<Record<string, StudentCourseProgress>>({});
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementMessage, setAnnouncementMessage] = useState('');
  const [announcementLink, setAnnouncementLink] = useState('');
  const [announcementTargetCourseId, setAnnouncementTargetCourseId] = useState('');
  const [announcementExpiresAt, setAnnouncementExpiresAt] = useState('');
  const [announcementImportant, setAnnouncementImportant] = useState(false);
  const [announcementPinned, setAnnouncementPinned] = useState(false);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null);
  const [editAnnouncementTitle, setEditAnnouncementTitle] = useState('');
  const [editAnnouncementMessage, setEditAnnouncementMessage] = useState('');
  const [editAnnouncementLink, setEditAnnouncementLink] = useState('');
  const [editAnnouncementTargetCourseId, setEditAnnouncementTargetCourseId] = useState('');
  const [editAnnouncementExpiresAt, setEditAnnouncementExpiresAt] = useState('');
  const [editAnnouncementImportant, setEditAnnouncementImportant] = useState(false);
  const [editAnnouncementPinned, setEditAnnouncementPinned] = useState(false);
  const [announcementFilter, setAnnouncementFilter] = useState<'ALL' | 'GENERAL' | 'CURRENT' | string>('ALL');
  const [duplicateState, setDuplicateState] = useState<DuplicateModalState>(null);
  const [duplicateTargetCourseId, setDuplicateTargetCourseId] = useState('');
  const lastTrackedViewRef = useRef<string>('');
  const effectiveUserRole: UserRole = previewAsStudent ? 'student' : userRole;
  const isProfessor = userRole === 'professor';
  const canEditResources = isProfessor && !previewAsStudent;
  const accessibleTopicIds = useMemo(
    () =>
      visibleTopics
        .filter((topic) => isProfessor || !lockedCourseIds.includes(topic.id) || unlockedCourseIds.includes(topic.id))
        .map((topic) => topic.id),
    [visibleTopics, isProfessor, lockedCourseIds, unlockedCourseIds],
  );
  const isStudentLockedCourse = (courseId: string) =>
    effectiveUserRole === 'student' && lockedCourseIds.includes(courseId) && !unlockedCourseIds.includes(courseId);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const auth = await checkAuthStatus();
        setIsAuthenticated(auth.authenticated);
        setUserRole(auth.role);
        setUnlockedCourseIds(auth.unlockedCourseIds);
        setLockedCourseIds(auth.lockedCourseIds);
      } catch (_error) {
        setIsAuthenticated(false);
        setUserRole('student');
        setUnlockedCourseIds([]);
        setLockedCourseIds([]);
      } finally {
        setAuthChecked(true);
      }
    };

    void initAuth();
  }, []);

  useEffect(() => {
    setFavorites(readLocalObject<FavoriteItem[]>(FAVORITES_STORAGE_KEY, []));
    setStudentProgressByCourse(readLocalObject<Record<string, StudentCourseProgress>>(STUDENT_PROGRESS_STORAGE_KEY, {}));
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
    const isTopicCourse = visibleTopics.some((topic) => topic.id === resourceCourseId);
    if (!authChecked || !isAuthenticated || !resourceCourseId || !isTopicCourse) return;

    const loadFlashcards = async () => {
      try {
        const flashcards = await listCourseFlashcards(resourceCourseId);
        setFlashcardsByCourse((prev) => ({ ...prev, [resourceCourseId]: flashcards }));
      } catch (error) {
        console.error(error);
      }
    };

    void loadFlashcards();
  }, [authChecked, isAuthenticated, resourceCourseId, visibleTopics]);

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
      if (menuSection !== 'BALADO' && menuSection !== 'ACCUEIL') return;

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
    const loadBlogPosts = async () => {
      if (!authChecked || !isAuthenticated) return;
      if (menuSection !== 'BLOG' && menuSection !== 'ACCUEIL') return;

      setBlogLoading(true);
      setBlogError(null);
      try {
        const response = await listBlogPosts();
        setBlogPosts(response);
      } catch (error) {
        console.error(error);
        setBlogError(error instanceof Error ? error.message : 'Impossible de charger les articles du blog.');
      } finally {
        setBlogLoading(false);
      }
    };

    void loadBlogPosts();
  }, [authChecked, isAuthenticated, menuSection]);

  useEffect(() => {
    const loadAccessMetrics = async () => {
      if (!authChecked || !isAuthenticated || !isProfessor) return;
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
  }, [authChecked, isAuthenticated, menuSection, isProfessor]);

  useEffect(() => {
    const loadAnalyticsSummary = async () => {
      if (!authChecked || !isAuthenticated || !isProfessor) return;
      if (menuSection !== 'CONTACT') return;

      setAnalyticsSummaryLoading(true);
      setAnalyticsSummaryError(null);
      try {
        const summary = await getAnalyticsSummary();
        setAnalyticsSummary(summary);
      } catch (error) {
        console.error(error);
        setAnalyticsSummaryError('Impossible de charger les statistiques détaillées pour le moment.');
      } finally {
        setAnalyticsSummaryLoading(false);
      }
    };

    void loadAnalyticsSummary();
  }, [authChecked, isAuthenticated, menuSection, isProfessor]);

  useEffect(() => {
    const loadContactRequests = async (foreground = false) => {
      if (!authChecked || !isAuthenticated || !isProfessor) return;

      if (foreground) {
        setContactRequestsLoading(true);
        setContactRequestsError(null);
      }

      try {
        const requests = await listContactRequests();
        setContactRequests(requests);
      } catch (error) {
        console.error(error);
        if (foreground) {
          setContactRequestsError('Impossible de charger les demandes de contact pour le moment.');
        }
      } finally {
        if (foreground) {
          setContactRequestsLoading(false);
        }
      }
    };

    void loadContactRequests(menuSection === 'CONTACT');

    if (isProfessor) {
      const intervalId = window.setInterval(() => {
        void loadContactRequests(false);
      }, 60000);
      return () => window.clearInterval(intervalId);
    }
  }, [authChecked, isAuthenticated, menuSection, isProfessor]);

  useEffect(() => {
    const loadRecruitmentOffers = async () => {
      if (!authChecked || !isAuthenticated) return;
      if (menuSection !== 'RECRUTEMENT' && menuSection !== 'ACCUEIL') return;

      setRecruitmentLoading(true);
      setRecruitmentError(null);
      try {
        const offers = await listRecruitmentOffers();
        setRecruitmentOffers(offers);
      } catch (error) {
        console.error(error);
        setRecruitmentError('Impossible de charger les offres pour le moment.');
      } finally {
        setRecruitmentLoading(false);
      }
    };

    void loadRecruitmentOffers();
  }, [authChecked, isAuthenticated, menuSection]);

  useEffect(() => {
    if (!isProfessor || menuSection !== 'CONTACT' || contactRequests.length === 0) return;
    const latestSeen = contactRequests[0]?.createdAt || '';
    if (!latestSeen || latestSeen === contactRequestsLastSeenAt) return;
    writeLocalObject(CONTACT_REQUESTS_LAST_SEEN_STORAGE_KEY, latestSeen);
    setContactRequestsLastSeenAt(latestSeen);
  }, [isProfessor, menuSection, contactRequests, contactRequestsLastSeenAt]);

  useEffect(() => {
    const preloadDashboardData = async () => {
      if (!authChecked || !isAuthenticated) return;
      const generalCourseIds = [GENERAL_COURSE_ID, ANNOUNCEMENTS_COURSE_ID, ...accessibleTopicIds];
      const profileCourseIds = isProfessor
        ? accessibleTopicIds.map((courseId) => `${PROFESSOR_PROFILE_PREFIX}${courseId}`)
        : [];

      try {
        const [noteSets, resourceSets, flashcardSets, profileNoteSets, profileResourceSets] = await Promise.all([
          Promise.all(generalCourseIds.map((courseId) => listEvernoteNotes(courseId).catch(() => []))),
          Promise.all(generalCourseIds.map((courseId) => listCourseContent(courseId).catch(() => []))),
          Promise.all(accessibleTopicIds.map((courseId) => listCourseFlashcards(courseId).catch(() => []))),
          Promise.all(profileCourseIds.map((courseId) => listEvernoteNotes(courseId).catch(() => []))),
          Promise.all(profileCourseIds.map((courseId) => listCourseContent(courseId).catch(() => []))),
        ]);

        setEvernoteNotesByCourse((prev) => {
          const next = { ...prev };
          generalCourseIds.forEach((courseId, index) => {
            next[courseId] = noteSets[index] as EvernoteNote[];
          });
          profileCourseIds.forEach((courseId, index) => {
            next[courseId] = profileNoteSets[index] as EvernoteNote[];
          });
          return next;
        });

        setContentItemsByCourse((prev) => {
          const next = { ...prev };
          generalCourseIds.forEach((courseId, index) => {
            next[courseId] = resourceSets[index] as LearningContentItem[];
          });
          profileCourseIds.forEach((courseId, index) => {
            next[courseId] = profileResourceSets[index] as LearningContentItem[];
          });
          return next;
        });

        setFlashcardsByCourse((prev) => {
          const next = { ...prev };
          accessibleTopicIds.forEach((courseId, index) => {
            next[courseId] = flashcardSets[index] as Flashcard[];
          });
          return next;
        });
      } catch (error) {
        console.error(error);
      }
    };

    void preloadDashboardData();
  }, [authChecked, isAuthenticated, accessibleTopicIds, isProfessor]);

  useEffect(() => {
    if (!authChecked || !isAuthenticated || effectiveUserRole !== 'student') return;
    if (readLocalObject<boolean>(ONBOARDING_STORAGE_KEY, false)) return;
    setShowOnboarding(true);
  }, [authChecked, isAuthenticated, effectiveUserRole]);

  useEffect(() => {
    if (!isAuthenticated || effectiveUserRole !== 'student' || menuSection !== 'ANNONCES') return;
    const latestVisibleAnnouncement = [...(evernoteNotesByCourse[ANNOUNCEMENTS_COURSE_ID] || [])]
      .map((note) => parseAnnouncementMeta(note))
      .filter((announcement) => !announcement.expiresAt || new Date(announcement.expiresAt).getTime() >= Date.now())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    const latestSeen = latestVisibleAnnouncement?.createdAt || '';
    if (!latestSeen || latestSeen === announcementsLastSeenAt) return;
    writeLocalObject(ANNOUNCEMENTS_LAST_SEEN_STORAGE_KEY, latestSeen);
    setAnnouncementsLastSeenAt(latestSeen);
  }, [isAuthenticated, effectiveUserRole, menuSection, evernoteNotesByCourse, announcementsLastSeenAt]);

  useEffect(() => {
    if (!isAuthenticated || effectiveUserRole !== 'student' || menuSection !== 'CONTENU') return;
    const currentNotes = evernoteNotesByCourse[resourceCourseId] || [];
    const currentContentItems = contentItemsByCourse[resourceCourseId] || [];
    const currentActiveContentItems = currentContentItems.filter((item) => !isArchivedResource(item));
    const latestContentTimestamp = [
      ...currentActiveContentItems.map((item) => item.createdAt),
      ...currentNotes.map((note) => note.createdAt),
    ]
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
    if (!latestContentTimestamp || latestContentTimestamp === contentLastSeenAt) return;
    writeLocalObject(CONTENT_LAST_SEEN_STORAGE_KEY, latestContentTimestamp);
    setContentLastSeenAt(latestContentTimestamp);
  }, [isAuthenticated, effectiveUserRole, menuSection, evernoteNotesByCourse, contentItemsByCourse, resourceCourseId, contentLastSeenAt]);

  useEffect(() => {
    if (!isAuthenticated || effectiveUserRole !== 'student' || menuSection !== 'RECRUTEMENT') return;
    const latestVisibleOffer = [...recruitmentOffers]
      .filter((offer) => !isOfferExpired(offer))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    const latestSeen = latestVisibleOffer?.createdAt || '';
    if (!latestSeen || latestSeen === recruitmentLastSeenAt) return;
    writeLocalObject(RECRUITMENT_LAST_SEEN_STORAGE_KEY, latestSeen);
    setRecruitmentLastSeenAt(latestSeen);
  }, [isAuthenticated, effectiveUserRole, menuSection, recruitmentOffers, recruitmentLastSeenAt]);

  useEffect(() => {
    if (!isAuthenticated || effectiveUserRole !== 'student' || menuSection !== 'BALADO') return;
    const latestEpisode = [...podcastEpisodes].sort((a, b) => {
      const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return bTime - aTime;
    })[0];
    const latestSeen = latestEpisode?.pubDate || '';
    if (!latestSeen || latestSeen === podcastLastSeenAt) return;
    writeLocalObject(PODCAST_LAST_SEEN_STORAGE_KEY, latestSeen);
    setPodcastLastSeenAt(latestSeen);
  }, [isAuthenticated, effectiveUserRole, menuSection, podcastEpisodes, podcastLastSeenAt]);

  useEffect(() => {
    if (!isAuthenticated || effectiveUserRole !== 'student' || menuSection !== 'BLOG') return;
    const latestBlogPost = [...blogPosts].sort((a, b) => {
      const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return bTime - aTime;
    })[0];
    const latestSeen = latestBlogPost?.pubDate || '';
    if (!latestSeen || latestSeen === blogLastSeenAt) return;
    writeLocalObject(BLOG_LAST_SEEN_STORAGE_KEY, latestSeen);
    setBlogLastSeenAt(latestSeen);
  }, [isAuthenticated, effectiveUserRole, menuSection, blogPosts, blogLastSeenAt]);

  useEffect(() => {
    if (!authChecked || !isAuthenticated) return;
    const trackingKey = `${menuSection}:${view}:${selectedTopic?.id || resourceCourseId || 'global'}`;
    if (lastTrackedViewRef.current === trackingKey) return;
    lastTrackedViewRef.current = trackingKey;

    trackAppEvent({
      type: 'page_view',
      section: menuSection === 'ACCUEIL' && view === AppView.TOPIC_DETAIL ? 'COURS' : menuSection,
      courseId: selectedTopic?.id || resourceCourseId || undefined,
      label: selectedTopic?.title || resourceCourse?.title || menuSection,
    });

    if (menuSection === 'BALADO') {
      trackAppEvent({
        type: 'balado_open',
        section: 'BALADO',
        label: 'Page balado',
      });
    }
  }, [authChecked, isAuthenticated, menuSection, view, selectedTopic, resourceCourseId]);

  const handleAuthError = (error: unknown) => {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNAUTHORIZED') || message.includes('INVALID_CREDENTIALS')) {
      setIsAuthenticated(false);
      setUnlockedCourseIds([]);
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

  const saveFavorites = (next: FavoriteItem[]) => {
    setFavorites(next);
    writeLocalObject(FAVORITES_STORAGE_KEY, next);
  };

  const toggleFavorite = (item: FavoriteItem) => {
    setFavorites((current) => {
      const exists = current.some((entry) => entry.id === item.id && entry.kind === item.kind);
      const next = exists
        ? current.filter((entry) => !(entry.id === item.id && entry.kind === item.kind))
        : [item, ...current];
      writeLocalObject(FAVORITES_STORAGE_KEY, next);
      return next;
    });
  };

  const isFavorite = (id: string, kind: FavoriteKind) =>
    favorites.some((entry) => entry.id === id && entry.kind === kind);

  const updateStudentProgress = (courseId: string, updater: (current: StudentCourseProgress) => StudentCourseProgress) => {
    setStudentProgressByCourse((current) => {
      const existing = current[courseId] || {
        lastVisitedAt: null,
        viewedDocumentIds: [],
        reviewedFlashcards: 0,
      };
      const next = {
        ...current,
        [courseId]: updater(existing),
      };
      writeLocalObject(STUDENT_PROGRESS_STORAGE_KEY, next);
      return next;
    });
  };

  const markCourseVisited = (courseId: string) => {
    updateStudentProgress(courseId, (current) => ({
      ...current,
      lastVisitedAt: new Date().toISOString(),
    }));
  };

  const markDocumentViewed = (courseId: string, documentId: string) => {
    updateStudentProgress(courseId, (current) => ({
      ...current,
      lastVisitedAt: new Date().toISOString(),
      viewedDocumentIds: Array.from(new Set([...(current.viewedDocumentIds || []), documentId])),
      reviewedFlashcards: current.reviewedFlashcards || 0,
    }));
  };

  const recordFlashcardReview = (courseId: string, count: number) => {
    updateStudentProgress(courseId, (current) => ({
      ...current,
      lastVisitedAt: new Date().toISOString(),
      viewedDocumentIds: current.viewedDocumentIds || [],
      reviewedFlashcards: Math.max(current.reviewedFlashcards || 0, count),
    }));
  };

  const trackAppEvent = (payload: Parameters<typeof trackAnalyticsEvent>[0]) => {
    void trackAnalyticsEvent(payload);
  };

  const trackExternalClick = (target: 'blog' | 'contact' | 'zoom' | 'spotify' | 'assistant', label?: string) => {
    trackAppEvent({
      type: 'external_click',
      section: menuSection,
      courseId: selectedTopic?.id || resourceCourseId,
      target,
      label,
    });
  };

  const toggleContactSelection = (value: string) => {
    setContactSelections((current) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value],
    );
  };

  const openStudentContactForm = (options?: { selections?: string[]; message?: string }) => {
    const nextSelections = Array.isArray(options?.selections)
      ? Array.from(new Set(options.selections.filter(Boolean)))
      : [];

    if (nextSelections.length) {
      setContactSelections((current) => Array.from(new Set([...current, ...nextSelections])));
    }

    if (options?.message) {
      setContactMessage((current) => current || options.message || '');
    }

    setContactSubmitError(null);
    setContactSubmitSuccess(null);
    setCoursePasswordTopic(null);
    setCoursePasswordValue('');
    setCoursePasswordError(null);

    if (isAuthenticated) {
      navigateToMenuSection('CONTACT');
      setShowContactModal(false);
      return;
    }

    setShowContactModal(true);
  };

  const handleSubmitContactRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setContactSubmitError(null);
    setContactSubmitSuccess(null);

    if (!contactSelections.length && !contactMessage.trim()) {
      setContactSubmitError('Ajoute un message ou choisis au moins un sujet.');
      return;
    }

    setContactSubmitLoading(true);
    try {
      await submitContactRequest({
        name: contactName,
        email: contactEmail,
        university: contactUniversity,
        courseGroup: contactCourseGroup,
        message: contactMessage,
        selections: contactSelections,
      });
      setContactName('');
      setContactEmail('');
      setContactUniversity('');
      setContactCourseGroup('');
      setContactMessage('');
      setContactSelections([]);
      setContactSubmitSuccess('Demande envoyée. Nous te répondrons rapidement.');
      trackAppEvent({
        type: 'external_click',
        section: 'CONTACT',
        target: 'contact',
        label: 'Formulaire interne envoyé',
      });
      if (isProfessor) {
        const requests = await listContactRequests();
        setContactRequests(requests);
      }
      if (showContactModal) {
        setShowContactModal(false);
      }
    } catch (error) {
      console.error(error);
      setContactSubmitError(getErrorMessage(error));
    } finally {
      setContactSubmitLoading(false);
    }
  };

  const handleDeleteContactRequest = async (id: string) => {
    setContactRequestsError(null);
    setContactDeletingId(id);
    try {
      await removeContactRequest(id);
      setContactRequests((current) => current.filter((request) => request.id !== id));
    } catch (error) {
      console.error(error);
      setContactRequestsError(getErrorMessage(error));
    } finally {
      setContactDeletingId(null);
    }
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError(null);

    try {
      const role = await loginWithPassword(password);
      setIsAuthenticated(true);
      setUserRole(role);
      setPassword('');
      setUnlockedCourseIds([]);
    } catch (error) {
      console.error(error);
      logout();
      setIsAuthenticated(false);
      setUserRole('student');
      setUnlockedCourseIds([]);
      setAuthError('Mot de passe incorrect. Réessayez.');
    }
  };

  const openTopic = (topic: Topic) => {
    setMenuSection('ACCUEIL');
    setResourceCourseId(topic.id);
    setSelectedTopic(topic);
    setView(AppView.TOPIC_DETAIL);
    markCourseVisited(topic.id);
    trackAppEvent({
      type: 'course_view',
      section: 'COURS',
      courseId: topic.id,
      label: topic.title,
    });

    if (sessionData[topic.id]) return;
    setSessionData((prev) => ({
      ...prev,
      [topic.id]: { topicId: topic.id, summary: '', flashcards: [] },
    }));
  };

  const startTopic = async (topic: Topic) => {
    if (userRole === 'professor' || !lockedCourseIds.includes(topic.id) || unlockedCourseIds.includes(topic.id)) {
      openTopic(topic);
      return;
    }

    setCoursePasswordTopic(topic);
    setCoursePasswordValue('');
    setCoursePasswordError(null);
  };

  const handleMemoCourseChange = (courseId: string) => {
    setResourceCourseId(courseId);
    const topic = visibleTopics.find((entry) => entry.id === courseId);
    if (!topic || !isStudentLockedCourse(courseId)) return;
    setCoursePasswordTopic(topic);
    setCoursePasswordValue('');
    setCoursePasswordError(null);
  };

  const handleCourseUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!coursePasswordTopic) return;

    setCoursePasswordError(null);
    setCoursePasswordLoading(true);
    try {
      const unlockedIds = await unlockCourseWithPassword(coursePasswordTopic.id, coursePasswordValue);
      setUnlockedCourseIds(unlockedIds);
      const topicToOpen = coursePasswordTopic;
      setCoursePasswordTopic(null);
      setCoursePasswordValue('');
      if (menuSection === 'MEMO') {
        setResourceCourseId(topicToOpen.id);
        await ensureCourseSession(topicToOpen.id, true);
      } else {
        openTopic(topicToOpen);
      }
    } catch (error) {
      console.error(error);
      setCoursePasswordError('Mot de passe du cours incorrect. Réessayez.');
    } finally {
      setCoursePasswordLoading(false);
    }
  };

  const openPasswordHelpForm = (courseTitle?: string, isGeneralAppPassword = false) => {
    const selections = isGeneralAppPassword
      ? [CONTACT_GENERAL_OPTION]
      : (courseTitle && CONTACT_COURSE_OPTIONS.includes(courseTitle) ? [courseTitle] : []);

    openStudentContactForm({ selections });
  };

  const renderContactRequestForm = () => (
    <form onSubmit={handleSubmitContactRequest} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-semibold text-slate-700">Nom</span>
          <input
            type="text"
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">Adresse courriel</span>
          <input
            type="email"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">Université</span>
          <input
            type="text"
            value={contactUniversity}
            onChange={(event) => setContactUniversity(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">Cours et groupe</span>
          <input
            type="text"
            value={contactCourseGroup}
            onChange={(event) => setContactCourseGroup(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Ex.: Influence, groupe 02"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-semibold text-slate-700">Message</span>
        <textarea
          value={contactMessage}
          onChange={(event) => setContactMessage(event.target.value)}
          rows={5}
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Écris ton message ici, même si tu ne choisis aucun cours ci-dessous."
        />
      </label>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm font-semibold text-slate-700 mb-3">Choisis un ou plusieurs sujets si c’est utile</p>

        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-xl bg-white border border-slate-200 px-4 py-3 cursor-pointer hover:border-indigo-300">
            <input
              type="checkbox"
              checked={contactSelections.includes(CONTACT_GENERAL_OPTION)}
              onChange={() => toggleContactSelection(CONTACT_GENERAL_OPTION)}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-slate-800 font-medium">{CONTACT_GENERAL_OPTION}</span>
          </label>

          <div className="rounded-xl bg-white border border-slate-200 px-4 py-4">
            <p className="text-sm font-semibold text-slate-700 mb-3">Mot de passe pour un ou des cours :</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {CONTACT_COURSE_OPTIONS.map((option) => (
                <label key={option} className="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 cursor-pointer hover:border-indigo-300">
                  <input
                    type="checkbox"
                    checked={contactSelections.includes(option)}
                    onChange={() => toggleContactSelection(option)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-slate-800">{option}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {contactSubmitError && (
        <p className="text-rose-600 font-medium">{contactSubmitError}</p>
      )}

      {contactSubmitSuccess && (
        <p className="text-emerald-600 font-medium">{contactSubmitSuccess}</p>
      )}

      <button
        type="submit"
        disabled={contactSubmitLoading}
        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors disabled:opacity-60"
      >
        <i className="fas fa-paper-plane"></i>
        {contactSubmitLoading ? 'Envoi en cours...' : 'Envoyer la demande'}
      </button>
    </form>
  );

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
  const parsedAnnouncements = announcementNotes
    .map((note) => parseAnnouncementMeta(note))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.important !== b.important) return a.important ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  const selectedTopicContentItems = selectedTopic
    ? (contentItemsByCourse[selectedTopic.id] || [])
    : [];
  const courseFlashcards = flashcardsByCourse[resourceCourseId] || [];
  const professorProfileCourseId = selectedTopic ? `${PROFESSOR_PROFILE_PREFIX}${selectedTopic.id}` : '';
  const professorProfileNotes = professorProfileCourseId ? (evernoteNotesByCourse[professorProfileCourseId] || []) : [];
  const professorBioNote = professorProfileNotes.find((note) => note.title === PROFESSOR_BIO_TITLE) || null;
  const professorLiteratureNotes = professorProfileNotes.filter((note) => note.title.startsWith(PROFESSOR_LITERATURE_PREFIX));
  const professorSectionItems = professorProfileCourseId ? (contentItemsByCourse[professorProfileCourseId] || []) : [];
  const professorSocialLinks = professorSectionItems.filter((item) => item.title.startsWith(PROFESSOR_SOCIAL_PREFIX));
  const professorPublications = professorSectionItems.filter((item) => item.title.startsWith(PROFESSOR_PUBLICATION_PREFIX));
  const activeGeneralContentItems = filteredContentItems.filter((item) => !isArchivedResource(item));
  const archivedGeneralContentItems = filteredContentItems.filter((item) => isArchivedResource(item));
  const activeSelectedTopicContentItems = selectedTopicContentItems.filter((item) => !isArchivedResource(item));
  const archivedSelectedTopicContentItems = selectedTopicContentItems.filter((item) => isArchivedResource(item));
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
  const ctaAccentClasses = [
    'text-indigo-600',
    'text-emerald-600',
    'text-rose-600',
    'text-amber-600',
    'text-sky-600',
    'text-violet-600',
  ];
  const mainMenuItems = [
    { label: 'Annonces', icon: 'fa-bullhorn', key: 'ANNONCES' as const },
    { label: 'Recrutement', icon: 'fa-briefcase', key: 'RECRUTEMENT' as const },
    { label: 'Accueil', icon: 'fa-border-all', key: 'ACCUEIL' as const },
    { label: 'Contenu', icon: 'fa-file-lines', key: 'CONTENU' as const },
    { label: 'Cours', icon: 'fa-graduation-cap', key: 'COURS' as const },
    { label: 'Cartes mémo', icon: 'fa-bolt', key: 'MEMO' as const },
    { label: 'Balado', icon: 'fa-podcast', key: 'BALADO' as const },
    { label: 'Blog', icon: 'fa-newspaper', key: 'BLOG' as const },
    { label: 'Assistant IA', icon: 'fa-robot', key: 'ASSISTANT' as const },
    { label: 'Contact', icon: 'fa-envelope', key: 'CONTACT' as const },
  ];
  const unreadContactRequestsCount = isProfessor
    ? contactRequests.filter((request) => {
        if (!contactRequestsLastSeenAt) return true;
        return new Date(request.createdAt).getTime() > new Date(contactRequestsLastSeenAt).getTime();
      }).length
    : 0;
  const visibleAnnouncementsForStudent = parsedAnnouncements.filter(
    (announcement) => !announcement.expiresAt || new Date(announcement.expiresAt).getTime() >= Date.now(),
  );
  const unseenAnnouncementCount = effectiveUserRole === 'student'
    ? visibleAnnouncementsForStudent.filter((announcement) => {
        if (!announcementsLastSeenAt) return true;
        return new Date(announcement.createdAt).getTime() > new Date(announcementsLastSeenAt).getTime();
      }).length
    : 0;
  const unseenGeneralContentCount = effectiveUserRole === 'student'
    ? [
        ...activeGeneralContentItems.map((item) => item.createdAt),
        ...filteredEvernoteNotes.map((note) => note.createdAt),
      ].filter((createdAt) => {
        if (!createdAt) return false;
        if (!contentLastSeenAt) return true;
        return new Date(createdAt).getTime() > new Date(contentLastSeenAt).getTime();
      }).length
    : 0;
  const unseenPodcastCount = effectiveUserRole === 'student'
    ? [...podcastEpisodes].filter((episode) => {
        if (!episode.pubDate) return false;
        if (!podcastLastSeenAt) return true;
        return new Date(episode.pubDate).getTime() > new Date(podcastLastSeenAt).getTime();
      }).length
    : 0;
  const unseenBlogCount = effectiveUserRole === 'student'
    ? [...blogPosts].filter((post) => {
        if (!post.pubDate) return false;
        if (!blogLastSeenAt) return true;
        return new Date(post.pubDate).getTime() > new Date(blogLastSeenAt).getTime();
      }).length
    : 0;
  const getMenuBadgeCount = (key: typeof mainMenuItems[number]['key']) => {
    if (key === 'ANNONCES') return unseenAnnouncementCount;
    if (key === 'CONTENU') return unseenGeneralContentCount;
    if (key === 'RECRUTEMENT') {
      return effectiveUserRole === 'student'
        ? visibleRecruitmentOffers.filter((offer) => {
            if (!recruitmentLastSeenAt) return true;
            return new Date(offer.createdAt).getTime() > new Date(recruitmentLastSeenAt).getTime();
          }).length
        : 0;
    }
    if (key === 'BALADO') return unseenPodcastCount;
    if (key === 'BLOG') return unseenBlogCount;
    if (key === 'CONTACT') return unreadContactRequestsCount;
    return 0;
  };
  const recentAnnouncementCount = parsedAnnouncements.filter(
    (announcement) => isRecentDate(announcement.createdAt) && (!announcement.expiresAt || new Date(announcement.expiresAt).getTime() >= Date.now()),
  ).length;
  const recentGeneralContentCount = activeGeneralContentItems.filter((item) => isRecentDate(item.createdAt)).length;
  const recruitmentPageViews =
    analyticsSummary?.pageViews.find((entry) => entry.section === 'RECRUTEMENT')?.count || 0;
  const monthlyRecruitmentPageViews =
    analyticsSummary?.monthly.pageViews.find((entry) => entry.section === 'RECRUTEMENT')?.count || 0;

  const filteredAnnouncements = parsedAnnouncements.filter((announcement) => {
    if (effectiveUserRole === 'student' && announcement.expiresAt && new Date(announcement.expiresAt).getTime() < Date.now()) {
      return false;
    }
    if (announcementFilter === 'ALL') return true;
    if (announcementFilter === 'GENERAL') return !announcement.targetCourseId;
    if (announcementFilter === 'CURRENT') {
      return !announcement.targetCourseId || announcement.targetCourseId === resourceCourseId || announcement.targetCourseId === selectedTopic?.id;
    }
    return announcement.targetCourseId === announcementFilter;
  });

  const courseUpdateMeta = visibleTopics.map((topic) => {
    const notes = evernoteNotesByCourse[topic.id] || [];
    const resources = (contentItemsByCourse[topic.id] || []).filter((item) => !isArchivedResource(item));
    const flashcards = flashcardsByCourse[topic.id] || [];
    const literatureNotes = (evernoteNotesByCourse[`${PROFESSOR_PROFILE_PREFIX}${topic.id}`] || []).filter((note) =>
      note.title.startsWith(PROFESSOR_LITERATURE_PREFIX),
    );
    const latestTimestamps = [
      ...notes.map((entry) => entry.createdAt),
      ...resources.map((entry) => entry.createdAt),
      ...flashcards.map((entry) => entry.createdAt || ''),
      ...literatureNotes.map((entry) => entry.createdAt),
    ].filter(Boolean);
    const latestAt = latestTimestamps.length
      ? latestTimestamps.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
      : '';
    const newItemsCount =
      notes.filter((entry) => isRecentDate(entry.createdAt)).length +
      resources.filter((entry) => isRecentDate(entry.createdAt)).length +
      flashcards.filter((entry) => isRecentDate(entry.createdAt)).length;
    return {
      topic,
      latestAt,
      newItemsCount,
      isNew: newItemsCount > 0,
    };
  });

  const recentUpdatedCourses = [...courseUpdateMeta]
    .filter((entry) => entry.latestAt)
    .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime())
    .slice(0, 4);

  const latestContentItems = [
    ...activeGeneralContentItems.map((item) => ({ ...item, label: 'Général' })),
    ...visibleTopics.flatMap((topic) =>
      ((contentItemsByCourse[topic.id] || []).filter((item) => !isArchivedResource(item))).map((item) => ({
        ...item,
        label: topic.title,
      })),
    ),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const searchResults: SearchResultItem[] = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length < 2) return [];
    const courseTitleFor = (courseId: string) => visibleTopics.find((topic) => topic.id === courseId)?.title || 'Général';

    const contentResults = Object.values(contentItemsByCourse)
      .flat()
      .filter((item) => !isArchivedResource(item))
      .map((item) => ({
        id: item.id,
        kind: 'content' as const,
        courseId: item.courseId,
        title: stripArchivedResourceTitle(item.title),
        description: `${item.type} • ${courseTitleFor(item.courseId)}`,
        url: item.url,
        createdAt: item.createdAt,
      }));

    const noteResults = Object.values(evernoteNotesByCourse)
      .flat()
      .filter((note) => !note.title.startsWith(PROFESSOR_BIO_TITLE) && !note.title.startsWith(PROFESSOR_LITERATURE_PREFIX))
      .map((note) => ({
        id: note.id,
        kind: 'note' as const,
        courseId: note.courseId,
        title: note.title,
        description: `${courseTitleFor(note.courseId)} • ${note.content || note.link || ''}`,
        url: note.link,
        createdAt: note.createdAt,
      }));

    const announcementResults = parsedAnnouncements.map((announcement) => ({
      id: announcement.id,
      kind: 'announcement' as const,
      courseId: announcement.targetCourseId || ANNOUNCEMENTS_COURSE_ID,
      title: announcement.title,
      description: announcement.message,
      url: announcement.link,
      createdAt: announcement.createdAt,
    }));

    const literatureResults = visibleTopics.flatMap((topic) =>
      ((evernoteNotesByCourse[`${PROFESSOR_PROFILE_PREFIX}${topic.id}`] || [])
        .filter((note) => note.title.startsWith(PROFESSOR_LITERATURE_PREFIX))
        .map((note) => ({
          id: note.id,
          kind: 'literature' as const,
          courseId: topic.id,
          title: note.title.replace(PROFESSOR_LITERATURE_PREFIX, '').trim(),
          description: note.content || '',
          url: note.link,
          createdAt: note.createdAt,
        }))),
    );

    return [...contentResults, ...noteResults, ...announcementResults, ...literatureResults]
      .filter((entry) =>
        `${entry.title} ${entry.description}`.toLowerCase().includes(query),
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 12);
  }, [searchQuery, contentItemsByCourse, evernoteNotesByCourse, parsedAnnouncements, visibleTopics]);

  const favoriteLookup = favorites.reduce<Record<string, FavoriteItem>>((acc, entry) => {
    acc[`${entry.kind}:${entry.id}`] = entry;
    return acc;
  }, {});

  const getCourseProgress = (courseId: string) => {
    const resources = (contentItemsByCourse[courseId] || []).filter((item) => !isArchivedResource(item));
    const flashcards = flashcardsByCourse[courseId] || [];
    const progress = studentProgressByCourse[courseId] || {
      lastVisitedAt: null,
      viewedDocumentIds: [],
      reviewedFlashcards: 0,
    };
    const resourceProgress = resources.length
      ? Math.min(1, (progress.viewedDocumentIds || []).length / resources.length)
      : 1;
    const flashcardProgress = flashcards.length
      ? Math.min(1, (progress.reviewedFlashcards || 0) / flashcards.length)
      : 1;
    const overall = Math.round(((resourceProgress + flashcardProgress) / 2) * 100);
    return {
      percentage: overall,
      viewedDocuments: (progress.viewedDocumentIds || []).length,
      reviewedFlashcards: progress.reviewedFlashcards || 0,
      lastVisitedAt: progress.lastVisitedAt,
    };
  };

  const todoItems = [
    latestContentItems[0]
      ? {
          id: `todo-content-${latestContentItems[0].id}`,
          title: 'Document à lire',
          description: latestContentItems[0].title,
          action: () => { void openContentItem(latestContentItems[0]); },
        }
      : null,
    podcastEpisodes[0]
      ? {
          id: 'todo-podcast',
          title: 'Épisode à écouter',
          description: podcastEpisodes[0].title,
          action: () => {
            navigateToMenuSection('BALADO');
          },
        }
      : null,
    visibleTopics.find((topic) => (flashcardsByCourse[topic.id] || []).length > 0)
      ? {
          id: 'todo-flashcards',
          title: 'Cartes à réviser',
          description: visibleTopics.find((topic) => (flashcardsByCourse[topic.id] || []).length > 0)?.title || '',
          action: () => {
            const topic = visibleTopics.find((entry) => (flashcardsByCourse[entry.id] || []).length > 0);
            if (!topic) return;
            setResourceCourseId(topic.id);
            navigateToMenuSection('MEMO');
          },
        }
      : null,
    {
      id: 'todo-blog',
      title: 'Article à consulter',
      description: 'Consulter le blog du prof',
      action: () => navigateToMenuSection('BLOG'),
    },
  ].filter(Boolean) as { id: string; title: string; description: string; action: () => void }[];

  const updateDraftCommonMistake = (
    scope: 'create' | 'edit',
    index: number,
    field: keyof FlashcardCommonMistake,
    value: string,
  ) => {
    const setter = scope === 'create' ? setFlashcardCommonMistakes : setEditFlashcardCommonMistakes;
    setter((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  };

  const addDraftCommonMistake = (scope: 'create' | 'edit') => {
    const setter = scope === 'create' ? setFlashcardCommonMistakes : setEditFlashcardCommonMistakes;
    setter((prev) => [...prev, createEmptyCommonMistake()]);
  };

  const removeDraftCommonMistake = (scope: 'create' | 'edit', index: number) => {
    const setter = scope === 'create' ? setFlashcardCommonMistakes : setEditFlashcardCommonMistakes;
    setter((prev) => {
      const next = prev.filter((_, itemIndex) => itemIndex !== index);
      return next.length ? next : [createEmptyCommonMistake()];
    });
  };

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

  const moveFlashcardItem = async (
    courseId: string,
    cardId: string,
    direction: 'up' | 'down',
  ) => {
    const current = flashcardsByCourse[courseId] || [];
    const index = current.findIndex((item) => item.id === cardId);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= current.length) return;

    const next = [...current];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setFlashcardsByCourse((prev) => ({ ...prev, [courseId]: next }));
    setSessionData((prev) => ({
      ...prev,
      [courseId]: prev[courseId] ? { ...prev[courseId], flashcards: next } : prev[courseId],
    }));

    try {
      await persistOrder('notes', `flashcards:${courseId}`, next.map((item) => item.id));
    } catch (error) {
      console.error(error);
      setFlashcardsByCourse((prev) => ({ ...prev, [courseId]: current }));
      setSessionData((prev) => ({
        ...prev,
        [courseId]: prev[courseId] ? { ...prev[courseId], flashcards: current } : prev[courseId],
      }));
      handleAuthError(error);
      alert(`Impossible de changer l'ordre des cartes. ${getErrorMessage(error)}`);
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

  const formatRecruitmentTypeLabel = (value: RecruitmentOpportunityType) =>
    RECRUITMENT_TYPE_OPTIONS.find((option) => option.value === value)?.label || value;

  const formatRecruitmentEmploymentLabel = (value?: RecruitmentOffer['employmentType']) =>
    RECRUITMENT_EMPLOYMENT_OPTIONS.find((option) => option.value === value)?.label || value || '';

  const isOfferExpired = (offer: RecruitmentOffer) => {
    if (!offer.applyBy) return false;
    const deadline = new Date(`${offer.applyBy}T23:59:59`).getTime();
    if (Number.isNaN(deadline)) return false;
    return deadline < Date.now();
  };

  const sortedRecruitmentOffers = [...recruitmentOffers].sort((a, b) => {
    const expiredA = isOfferExpired(a) ? 1 : 0;
    const expiredB = isOfferExpired(b) ? 1 : 0;
    if (expiredA !== expiredB) return expiredA - expiredB;
    const deadlineA = a.applyBy ? new Date(`${a.applyBy}T23:59:59`).getTime() : Number.MAX_SAFE_INTEGER;
    const deadlineB = b.applyBy ? new Date(`${b.applyBy}T23:59:59`).getTime() : Number.MAX_SAFE_INTEGER;
    if (deadlineA !== deadlineB) return deadlineA - deadlineB;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const visibleRecruitmentOffers = canEditResources
    ? sortedRecruitmentOffers
    : sortedRecruitmentOffers.filter((offer) => !isOfferExpired(offer));

  const handleRecruitmentLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>, mode: 'create' | 'edit') => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      if (!dataUrl.startsWith('data:image/')) {
        throw new Error("Le fichier doit être une image.");
      }
      if (mode === 'create') {
        setRecruitmentCompanyLogoUrl(dataUrl);
      } else {
        setEditRecruitmentCompanyLogoUrl(dataUrl);
      }
    } catch (error) {
      console.error(error);
      alert(`Impossible d'ajouter le logo. ${getErrorMessage(error)}`);
    } finally {
      event.target.value = '';
    }
  };

  const toggleRecruitmentExperienceSelection = (value: string, mode: 'create' | 'edit') => {
    const updater = (current: string[]) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];

    if (mode === 'create') {
      setRecruitmentCandidateExperienceLevels((current) => updater(current));
      return;
    }
    setEditRecruitmentCandidateExperienceLevels((current) => updater(current));
  };

  const resetRecruitmentForm = () => {
    setRecruitmentTitle('');
    setRecruitmentOpportunityType('STAGE_REMUNERE');
    setRecruitmentEmploymentType('TEMPS_PLEIN');
    setRecruitmentCandidateExperienceLevels([]);
    setRecruitmentCompanyName('');
    setRecruitmentHourlySalary('');
    setRecruitmentCompanyLogoUrl('');
    setRecruitmentCompanyWebsiteUrl('');
    setRecruitmentDescription('');
    setRecruitmentApplyBy('');
    setRecruitmentApplyUrl('');
    setRecruitmentLogoInputKey((current) => current + 1);
  };

  const addRecruitmentOffer = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const created = await createRecruitmentOffer({
        title: recruitmentTitle.trim(),
        opportunityType: recruitmentOpportunityType,
        employmentType: recruitmentOpportunityType === 'EMPLOI' ? recruitmentEmploymentType : '',
        candidateExperienceLevels: recruitmentCandidateExperienceLevels,
        companyName: recruitmentCompanyName.trim(),
        hourlySalary: recruitmentHourlySalary.trim() || undefined,
        companyLogoUrl: recruitmentCompanyLogoUrl || undefined,
        companyWebsiteUrl: recruitmentCompanyWebsiteUrl.trim() || undefined,
        description: recruitmentDescription.trim(),
        applyBy: recruitmentApplyBy,
        applyUrl: recruitmentApplyUrl.trim(),
      });
      setRecruitmentOffers((prev) => [created, ...prev]);
      resetRecruitmentForm();
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible d'ajouter l'offre. ${getErrorMessage(error)}`);
    }
  };

  const startEditRecruitmentOffer = (offer: RecruitmentOffer) => {
    setEditingRecruitmentId(offer.id);
    setEditRecruitmentTitle(offer.title);
    setEditRecruitmentOpportunityType(offer.opportunityType);
    setEditRecruitmentEmploymentType((offer.employmentType as RecruitmentEmploymentType) || 'TEMPS_PLEIN');
    setEditRecruitmentCandidateExperienceLevels(offer.candidateExperienceLevels || []);
    setEditRecruitmentCompanyName(offer.companyName);
    setEditRecruitmentHourlySalary(offer.hourlySalary || '');
    setEditRecruitmentCompanyLogoUrl(offer.companyLogoUrl || '');
    setEditRecruitmentCompanyWebsiteUrl(offer.companyWebsiteUrl || '');
    setEditRecruitmentDescription(offer.description);
    setEditRecruitmentApplyBy(offer.applyBy);
    setEditRecruitmentApplyUrl(offer.applyUrl);
  };

  const cancelEditRecruitmentOffer = () => {
    setEditingRecruitmentId(null);
    setEditRecruitmentTitle('');
    setEditRecruitmentOpportunityType('STAGE_REMUNERE');
    setEditRecruitmentEmploymentType('TEMPS_PLEIN');
    setEditRecruitmentCandidateExperienceLevels([]);
    setEditRecruitmentCompanyName('');
    setEditRecruitmentHourlySalary('');
    setEditRecruitmentCompanyLogoUrl('');
    setEditRecruitmentCompanyWebsiteUrl('');
    setEditRecruitmentDescription('');
    setEditRecruitmentApplyBy('');
    setEditRecruitmentApplyUrl('');
    setEditRecruitmentLogoInputKey((current) => current + 1);
  };

  const saveEditRecruitmentOffer = async (offer: RecruitmentOffer) => {
    try {
      const updated = await updateRecruitmentOffer(offer.id, {
        title: editRecruitmentTitle.trim(),
        opportunityType: editRecruitmentOpportunityType,
        employmentType: editRecruitmentOpportunityType === 'EMPLOI' ? editRecruitmentEmploymentType : '',
        candidateExperienceLevels: editRecruitmentCandidateExperienceLevels,
        companyName: editRecruitmentCompanyName.trim(),
        hourlySalary: editRecruitmentHourlySalary.trim() || undefined,
        companyLogoUrl: editRecruitmentCompanyLogoUrl || undefined,
        companyWebsiteUrl: editRecruitmentCompanyWebsiteUrl.trim() || undefined,
        description: editRecruitmentDescription.trim(),
        applyBy: editRecruitmentApplyBy,
        applyUrl: editRecruitmentApplyUrl.trim(),
      });
      setRecruitmentOffers((prev) => prev.map((entry) => (entry.id === offer.id ? updated : entry)));
      cancelEditRecruitmentOffer();
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible de modifier l'offre. ${getErrorMessage(error)}`);
    }
  };

  const deleteRecruitmentOffer = async (id: string) => {
    try {
      await removeRecruitmentOffer(id);
      setRecruitmentOffers((prev) => prev.filter((offer) => offer.id !== id));
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible de supprimer l'offre. ${getErrorMessage(error)}`);
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

  const toggleArchiveContentItem = async (item: LearningContentItem) => {
    try {
      const updated = await updateCourseContent(item.id, {
        type: item.type,
        title: toArchivedResourceTitle(item.title, !isArchivedResource(item)),
        url: item.url,
      });
      setContentItemsByCourse((prev) => ({
        ...prev,
        [item.courseId]: (prev[item.courseId] || []).map((entry) => (entry.id === item.id ? updated : entry)),
      }));
    } catch (error) {
      console.error(error);
      alert(`Impossible de modifier l'état d'archive. ${getErrorMessage(error)}`);
    }
  };

  const startDuplicateItem = (item: LearningContentItem | Flashcard, kind: 'content' | 'flashcard') => {
    setDuplicateTargetCourseId('');
    setDuplicateState({ kind, item } as DuplicateModalState);
  };

  const confirmDuplicate = async () => {
    if (!duplicateState || !duplicateTargetCourseId) return;

    try {
      if (duplicateState.kind === 'content') {
        const item = duplicateState.item as LearningContentItem;
        const created = await createCourseContent({
          courseId: duplicateTargetCourseId,
          type: item.type,
          title: stripArchivedResourceTitle(item.title),
          url: item.url,
        });
        setContentItemsByCourse((prev) => ({
          ...prev,
          [duplicateTargetCourseId]: [created, ...(prev[duplicateTargetCourseId] || [])],
        }));
      } else {
        const item = duplicateState.item as Flashcard;
        const created = await createCourseFlashcard({
          courseId: duplicateTargetCourseId,
          question: item.question,
          answer: item.answer,
          justification: item.justification || undefined,
          commonMistakes: item.commonMistakes || [],
        });
        setFlashcardsByCourse((prev) => ({
          ...prev,
          [duplicateTargetCourseId]: [created, ...(prev[duplicateTargetCourseId] || [])],
        }));
      }

      setDuplicateState(null);
      setDuplicateTargetCourseId('');
    } catch (error) {
      console.error(error);
      alert(`Impossible de dupliquer cet élément. ${getErrorMessage(error)}`);
    }
  };

  const addAnnouncement = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = announcementTitle.trim();
    const message = announcementMessage.trim();
    const rawLink = announcementLink.trim();
    if (!title || !message) return;

    try {
      const created = await createEvernoteNote({
        courseId: ANNOUNCEMENTS_COURSE_ID,
        title,
        content: serializeAnnouncementMeta({
          message,
          targetCourseId: announcementTargetCourseId || undefined,
          expiresAt: announcementExpiresAt || undefined,
          important: announcementImportant,
          pinned: announcementPinned,
        }),
        link: rawLink || undefined,
      });
      setEvernoteNotesByCourse((prev) => ({
        ...prev,
        [ANNOUNCEMENTS_COURSE_ID]: [created, ...(prev[ANNOUNCEMENTS_COURSE_ID] || [])],
      }));
      setAnnouncementTitle('');
      setAnnouncementMessage('');
      setAnnouncementLink('');
      setAnnouncementTargetCourseId('');
      setAnnouncementExpiresAt('');
      setAnnouncementImportant(false);
      setAnnouncementPinned(false);
    } catch (error) {
      console.error(error);
      alert(`Impossible de publier l'annonce. ${getErrorMessage(error)}`);
    }
  };

  const startEditAnnouncement = (note: AnnouncementItem) => {
    setEditingAnnouncementId(note.id);
    setEditAnnouncementTitle(note.title);
    setEditAnnouncementMessage(note.message || '');
    setEditAnnouncementLink(note.link || '');
    setEditAnnouncementTargetCourseId(note.targetCourseId || '');
    setEditAnnouncementExpiresAt(note.expiresAt || '');
    setEditAnnouncementImportant(Boolean(note.important));
    setEditAnnouncementPinned(Boolean(note.pinned));
  };

  const cancelEditAnnouncement = () => {
    setEditingAnnouncementId(null);
    setEditAnnouncementTitle('');
    setEditAnnouncementMessage('');
    setEditAnnouncementLink('');
    setEditAnnouncementTargetCourseId('');
    setEditAnnouncementExpiresAt('');
    setEditAnnouncementImportant(false);
    setEditAnnouncementPinned(false);
  };

  const saveEditAnnouncement = async (note: AnnouncementItem) => {
    const title = editAnnouncementTitle.trim();
    const message = editAnnouncementMessage.trim();
    if (!title || !message) return;

    try {
      const updated = await updateEvernoteNote(note.id, {
        title,
        content: serializeAnnouncementMeta({
          message,
          targetCourseId: editAnnouncementTargetCourseId || undefined,
          expiresAt: editAnnouncementExpiresAt || undefined,
          important: editAnnouncementImportant,
          pinned: editAnnouncementPinned,
        }),
        link: editAnnouncementLink.trim() || undefined,
      });
      setEvernoteNotesByCourse((prev) => ({
        ...prev,
        [ANNOUNCEMENTS_COURSE_ID]: (prev[ANNOUNCEMENTS_COURSE_ID] || []).map((entry) =>
          entry.id === updated.id ? updated : entry,
        ),
      }));
      cancelEditAnnouncement();
    } catch (error) {
      console.error(error);
      alert(`Impossible de modifier l'annonce. ${getErrorMessage(error)}`);
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

  const addCourseFlashcard = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resourceCourseId) return;
    const question = flashcardQuestion.trim();
    const answer = flashcardAnswer.trim();
    const difficulty = normalizeFlashcardDifficulty(flashcardDifficulty);
    const justification = flashcardJustification.trim();
    const commonMistakes = normalizeCommonMistakes(flashcardCommonMistakes);
    if (!question || !answer) return;

    try {
      const created = await createCourseFlashcard({
        courseId: resourceCourseId,
        question,
        answer,
        difficulty,
        justification: justification || undefined,
        commonMistakes,
      });
      const nextCards = [created, ...(flashcardsByCourse[resourceCourseId] || [])];
      setFlashcardsByCourse((prev) => ({
        ...prev,
        [resourceCourseId]: nextCards,
      }));
      setSessionData((prev) => ({
        ...prev,
        [resourceCourseId]: prev[resourceCourseId]
          ? { ...prev[resourceCourseId], flashcards: nextCards }
          : prev[resourceCourseId],
      }));
      setFlashcardQuestion('');
      setFlashcardAnswer('');
      setFlashcardDifficulty('3');
      setFlashcardJustification('');
      setFlashcardCommonMistakes([createEmptyCommonMistake()]);
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible d'ajouter la carte. ${getErrorMessage(error)}`);
    }
  };

  const startEditFlashcard = (card: Flashcard) => {
    setEditingFlashcardId(card.id);
    setEditFlashcardQuestion(card.question);
    setEditFlashcardAnswer(card.answer);
    setEditFlashcardDifficulty(String(normalizeFlashcardDifficulty(card.difficulty)));
    setEditFlashcardJustification(card.justification || '');
    setEditFlashcardCommonMistakes(ensureCommonMistakeDraftRows(card.commonMistakes || []));
  };

  const cancelEditFlashcard = () => {
    setEditingFlashcardId(null);
    setEditFlashcardQuestion('');
    setEditFlashcardAnswer('');
    setEditFlashcardDifficulty('3');
    setEditFlashcardJustification('');
    setEditFlashcardCommonMistakes([createEmptyCommonMistake()]);
  };

  const saveEditFlashcard = async (card: Flashcard) => {
    const question = editFlashcardQuestion.trim();
    const answer = editFlashcardAnswer.trim();
    const difficulty = normalizeFlashcardDifficulty(editFlashcardDifficulty);
    const justification = editFlashcardJustification.trim();
    const commonMistakes = normalizeCommonMistakes(editFlashcardCommonMistakes);
    if (!question || !answer || !resourceCourseId) return;

    try {
      const updated = await updateCourseFlashcard(card.id, {
        question,
        answer,
        difficulty,
        justification: justification || undefined,
        commonMistakes,
      });
      setFlashcardsByCourse((prev) => ({
        ...prev,
        [resourceCourseId]: (prev[resourceCourseId] || []).map((entry) => (entry.id === card.id ? updated : entry)),
      }));
      setSessionData((prev) => ({
        ...prev,
        [resourceCourseId]: prev[resourceCourseId]
          ? {
              ...prev[resourceCourseId],
              flashcards: (prev[resourceCourseId].flashcards || []).map((entry) => (entry.id === card.id ? updated : entry)),
            }
          : prev[resourceCourseId],
      }));
      cancelEditFlashcard();
    } catch (error) {
      console.error(error);
      handleAuthError(error);
      alert(`Impossible de modifier la carte. ${getErrorMessage(error)}`);
    }
  };

  const deleteCourseFlashcard = async (cardId: string) => {
    if (!resourceCourseId) return;
    try {
      await removeCourseFlashcard(cardId);
      setFlashcardsByCourse((prev) => ({
        ...prev,
        [resourceCourseId]: (prev[resourceCourseId] || []).filter((card) => card.id !== cardId),
      }));
      setSessionData((prev) => ({
        ...prev,
        [resourceCourseId]: prev[resourceCourseId]
          ? {
              ...prev[resourceCourseId],
              flashcards: (prev[resourceCourseId].flashcards || []).filter((card) => card.id !== cardId),
            }
          : prev[resourceCourseId],
      }));
    } catch (error) {
      console.error(error);
      alert("Impossible de supprimer cette carte.");
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
    markDocumentViewed(item.courseId, item.id);
    trackAppEvent({
      type: 'content_open',
      section: menuSection,
      courseId: item.courseId,
      label: item.title,
    });
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

  const openNoteLink = (note: EvernoteNote) => {
    if (!note.link) return;
    trackAppEvent({
      type: 'note_open',
      section: menuSection,
      courseId: note.courseId,
      label: note.title,
    });
    window.open(note.link, '_blank', 'noopener,noreferrer');
  };

  const openSearchResult = (result: SearchResultItem) => {
    if (result.kind === 'announcement') {
      setAnnouncementFilter(result.courseId && result.courseId !== ANNOUNCEMENTS_COURSE_ID ? result.courseId : 'ALL');
      navigateToMenuSection('ANNONCES');
      return;
    }
    if (result.kind === 'literature') {
      const topic = visibleTopics.find((entry) => entry.id === result.courseId);
      if (topic) {
        void startTopic(topic);
      }
      return;
    }
    if (result.kind === 'content') {
      const item = Object.values(contentItemsByCourse).flat().find((entry) => entry.id === result.id);
      if (item) {
        void openContentItem(item);
      }
      return;
    }
    if (result.url) {
      window.open(result.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (result.courseId && result.courseId !== GENERAL_COURSE_ID) {
      const topic = visibleTopics.find((entry) => entry.id === result.courseId);
      if (topic) void startTopic(topic);
    } else {
      navigateToMenuSection('CONTENU');
    }
  };

  const dismissOnboarding = () => {
    writeLocalObject(ONBOARDING_STORAGE_KEY, true);
    setShowOnboarding(false);
  };

  const ensureCourseSession = async (courseId: string, skipLockCheck = false): Promise<Flashcard[]> => {
    const topic = visibleTopics.find((item) => item.id === courseId);
    if (!topic) return [];
    if (!skipLockCheck && isStudentLockedCourse(courseId)) {
      setCoursePasswordTopic(topic);
      setCoursePasswordValue('');
      setCoursePasswordError(null);
      return [];
    }
    setLoading("Chargement des cartes mémo...");
    try {
      const flashcards = await listCourseFlashcards(courseId);
      setFlashcardsByCourse((prev) => ({ ...prev, [courseId]: flashcards }));
      setSessionData((prev) => ({
        ...prev,
        [courseId]: { topicId: courseId, summary: '', flashcards },
      }));
      return flashcards;
    } catch (error) {
      handleAuthError(error);
      return [];
    } finally {
      setLoading(null);
    }
  };

  const openFlashcardReview = async () => {
    if (!resourceCourseId) return;
    const prepareCardsForReview = (cards: Flashcard[]) => {
      const nextCards = userRole === 'student' ? shuffleFlashcards(cards) : cards;
      setFlashcardModalCards(nextCards);
      setShowFlashcards(true);
    };
    if (courseFlashcards.length) {
      recordFlashcardReview(resourceCourseId, courseFlashcards.length);
      setSessionData((prev) => ({
        ...prev,
        [resourceCourseId]: { topicId: resourceCourseId, summary: '', flashcards: courseFlashcards },
      }));
      prepareCardsForReview(courseFlashcards);
      return;
    }
    const existingCards = sessionData[resourceCourseId]?.flashcards || [];
    if (existingCards.length) {
      recordFlashcardReview(resourceCourseId, existingCards.length);
      prepareCardsForReview(existingCards);
      return;
    }

    const loadedCards = await ensureCourseSession(resourceCourseId);
    if (loadedCards.length) {
      recordFlashcardReview(resourceCourseId, loadedCards.length);
      prepareCardsForReview(loadedCards);
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
                  Cours, contenu, balado, stages et emplois, assistant IA, et cartes mémo dans une seule plateforme.
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
                    <button
                      type="button"
                      onClick={() => openPasswordHelpForm(undefined, true)}
                      className="inline-flex items-center rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      Vous n'avez pas le mot de passe ?
                    </button>
                  </div>

                  {authError && (
                    <p className="text-sm text-red-600 font-medium">{authError}</p>
                  )}

                  <button
                    type="submit"
                    className="w-full py-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition-colors"
                  >
                    Se connecter
                  </button>
                </form>
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
                {mainMenuItems.map((item) => {
                  const badgeCount = getMenuBadgeCount(item.key);
                  return (
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
                      {badgeCount > 0 && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                          {badgeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
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
                    {mainMenuItems.map((item) => {
                      const badgeCount = getMenuBadgeCount(item.key);
                      return (
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
                          {badgeCount > 0 && (
                            <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                              {badgeCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
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
                    <div className="mb-8 bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div>
                          <h1 className="text-4xl md:text-5xl font-black text-slate-900 mb-3 leading-tight">
                            Bienvenue dans votre espace d’apprentissage
                          </h1>
                          <p className="text-lg md:text-xl text-slate-600 font-medium">
                            Sélectionne un cours, découvre les nouveautés et reprends rapidement là où tu t’étais arrêté(e).
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          {isProfessor && (
                            <button
                              type="button"
                              onClick={() => setPreviewAsStudent((current) => !current)}
                              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
                                previewAsStudent
                                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                  : 'bg-slate-100 text-slate-700 border border-slate-200'
                              }`}
                            >
                              <i className="fas fa-eye"></i>
                              {previewAsStudent ? 'Aperçu étudiant actif' : 'Prévisualiser comme étudiant'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              logout();
                              setIsAuthenticated(false);
                              setUserRole('student');
                              setPreviewAsStudent(false);
                              setUnlockedCourseIds([]);
                              setView(AppView.DASHBOARD);
                              setSelectedTopic(null);
                            }}
                            className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                          >
                            Déconnexion
                          </button>
                        </div>
                      </div>

                      <div className="mt-6">
                        <label className="block">
                          <span className="text-sm font-semibold text-slate-700">Recherche rapide</span>
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Chercher dans les contenus, notes, annonces, lectures recommandées, littérature intéressante..."
                            className="mt-2 w-full rounded-2xl border border-slate-300 px-5 py-4 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </label>
                      </div>
                    </div>

                    {searchQuery.trim().length >= 2 && (
                      <div className="mb-8 bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <div className="flex items-center justify-between gap-4 mb-6">
                          <div>
                            <h2 className="text-2xl font-black text-slate-900">Résultats de recherche</h2>
                            <p className="text-slate-600">Recherche dans les contenus, notes, annonces et lectures.</p>
                          </div>
                          <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-bold text-indigo-600">
                            {searchResults.length} résultat{searchResults.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {searchResults.map((result) => (
                            <button
                              key={`${result.kind}-${result.id}`}
                              type="button"
                              onClick={() => openSearchResult(result)}
                              className="text-left rounded-2xl border border-slate-200 p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
                            >
                              <p className="text-xs uppercase tracking-wider font-bold text-indigo-500">{result.kind}</p>
                              <h3 className="mt-2 text-lg font-black text-slate-900">{result.title}</h3>
                              <p className="mt-2 text-sm text-slate-600 line-clamp-3">{result.description}</p>
                            </button>
                          ))}
                          {searchResults.length === 0 && (
                            <div className="rounded-2xl border border-slate-200 p-5 text-slate-500">
                              Aucun résultat pour cette recherche.
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-4">Dernières annonces</h2>
                        <div className="space-y-3">
                          {filteredAnnouncements.slice(0, 3).map((announcement) => (
                            <article key={announcement.id} className="rounded-2xl border border-slate-200 p-4">
                              <div className="flex flex-wrap items-center gap-2">
                                {announcement.pinned && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">Épinglée</span>}
                                {announcement.important && <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700">Important</span>}
                                {isRecentDate(announcement.createdAt) && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Nouveau</span>}
                              </div>
                              <h3 className="mt-3 text-lg font-black text-slate-900">{announcement.title}</h3>
                              <p className="mt-2 text-sm text-slate-600">{announcement.message}</p>
                            </article>
                          ))}
                          {!filteredAnnouncements.length && (
                            <div className="rounded-2xl border border-slate-200 p-4 text-slate-500">Aucune annonce active pour le moment.</div>
                          )}
                        </div>
                      </div>

                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-4">Nouveaux contenus ajoutés</h2>
                        <div className="space-y-3">
                          {latestContentItems.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => { void openContentItem(item); }}
                              className="w-full text-left rounded-2xl border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-500">{item.label}</p>
                                  <h3 className="mt-1 text-lg font-black text-slate-900">{stripArchivedResourceTitle(item.title)}</h3>
                                </div>
                                {isRecentDate(item.createdAt) && (
                                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                                    Nouveau
                                  </span>
                                )}
                              </div>
                            </button>
                          ))}
                          {!latestContentItems.length && (
                            <div className="rounded-2xl border border-slate-200 p-4 text-slate-500">Aucun nouveau contenu pour le moment.</div>
                          )}
                        </div>
                      </div>

                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-4">Favoris / enregistrés pour plus tard</h2>
                        <div className="space-y-3">
                          {favorites.slice(0, 5).map((favorite) => (
                            <button
                              key={`${favorite.kind}-${favorite.id}`}
                              type="button"
                              onClick={() => {
                                if (favorite.url) {
                                  window.open(favorite.url, '_blank', 'noopener,noreferrer');
                                  return;
                                }
                                if (favorite.courseId && favorite.courseId !== GENERAL_COURSE_ID) {
                                  const topic = visibleTopics.find((entry) => entry.id === favorite.courseId);
                                  if (topic) {
                                    void startTopic(topic);
                                    return;
                                  }
                                }
                                navigateToMenuSection('CONTENU');
                              }}
                              className="w-full text-left rounded-2xl border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
                            >
                              <p className="text-xs font-bold uppercase tracking-wider text-indigo-500">{favorite.kind}</p>
                              <p className="mt-2 text-lg font-black text-slate-900">{favorite.title}</p>
                            </button>
                          ))}
                          {favorites.length === 0 && (
                            <div className="rounded-2xl border border-slate-200 p-4 text-slate-500">
                              Tu n&apos;as encore rien enregistré pour plus tard.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-3">Dernier épisode du balado</h2>
                        {podcastEpisodes[0] ? (
                          <>
                            <h3 className="text-lg font-black text-slate-900">{podcastEpisodes[0].title}</h3>
                            <p className="mt-2 text-sm text-slate-600">{podcastEpisodes[0].description || 'Disponible maintenant.'}</p>
                            <button
                              type="button"
                              onClick={() => navigateToMenuSection('BALADO')}
                              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-white font-bold hover:bg-indigo-700 transition-colors"
                            >
                              Écouter dans l’app
                            </button>
                          </>
                        ) : (
                          <p className="text-slate-500">Chargement des épisodes...</p>
                        )}
                      </div>

                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-3">Prochain rendez-vous</h2>
                        <p className="text-slate-600">Prends rapidement un rendez-vous Zoom si tu as besoin d’un échange ou d’un suivi.</p>
                        <a
                          href={zoomSchedulerUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => trackExternalClick('zoom', 'Dashboard rendez-vous')}
                          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-white font-bold hover:bg-orange-600 transition-colors"
                        >
                          Prendre un rendez-vous
                        </a>
                      </div>

                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-3">Cours récemment mis à jour</h2>
                        <div className="space-y-3">
                          {recentUpdatedCourses.slice(0, 3).map((entry) => (
                            <button
                              key={entry.topic.id}
                              type="button"
                              onClick={() => startTopic(entry.topic)}
                              className="w-full text-left rounded-2xl border border-slate-200 p-4 hover:border-indigo-300 transition-colors"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-black text-slate-900">{entry.topic.title}</span>
                                {entry.isNew && (
                                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                                    Nouveau
                                  </span>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-4">À faire cette semaine</h2>
                        <div className="space-y-3">
                          {todoItems.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={item.action}
                              className="w-full text-left rounded-2xl border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
                            >
                              <p className="text-xs font-bold uppercase tracking-wider text-indigo-500">{item.title}</p>
                              <p className="mt-2 text-lg font-black text-slate-900">{item.description}</p>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-4">Progression étudiante</h2>
                        <div className="space-y-4">
                          {visibleTopics.slice(0, 4).map((topic) => {
                            const progress = getCourseProgress(topic.id);
                            return (
                              <div key={`progress-${topic.id}`} className="rounded-2xl border border-slate-200 p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <h3 className="font-black text-slate-900">{topic.title}</h3>
                                  <span className="text-sm font-bold text-indigo-600">{progress.percentage}%</span>
                                </div>
                                <div className="mt-3 h-2 rounded-full bg-slate-100">
                                  <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${progress.percentage}%` }} />
                                </div>
                                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-500">
                                  <span>{progress.viewedDocuments} docs vus</span>
                                  <span>{progress.reviewedFlashcards} cartes révisées</span>
                                  <span>{progress.lastVisitedAt ? new Date(progress.lastVisitedAt).toLocaleDateString('fr-FR') : 'Jamais visité'}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                  </div>
                )}

                {menuSection === 'COURS' && (
                  <div className="space-y-8">
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Cours</h1>
                      <p className="text-slate-600 text-lg">
                        Accède rapidement à chacun de tes cours.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {visibleTopics.map((topic, index) => {
                        const style = cardAccentStyles[index % cardAccentStyles.length];
                        const isCredibilityCourse = topic.id === '5';
                        const isInfluenceCourse = topic.id === '7';
                        const topicIconStyle = isCredibilityCourse
                          ? 'bg-white border border-slate-200'
                          : isInfluenceCourse
                            ? 'bg-orange-500 text-white'
                            : style.icon;
                        const topicCtaStyle = isCredibilityCourse
                          ? 'text-slate-600'
                          : isInfluenceCourse
                            ? 'text-orange-600'
                            : ctaAccentClasses[index % ctaAccentClasses.length];
                        return (
                          <div
                            key={topic.id}
                            onClick={() => startTopic(topic)}
                            className="relative bg-white rounded-3xl p-8 md:p-10 cursor-pointer border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all group overflow-hidden"
                          >
                            <div className={`absolute -top-8 -right-8 w-36 h-36 rounded-full ${style.bubble}`}></div>
                            {courseUpdateMeta.find((entry) => entry.topic.id === topic.id)?.isNew && (
                              <div className="absolute top-5 right-5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                                Nouveau
                              </div>
                            )}
                            <div className={`relative w-16 h-16 rounded-2xl ${topicIconStyle} flex items-center justify-center mb-8 overflow-hidden`}>
                              {isCredibilityCourse ? (
                                <img src={ciLogo} alt="" className="w-12 h-12 object-contain" />
                              ) : (
                                <i className={`fas ${topic.icon} text-2xl`}></i>
                              )}
                            </div>
                            <h3 className="relative text-2xl md:text-3xl font-black text-slate-900 mb-3 leading-tight">{topic.title}</h3>
                            <p className="relative text-xl md:text-2xl text-slate-600 leading-relaxed">{topic.description}</p>
                            {courseUpdateMeta.find((entry) => entry.topic.id === topic.id)?.newItemsCount ? (
                              <div className="relative mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                                <i className="fas fa-sparkles text-xs"></i>
                                {courseUpdateMeta.find((entry) => entry.topic.id === topic.id)?.newItemsCount} nouveauté(s)
                              </div>
                            ) : null}
                            {userRole === 'student' && lockedCourseIds.includes(topic.id) && (
                              <div className="relative mt-4 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
                                <i className="fas fa-lock text-xs"></i>
                                Mot de passe du cours requis
                              </div>
                            )}

                            <div className={`relative mt-8 flex items-center ${topicCtaStyle} font-extrabold text-xl md:text-2xl`}>
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
                          {activeSelectedTopicContentItems.length === 0 && (
                            <div className="rounded-2xl border border-slate-200 p-4 text-slate-500">
                              Aucun document ou lien pour ce cours.
                            </div>
                          )}
                          {activeSelectedTopicContentItems.map((item, index) => (
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
                                    <h3 className="text-lg font-black text-slate-900 mt-2">{stripArchivedResourceTitle(item.title)}</h3>
                                    <button
                                      type="button"
                                      onClick={() => { void openContentItem(item); }}
                                      className="inline-flex items-center gap-2 mt-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                                    >
                                      <i className="fas fa-up-right-from-square"></i>
                                      Ouvrir
                                    </button>
                                  </div>
                                  {canEditResources ? (
                                    <div className="flex items-center gap-3">
                                      <button
                                        type="button"
                                        onClick={() => { void moveContentItem(item.courseId, item.id, 'up', (entry) => !isArchivedResource(entry)); }}
                                        disabled={index === 0}
                                        className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Monter"
                                      >
                                        <i className="fas fa-arrow-up"></i>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { void moveContentItem(item.courseId, item.id, 'down', (entry) => !isArchivedResource(entry)); }}
                                        disabled={index === activeSelectedTopicContentItems.length - 1}
                                        className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Descendre"
                                      >
                                        <i className="fas fa-arrow-down"></i>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => startDuplicateItem(item, 'content')}
                                        className="text-sm font-semibold text-slate-600 hover:text-slate-800"
                                      >
                                        Dupliquer
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { void toggleArchiveContentItem(item); }}
                                        className="text-sm font-semibold text-amber-600 hover:text-amber-700"
                                      >
                                        Archiver
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
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => toggleFavorite({
                                        id: item.id,
                                        kind: 'resource',
                                        courseId: item.courseId,
                                        title: stripArchivedResourceTitle(item.title),
                                        url: item.url,
                                      })}
                                      className={`text-sm font-semibold ${isFavorite(item.id, 'resource') ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'}`}
                                      title="Enregistrer pour plus tard"
                                    >
                                      <i className={`fas ${isFavorite(item.id, 'resource') ? 'fa-star' : 'fa-star-half-stroke'}`}></i>
                                    </button>
                                  )}
                                </div>
                              )}
                            </article>
                          ))}
                          {canEditResources && archivedSelectedTopicContentItems.length > 0 && (
                            <div className="rounded-2xl border border-dashed border-slate-300 p-4">
                              <h3 className="font-black text-slate-900 mb-3">Contenus archivés</h3>
                              <div className="space-y-2">
                                {archivedSelectedTopicContentItems.map((item) => (
                                  <div key={`course-archived-${item.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                                    <span className="font-semibold text-slate-700">{stripArchivedResourceTitle(item.title)}</span>
                                    <button
                                      type="button"
                                      onClick={() => { void toggleArchiveContentItem(item); }}
                                      className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                                    >
                                      Restaurer
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
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
                                  {canEditResources ? (
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
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => toggleFavorite({
                                        id: note.id,
                                        kind: 'note',
                                        courseId: note.courseId,
                                        title: note.title,
                                        url: note.link,
                                      })}
                                      className={`text-sm font-semibold ${isFavorite(note.id, 'note') ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'}`}
                                      title="Enregistrer pour plus tard"
                                    >
                                      <i className={`fas ${isFavorite(note.id, 'note') ? 'fa-star' : 'fa-star-half-stroke'}`}></i>
                                    </button>
                                  )}
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h2 className="text-2xl font-black text-slate-900 mb-2">Lectures recommandées</h2>
                      <p className="text-slate-600 mb-6">
                        Suggestions de lectures pour ce cours.
                      </p>
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
                              {canEditResources ? (
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
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => toggleFavorite({
                                    id: note.id,
                                    kind: 'literature',
                                    courseId: note.courseId.replace(PROFESSOR_PROFILE_PREFIX, ''),
                                    title: note.title.replace(PROFESSOR_LITERATURE_PREFIX, '').trim(),
                                    url: note.link,
                                  })}
                                  className={`text-sm font-semibold ${isFavorite(note.id, 'literature') ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'}`}
                                  title="Enregistrer pour plus tard"
                                >
                                  <i className={`fas ${isFavorite(note.id, 'literature') ? 'fa-star' : 'fa-star-half-stroke'}`}></i>
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
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
                        Contenus généraux ({activeGeneralContentItems.length})
                      </h2>
                      {activeGeneralContentItems.length === 0 && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-500">
                          Aucun document ou lien général pour le moment.
                        </div>
                      )}
                      {activeGeneralContentItems.map((item, index) => (
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
                                <h3 className="text-xl font-black text-slate-900">{stripArchivedResourceTitle(item.title)}</h3>
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
                              {canEditResources ? (
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
                                    onClick={() => { void moveContentItem(item.courseId, item.id, 'down', (entry) => !isArchivedResource(entry)); }}
                                    disabled={index === activeGeneralContentItems.length - 1}
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
                                    onClick={() => startDuplicateItem(item, 'content')}
                                    className="text-sm font-semibold text-slate-600 hover:text-slate-800"
                                  >
                                    Dupliquer
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { void toggleArchiveContentItem(item); }}
                                    className="text-sm font-semibold text-amber-600 hover:text-amber-700"
                                  >
                                    Archiver
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteContentItem(item.id)}
                                    className="text-sm font-semibold text-rose-600 hover:text-rose-700"
                                  >
                                    Supprimer
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => toggleFavorite({
                                    id: item.id,
                                    kind: 'resource',
                                    courseId: item.courseId,
                                    title: stripArchivedResourceTitle(item.title),
                                    url: item.url,
                                  })}
                                  className={`text-sm font-semibold ${isFavorite(item.id, 'resource') ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'}`}
                                  title="Enregistrer pour plus tard"
                                >
                                  <i className={`fas ${isFavorite(item.id, 'resource') ? 'fa-star' : 'fa-star-half-stroke'}`}></i>
                                </button>
                              )}
                            </div>
                          )}
                        </article>
                      ))}
                      {canEditResources && archivedGeneralContentItems.length > 0 && (
                        <div className="mt-6">
                          <h3 className="text-lg font-black text-slate-900 mb-3">Contenus archivés</h3>
                          <div className="space-y-3">
                            {archivedGeneralContentItems.map((item) => (
                              <article key={`archived-${item.id}`} className="bg-slate-50 rounded-2xl border border-slate-200 p-5">
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <h4 className="font-black text-slate-900">{stripArchivedResourceTitle(item.title)}</h4>
                                    <p className="text-sm text-slate-500 mt-1">Archivé</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => { void toggleArchiveContentItem(item); }}
                                    className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                                  >
                                    Restaurer
                                  </button>
                                </div>
                              </article>
                            ))}
                          </div>
                        </div>
                      )}
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
                                  {canEditResources ? (
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
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => toggleFavorite({
                                        id: note.id,
                                        kind: 'note',
                                        courseId: note.courseId,
                                        title: note.title,
                                        url: note.link,
                                      })}
                                      className={`text-sm font-semibold ${isFavorite(note.id, 'note') ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'}`}
                                      title="Enregistrer pour plus tard"
                                    >
                                      <i className={`fas ${isFavorite(note.id, 'note') ? 'fa-star' : 'fa-star-half-stroke'}`}></i>
                                    </button>
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

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                      {canEditResources && (
                        <div className="xl:col-span-2 bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                          <h2 className="text-2xl font-black text-slate-900 mb-6">Publier une annonce</h2>
                          <form onSubmit={addAnnouncement} className="space-y-4">
                            <label className="block">
                              <span className="text-sm font-semibold text-slate-700">Titre</span>
                              <input
                                type="text"
                                value={announcementTitle}
                                onChange={(event) => setAnnouncementTitle(event.target.value)}
                                placeholder="Ex: Examen - date importante"
                                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                            </label>
                            <label className="block">
                              <span className="text-sm font-semibold text-slate-700">Message</span>
                              <textarea
                                value={announcementMessage}
                                onChange={(event) => setAnnouncementMessage(event.target.value)}
                                placeholder="Écris ton annonce ici..."
                                className="mt-2 w-full min-h-32 rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                            </label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Lien (optionnel)</span>
                                <input
                                  type="url"
                                  value={announcementLink}
                                  onChange={(event) => setAnnouncementLink(event.target.value)}
                                  placeholder="https://..."
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                              </label>
                              <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Cours visé</span>
                                <select
                                  value={announcementTargetCourseId}
                                  onChange={(event) => setAnnouncementTargetCourseId(event.target.value)}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                  <option value="">Annonce générale</option>
                                  {visibleTopics.map((topic) => (
                                    <option key={`announcement-course-${topic.id}`} value={topic.id}>{topic.title}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Date d&apos;expiration (optionnelle)</span>
                                <input
                                  type="date"
                                  value={announcementExpiresAt}
                                  onChange={(event) => setAnnouncementExpiresAt(event.target.value)}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                              </label>
                              <div className="flex flex-col justify-end gap-3 rounded-2xl border border-slate-200 px-4 py-4">
                                <label className="inline-flex items-center gap-3 text-sm font-semibold text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={announcementPinned}
                                    onChange={(event) => setAnnouncementPinned(event.target.checked)}
                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                  />
                                  Épingler en haut
                                </label>
                                <label className="inline-flex items-center gap-3 text-sm font-semibold text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={announcementImportant}
                                    onChange={(event) => setAnnouncementImportant(event.target.checked)}
                                    className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                                  />
                                  Marquer comme importante
                                </label>
                              </div>
                            </div>

                            <button
                              type="submit"
                              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors"
                            >
                              <i className="fas fa-plus"></i>
                              Publier l&apos;annonce
                            </button>
                          </form>
                        </div>
                      )}

                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-6">Filtrer les annonces</h2>
                        <div className="space-y-4">
                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Vue</span>
                            <select
                              value={announcementFilter}
                              onChange={(event) => setAnnouncementFilter(event.target.value)}
                              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                              <option value="ALL">Toutes les annonces</option>
                              <option value="GENERAL">Annonces générales</option>
                              <option value="CURRENT">Annonces générales + cours actuel</option>
                              {visibleTopics.map((topic) => (
                                <option key={`announcement-filter-${topic.id}`} value={topic.id}>{topic.title}</option>
                              ))}
                            </select>
                          </label>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Actives</p>
                              <p className="mt-2 text-3xl font-black text-slate-900">{filteredAnnouncements.length}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Nouvelles</p>
                              <p className="mt-2 text-3xl font-black text-slate-900">{recentAnnouncementCount}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h2 className="text-2xl font-black text-slate-900">
                        Annonces ({filteredAnnouncements.length})
                      </h2>
                      {filteredAnnouncements.length === 0 && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-500">
                          Aucune annonce active pour ce filtre.
                        </div>
                      )}
                      {filteredAnnouncements.map((announcement, index) => {
                        const targetTopic = announcement.targetCourseId
                          ? visibleTopics.find((topic) => topic.id === announcement.targetCourseId)
                          : null;
                        return (
                          <article key={announcement.id} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                            {canEditResources && editingAnnouncementId === announcement.id ? (
                              <form
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void saveEditAnnouncement(announcement);
                                }}
                                className="space-y-4"
                              >
                                <input
                                  type="text"
                                  value={editAnnouncementTitle}
                                  onChange={(event) => setEditAnnouncementTitle(event.target.value)}
                                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  required
                                />
                                <textarea
                                  value={editAnnouncementMessage}
                                  onChange={(event) => setEditAnnouncementMessage(event.target.value)}
                                  className="w-full min-h-28 rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  required
                                />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <input
                                    type="url"
                                    value={editAnnouncementLink}
                                    onChange={(event) => setEditAnnouncementLink(event.target.value)}
                                    placeholder="https://..."
                                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  />
                                  <select
                                    value={editAnnouncementTargetCourseId}
                                    onChange={(event) => setEditAnnouncementTargetCourseId(event.target.value)}
                                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  >
                                    <option value="">Annonce générale</option>
                                    {visibleTopics.map((topic) => (
                                      <option key={`edit-announcement-course-${topic.id}`} value={topic.id}>{topic.title}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="date"
                                    value={editAnnouncementExpiresAt}
                                    onChange={(event) => setEditAnnouncementExpiresAt(event.target.value)}
                                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  />
                                  <div className="flex flex-col justify-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                                    <label className="inline-flex items-center gap-3 text-sm font-semibold text-slate-700">
                                      <input
                                        type="checkbox"
                                        checked={editAnnouncementPinned}
                                        onChange={(event) => setEditAnnouncementPinned(event.target.checked)}
                                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                      />
                                      Épingler en haut
                                    </label>
                                    <label className="inline-flex items-center gap-3 text-sm font-semibold text-slate-700">
                                      <input
                                        type="checkbox"
                                        checked={editAnnouncementImportant}
                                        onChange={(event) => setEditAnnouncementImportant(event.target.checked)}
                                        className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                                      />
                                      Importante
                                    </label>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="submit"
                                    className="rounded-xl bg-indigo-600 px-4 py-2 text-white text-sm font-bold hover:bg-indigo-700"
                                  >
                                    Enregistrer
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditAnnouncement}
                                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
                                  >
                                    Annuler
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <>
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex-1">
                                    <div className="flex flex-wrap items-center gap-2 mb-3">
                                      {announcement.pinned && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">Épinglée</span>}
                                      {announcement.important && <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700">Important</span>}
                                      {isRecentDate(announcement.createdAt) && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Nouveau</span>}
                                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                                        {targetTopic ? targetTopic.title : 'Générale'}
                                      </span>
                                      {announcement.expiresAt && (
                                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                                          Expire le {new Date(announcement.expiresAt).toLocaleDateString('fr-FR')}
                                        </span>
                                      )}
                                    </div>
                                    <h3 className="text-xl font-black text-slate-900">{announcement.title}</h3>
                                    <p className="text-sm text-slate-500 mt-1">
                                      Date de parution : {new Date(announcement.createdAt).toLocaleString('fr-FR')}
                                    </p>
                                    <p className="text-slate-700 mt-4 whitespace-pre-line">{announcement.message}</p>
                                    {announcement.link && (
                                      <a
                                        href={announcement.link}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-2 mt-4 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
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
                                        onClick={() => { void moveNoteItem(announcement.courseId, announcement.id, 'up'); }}
                                        disabled={index === 0}
                                        className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Monter"
                                      >
                                        <i className="fas fa-arrow-up"></i>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { void moveNoteItem(announcement.courseId, announcement.id, 'down'); }}
                                        disabled={index === filteredAnnouncements.length - 1}
                                        className="text-sm font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Descendre"
                                      >
                                        <i className="fas fa-arrow-down"></i>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => startEditAnnouncement(announcement)}
                                        className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                                      >
                                        Modifier
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => deleteEvernoteNote(announcement.id)}
                                        className="text-sm font-semibold text-rose-600 hover:text-rose-700"
                                      >
                                        Supprimer
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </article>
                        );
                      })}
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
                      onClick={() => trackExternalClick('blog', 'Spotify show')}
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
                      onClick={() => trackExternalClick('blog', 'Blog externe')}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors"
                    >
                      <i className="fas fa-up-right-from-square"></i>
                      Ouvrir le blog
                    </a>
                  </div>
                )}

                {menuSection === 'RECRUTEMENT' && (
                  <div className="space-y-8">
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Recrutement</h1>
                      <p className="text-slate-600 text-lg">
                        Offres de stages, d&apos;emplois et d&apos;expériences bénévoles partagées pour les étudiant(e)s en communication et les nouveaux diplômé(e)s.
                      </p>
                    </div>

                    {canEditResources && (
                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        <h2 className="text-2xl font-black text-slate-900 mb-3">Ajouter une offre</h2>
                        <p className="text-slate-600 mb-6">
                          Publie ici les offres de recrutement destinées aux étudiant(e)s.
                        </p>

                        <form onSubmit={addRecruitmentOffer} className="space-y-5">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <label className="block">
                              <span className="text-sm font-semibold text-slate-700">Titre de l&apos;offre</span>
                              <input
                                type="text"
                                value={recruitmentTitle}
                                onChange={(event) => setRecruitmentTitle(event.target.value)}
                                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                            </label>

                            <label className="block">
                              <span className="text-sm font-semibold text-slate-700">Nom de l&apos;entreprise</span>
                              <input
                                type="text"
                                value={recruitmentCompanyName}
                                onChange={(event) => setRecruitmentCompanyName(event.target.value)}
                                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                            </label>

                            <label className="block">
                              <span className="text-sm font-semibold text-slate-700">Salaire horaire</span>
                              <input
                                type="text"
                                value={recruitmentHourlySalary}
                                onChange={(event) => setRecruitmentHourlySalary(event.target.value)}
                                placeholder="Ex: 22 $/h"
                                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </label>

                            <label className="block">
                              <span className="text-sm font-semibold text-slate-700">Type d&apos;offre</span>
                              <select
                                value={recruitmentOpportunityType}
                                onChange={(event) => setRecruitmentOpportunityType(event.target.value as RecruitmentOpportunityType)}
                                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                {RECRUITMENT_TYPE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </label>

                            {recruitmentOpportunityType === 'EMPLOI' && (
                              <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Type d&apos;emploi</span>
                                <select
                                  value={recruitmentEmploymentType}
                                  onChange={(event) => setRecruitmentEmploymentType(event.target.value as RecruitmentEmploymentType)}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                  {RECRUITMENT_EMPLOYMENT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                            )}

                            <label className="block">
                              <span className="text-sm font-semibold text-slate-700">Date d&apos;échéance pour appliquer</span>
                              <input
                                type="date"
                                value={recruitmentApplyBy}
                                onChange={(event) => setRecruitmentApplyBy(event.target.value)}
                                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                            </label>

                            <label className="block md:col-span-2">
                              <span className="text-sm font-semibold text-slate-700">Lien web de l&apos;entreprise</span>
                              <input
                                type="url"
                                value={recruitmentCompanyWebsiteUrl}
                                onChange={(event) => setRecruitmentCompanyWebsiteUrl(event.target.value)}
                                placeholder="https://..."
                                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </label>

                            <label className="block md:col-span-2">
                              <span className="text-sm font-semibold text-slate-700">Lien pour appliquer</span>
                              <input
                                type="text"
                                value={recruitmentApplyUrl}
                                onChange={(event) => setRecruitmentApplyUrl(event.target.value)}
                                placeholder="https://... ou mailto:..."
                                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                            </label>
                          </div>

                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Logo de l&apos;entreprise</span>
                            <input
                              key={`recruitment-logo-${recruitmentLogoInputKey}`}
                              type="file"
                              accept="image/*"
                              onChange={(event) => { void handleRecruitmentLogoUpload(event, 'create'); }}
                              className="mt-2 block w-full text-sm text-slate-700"
                            />
                            {recruitmentCompanyLogoUrl && (
                              <div className="mt-4 flex items-center gap-4">
                                <img src={recruitmentCompanyLogoUrl} alt="" className="h-16 w-16 rounded-2xl border border-slate-200 bg-white object-contain p-2" />
                                <button
                                  type="button"
                                  onClick={() => setRecruitmentCompanyLogoUrl('')}
                                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
                                >
                                  Retirer le logo
                                </button>
                              </div>
                            )}
                          </label>

                          <div className="rounded-2xl border border-slate-200 p-4">
                            <p className="text-sm font-semibold text-slate-700">Expérience nécessaire des candidat(e)s</p>
                            <div className="mt-3 space-y-3">
                              {RECRUITMENT_EXPERIENCE_OPTIONS.map((option) => (
                                <label key={`recruitment-exp-${option}`} className="flex items-start gap-3 rounded-xl bg-white border border-slate-200 px-4 py-3 cursor-pointer hover:border-indigo-300">
                                  <input
                                    type="checkbox"
                                    checked={recruitmentCandidateExperienceLevels.includes(option)}
                                    onChange={() => toggleRecruitmentExperienceSelection(option, 'create')}
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                  />
                                  <span className="text-slate-800">{option}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Description de l&apos;offre</span>
                            <textarea
                              value={recruitmentDescription}
                              onChange={(event) => setRecruitmentDescription(event.target.value)}
                              rows={7}
                              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              required
                            />
                          </label>

                          <button
                            type="submit"
                            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors"
                          >
                            <i className="fas fa-plus"></i>
                            Publier l&apos;offre
                          </button>
                        </form>
                      </div>
                    )}

                    {recruitmentLoading && (
                      <div className="bg-white rounded-3xl border border-slate-200 p-6 text-slate-500">
                        Chargement des offres...
                      </div>
                    )}

                    {recruitmentError && (
                      <div className="bg-white rounded-3xl border border-rose-200 p-6 text-rose-600">
                        {recruitmentError}
                      </div>
                    )}

                    {!canEditResources && (
                      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                          <p className="text-slate-700 text-base md:text-lg">
                            Vous souhaitez offrir un emploi ou un stage, remplissez le formulaire et nous vous répondrons rapidement.
                          </p>
                          <a
                            href="https://forms.office.com/r/QYA6zZmh98"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-w-[260px] items-center justify-center gap-3 rounded-2xl bg-indigo-600 px-7 py-3.5 text-white font-bold shadow-sm hover:bg-indigo-700 transition-colors"
                          >
                            <i className="fas fa-envelope"></i>
                            Formulaire
                          </a>
                        </div>
                      </div>
                    )}

                    {!recruitmentLoading && !recruitmentError && visibleRecruitmentOffers.length === 0 && (
                      <div className="bg-white rounded-3xl border border-slate-200 p-6 text-slate-500">
                        {canEditResources
                          ? "Aucune offre n'a encore été publiée."
                          : "Aucune offre active n'est disponible pour le moment."}
                      </div>
                    )}

                    {!recruitmentLoading && !recruitmentError && visibleRecruitmentOffers.map((offer) => (
                      <article key={offer.id} className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                        {canEditResources && editingRecruitmentId === offer.id ? (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              void saveEditRecruitmentOffer(offer);
                            }}
                            className="space-y-5"
                          >
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                              <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Titre de l&apos;offre</span>
                                <input
                                  type="text"
                                  value={editRecruitmentTitle}
                                  onChange={(event) => setEditRecruitmentTitle(event.target.value)}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  required
                                />
                              </label>

                              <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Nom de l&apos;entreprise</span>
                                <input
                                  type="text"
                                  value={editRecruitmentCompanyName}
                                  onChange={(event) => setEditRecruitmentCompanyName(event.target.value)}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  required
                                />
                              </label>

                              <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Salaire horaire</span>
                                <input
                                  type="text"
                                  value={editRecruitmentHourlySalary}
                                  onChange={(event) => setEditRecruitmentHourlySalary(event.target.value)}
                                  placeholder="Ex: 22 $/h"
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                              </label>

                              <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Type d&apos;offre</span>
                                <select
                                  value={editRecruitmentOpportunityType}
                                  onChange={(event) => setEditRecruitmentOpportunityType(event.target.value as RecruitmentOpportunityType)}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                  {RECRUITMENT_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </label>

                              {editRecruitmentOpportunityType === 'EMPLOI' && (
                                <label className="block">
                                  <span className="text-sm font-semibold text-slate-700">Type d&apos;emploi</span>
                                  <select
                                    value={editRecruitmentEmploymentType}
                                    onChange={(event) => setEditRecruitmentEmploymentType(event.target.value as RecruitmentEmploymentType)}
                                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  >
                                    {RECRUITMENT_EMPLOYMENT_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                </label>
                              )}

                              <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Date d&apos;échéance pour appliquer</span>
                                <input
                                  type="date"
                                  value={editRecruitmentApplyBy}
                                  onChange={(event) => setEditRecruitmentApplyBy(event.target.value)}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  required
                                />
                              </label>

                              <label className="block md:col-span-2">
                                <span className="text-sm font-semibold text-slate-700">Lien web de l&apos;entreprise</span>
                                <input
                                  type="url"
                                  value={editRecruitmentCompanyWebsiteUrl}
                                  onChange={(event) => setEditRecruitmentCompanyWebsiteUrl(event.target.value)}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                              </label>

                              <label className="block md:col-span-2">
                                <span className="text-sm font-semibold text-slate-700">Lien pour appliquer</span>
                                <input
                                  type="text"
                                  value={editRecruitmentApplyUrl}
                                  onChange={(event) => setEditRecruitmentApplyUrl(event.target.value)}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  required
                                />
                              </label>
                            </div>

                            <label className="block">
                              <span className="text-sm font-semibold text-slate-700">Logo de l&apos;entreprise</span>
                              <input
                                key={`edit-recruitment-logo-${editRecruitmentLogoInputKey}`}
                                type="file"
                                accept="image/*"
                                onChange={(event) => { void handleRecruitmentLogoUpload(event, 'edit'); }}
                                className="mt-2 block w-full text-sm text-slate-700"
                              />
                              {editRecruitmentCompanyLogoUrl && (
                                <div className="mt-4 flex items-center gap-4">
                                  <img src={editRecruitmentCompanyLogoUrl} alt="" className="h-16 w-16 rounded-2xl border border-slate-200 bg-white object-contain p-2" />
                                  <button
                                    type="button"
                                    onClick={() => setEditRecruitmentCompanyLogoUrl('')}
                                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
                                  >
                                    Retirer le logo
                                  </button>
                                </div>
                              )}
                            </label>

                            <div className="rounded-2xl border border-slate-200 p-4">
                              <p className="text-sm font-semibold text-slate-700">Expérience nécessaire des candidat(e)s</p>
                              <div className="mt-3 space-y-3">
                                {RECRUITMENT_EXPERIENCE_OPTIONS.map((option) => (
                                  <label key={`edit-recruitment-exp-${offer.id}-${option}`} className="flex items-start gap-3 rounded-xl bg-white border border-slate-200 px-4 py-3 cursor-pointer hover:border-indigo-300">
                                    <input
                                      type="checkbox"
                                      checked={editRecruitmentCandidateExperienceLevels.includes(option)}
                                      onChange={() => toggleRecruitmentExperienceSelection(option, 'edit')}
                                      className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="text-slate-800">{option}</span>
                                  </label>
                                ))}
                              </div>
                            </div>

                            <label className="block">
                              <span className="text-sm font-semibold text-slate-700">Description de l&apos;offre</span>
                              <textarea
                                value={editRecruitmentDescription}
                                onChange={(event) => setEditRecruitmentDescription(event.target.value)}
                                rows={7}
                                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                required
                              />
                            </label>

                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                type="submit"
                                className="rounded-xl bg-indigo-600 px-4 py-2 text-white text-sm font-bold hover:bg-indigo-700"
                              >
                                Enregistrer
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditRecruitmentOffer}
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
                              >
                                Annuler
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                              <div className="flex items-start gap-4">
                                {offer.companyLogoUrl ? (
                                  <img src={offer.companyLogoUrl} alt="" className="h-16 w-16 rounded-2xl border border-slate-200 bg-white object-contain p-2" />
                                ) : (
                                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                                    <i className="fas fa-briefcase text-xl"></i>
                                  </div>
                                )}
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="text-2xl font-black text-slate-900">{offer.title}</h2>
                                    {isRecentDate(offer.createdAt) && (
                                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Nouveau</span>
                                    )}
                                    {isOfferExpired(offer) && (
                                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">Expirée</span>
                                    )}
                                  </div>
                                  <p className="mt-2 text-lg font-semibold text-slate-700">{offer.companyName}</p>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-bold text-indigo-700">
                                      {formatRecruitmentTypeLabel(offer.opportunityType)}
                                    </span>
                                    {offer.opportunityType === 'EMPLOI' && offer.employmentType && (
                                      <span className="rounded-full bg-orange-50 px-3 py-1 text-sm font-bold text-orange-700">
                                        {formatRecruitmentEmploymentLabel(offer.employmentType)}
                                      </span>
                                    )}
                                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                                      Échéance: {new Date(`${offer.applyBy}T12:00:00`).toLocaleDateString('fr-FR')}
                                    </span>
                                    {offer.hourlySalary && (
                                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                                        Salaire horaire: {offer.hourlySalary}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {canEditResources && (
                                <div className="flex flex-wrap items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => startEditRecruitmentOffer(offer)}
                                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-slate-700 font-bold hover:bg-slate-100 transition-colors"
                                  >
                                    <i className="fas fa-pen"></i>
                                    Modifier
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { void deleteRecruitmentOffer(offer.id); }}
                                    className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-2 text-rose-600 font-bold hover:bg-rose-50 transition-colors"
                                  >
                                    <i className="fas fa-trash"></i>
                                    Supprimer
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                              <p className="whitespace-pre-wrap text-slate-700">{offer.description}</p>
                            </div>

                            {!!offer.candidateExperienceLevels?.length && (
                              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
                                  Expérience nécessaire des candidat(e)s
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {offer.candidateExperienceLevels.map((entry) => (
                                    <span key={`${offer.id}-experience-${entry}`} className="rounded-full bg-white border border-slate-200 px-3 py-1 text-sm font-medium text-slate-700">
                                      {entry}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="mt-6 flex flex-wrap items-center gap-3">
                              {offer.companyWebsiteUrl && (
                                <a
                                  href={offer.companyWebsiteUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-slate-700 font-bold hover:bg-slate-100 transition-colors"
                                >
                                  <i className="fas fa-globe"></i>
                                  Site de l&apos;entreprise
                                </a>
                              )}
                              <a
                                href={offer.applyUrl}
                                target={offer.applyUrl.startsWith('mailto:') ? undefined : '_blank'}
                                rel={offer.applyUrl.startsWith('mailto:') ? undefined : 'noreferrer'}
                                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors"
                              >
                                <i className="fas fa-paper-plane"></i>
                                Appliquer à l&apos;offre
                              </a>
                            </div>
                          </>
                        )}
                      </article>
                    ))}
                  </div>
                )}

                {menuSection === 'MEMO' && (
                  <div className="space-y-8">
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                      <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2">Cartes mémo</h1>
                      <p className="text-slate-600 text-lg">
                        {canEditResources
                          ? 'Rédige les cartes mémo officielles de chaque cours.'
                          : 'Cartes mémo préparées par le professeur pour ce cours.'}
                      </p>
                      <div className="mt-5 max-w-md">
                        <label className="block">
                          <span className="text-sm font-semibold text-slate-700">Cours lié</span>
                          <select
                            value={resourceCourseId}
                            onChange={(event) => handleMemoCourseChange(event.target.value)}
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
                        <h2 className="text-2xl font-black text-slate-900 mb-2">Ajouter une carte mémo</h2>
                        <p className="text-slate-600 mb-6">
                          Ajoute une question, la bonne réponse et une justification expliquant pourquoi cette réponse est la bonne.
                        </p>

                        <form onSubmit={addCourseFlashcard} className="space-y-4">
                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Question</span>
                            <textarea
                              value={flashcardQuestion}
                              onChange={(event) => setFlashcardQuestion(event.target.value)}
                              rows={5}
                              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder={"Ex: Quelle est la différence entre relations médias et relations de presse?\nA. Les relations médias visent tous les médias\nB. Les relations de presse visent surtout les journalistes et médias d'information\nC. Les deux sont exactement la même chose"}
                            />
                            <p className="mt-2 text-sm text-slate-500">
                              Tu peux écrire une question simple ou une question à choix multiples directement ici, avec une réponse par ligne.
                            </p>
                          </label>

                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Réponse</span>
                            <textarea
                              value={flashcardAnswer}
                              onChange={(event) => setFlashcardAnswer(event.target.value)}
                              rows={3}
                              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder="Écris ici la bonne réponse."
                            />
                          </label>

                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Justification</span>
                            <textarea
                              value={flashcardJustification}
                              onChange={(event) => setFlashcardJustification(event.target.value)}
                              rows={4}
                              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder="Explique pourquoi cette réponse est correcte et pourquoi les autres réponses ne le seraient pas."
                            />
                          </label>

                          <label className="block max-w-xs">
                            <span className="text-sm font-semibold text-slate-700">Niveau de difficulté (1 à 5)</span>
                            <input
                              type="number"
                              min={1}
                              max={5}
                              step={1}
                              value={flashcardDifficulty}
                              onChange={(event) => setFlashcardDifficulty(event.target.value)}
                              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder="3"
                            />
                            <p className="mt-2 text-sm text-slate-500">
                              1 = facile <span className="font-semibold text-emerald-600">vert</span>, 3 = moyen <span className="font-semibold text-amber-500">jaune</span>, 5 = difficile <span className="font-semibold text-rose-600">rouge</span>.
                            </p>
                          </label>

                          <div className="block">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <span className="text-sm font-semibold text-slate-700">Mauvaises réponses fréquentes</span>
                              <button
                                type="button"
                                onClick={() => addDraftCommonMistake('create')}
                                className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 px-3 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50 transition-colors"
                              >
                                <i className="fas fa-plus"></i>
                                Ajouter une mauvaise réponse
                              </button>
                            </div>
                            <div className="mt-3 space-y-3">
                              {flashcardCommonMistakes.map((mistake, index) => (
                                <div key={`create-mistake-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                                    <label className="block">
                                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Mauvaise réponse</span>
                                      <input
                                        type="text"
                                        value={mistake.answer}
                                        onChange={(event) => updateDraftCommonMistake('create', index, 'answer', event.target.value)}
                                        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        placeholder="Ex.: Publicité"
                                      />
                                    </label>
                                    <label className="block">
                                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Pourquoi ce n&apos;est pas bon</span>
                                      <input
                                        type="text"
                                        value={mistake.explanation}
                                        onChange={(event) => updateDraftCommonMistake('create', index, 'explanation', event.target.value)}
                                        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        placeholder="Explique pourquoi cette réponse n'est pas correcte."
                                      />
                                    </label>
                                    <div className="flex items-end">
                                      <button
                                        type="button"
                                        onClick={() => removeDraftCommonMistake('create', index)}
                                        className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-3 text-sm font-bold text-rose-700 hover:bg-rose-50 transition-colors"
                                      >
                                        <i className="fas fa-trash"></i>
                                        Supprimer
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <p className="mt-2 text-sm text-slate-500">
                              Tu peux laisser ces champs vides si tu ne veux pas afficher de mauvaises réponses fréquentes.
                            </p>
                          </div>

                          <button
                            type="submit"
                            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors"
                          >
                            <i className="fas fa-plus"></i>
                            Ajouter la carte
                          </button>
                        </form>
                      </div>
                    )}

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
                          Charger les cartes du cours
                        </button>
                        <button
                          type="button"
                          disabled={!courseFlashcards.length && !sessionData[resourceCourseId]?.flashcards?.length}
                          onClick={() => { void openFlashcardReview(); }}
                          className="inline-flex items-center gap-2 rounded-xl border-2 border-indigo-600 px-5 py-3 text-indigo-600 font-bold hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Réviser en mode flashcards
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h2 className="text-2xl font-black text-slate-900">
                        Cartes du cours - {resourceCourse?.title || 'Cours'} ({courseFlashcards.length})
                      </h2>
                      {!courseFlashcards.length && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-500">
                          Aucune carte mémo pour ce cours pour le moment.
                        </div>
                      )}
                      {canEditResources ? courseFlashcards.map((card) => {
                        const difficultyMeta = getFlashcardDifficultyLineStyle(card.difficulty);
                        return (
                        <article key={card.id} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                          <div className="mb-5">
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                              <span>Difficulté</span>
                              <span>{difficultyMeta.level}/5</span>
                            </div>
                            <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                              <div className={`absolute inset-0 ${difficultyMeta.barClassName}`}></div>
                              <div
                                className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white bg-white shadow"
                                style={{ left: `calc(${difficultyMeta.percentage}% - 0.5rem)` }}
                              ></div>
                            </div>
                          </div>
                          {editingFlashcardId === card.id ? (
                            <div className="space-y-4">
                              <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Question</span>
                                <textarea
                                  value={editFlashcardQuestion}
                                  onChange={(event) => setEditFlashcardQuestion(event.target.value)}
                                  rows={5}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                <p className="mt-2 text-sm text-slate-500">
                                  Tu peux aussi écrire ici des choix multiples, une réponse par ligne.
                                </p>
                              </label>

                              <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Réponse</span>
                                <textarea
                                  value={editFlashcardAnswer}
                                  onChange={(event) => setEditFlashcardAnswer(event.target.value)}
                                  rows={3}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                              </label>

                              <label className="block">
                                <span className="text-sm font-semibold text-slate-700">Justification</span>
                                <textarea
                                  value={editFlashcardJustification}
                                  onChange={(event) => setEditFlashcardJustification(event.target.value)}
                                  rows={4}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                              </label>

                              <label className="block max-w-xs">
                                <span className="text-sm font-semibold text-slate-700">Niveau de difficulté (1 à 5)</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={5}
                                  step={1}
                                  value={editFlashcardDifficulty}
                                  onChange={(event) => setEditFlashcardDifficulty(event.target.value)}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                <p className="mt-2 text-sm text-slate-500">
                                  1 = facile <span className="font-semibold text-emerald-600">vert</span>, 3 = moyen <span className="font-semibold text-amber-500">jaune</span>, 5 = difficile <span className="font-semibold text-rose-600">rouge</span>.
                                </p>
                              </label>

                              <div className="block">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <span className="text-sm font-semibold text-slate-700">Mauvaises réponses fréquentes</span>
                                  <button
                                    type="button"
                                    onClick={() => addDraftCommonMistake('edit')}
                                    className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 px-3 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50 transition-colors"
                                  >
                                    <i className="fas fa-plus"></i>
                                    Ajouter une mauvaise réponse
                                  </button>
                                </div>
                                <div className="mt-3 space-y-3">
                                  {editFlashcardCommonMistakes.map((mistake, index) => (
                                    <div key={`edit-mistake-${card.id}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                                        <label className="block">
                                          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Mauvaise réponse</span>
                                          <input
                                            type="text"
                                            value={mistake.answer}
                                            onChange={(event) => updateDraftCommonMistake('edit', index, 'answer', event.target.value)}
                                            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                          />
                                        </label>
                                        <label className="block">
                                          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Pourquoi ce n&apos;est pas bon</span>
                                          <input
                                            type="text"
                                            value={mistake.explanation}
                                            onChange={(event) => updateDraftCommonMistake('edit', index, 'explanation', event.target.value)}
                                            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                          />
                                        </label>
                                        <div className="flex items-end">
                                          <button
                                            type="button"
                                            onClick={() => removeDraftCommonMistake('edit', index)}
                                            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-3 text-sm font-bold text-rose-700 hover:bg-rose-50 transition-colors"
                                          >
                                            <i className="fas fa-trash"></i>
                                            Supprimer
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-3">
                                <button
                                  type="button"
                                  onClick={() => void saveEditFlashcard(card)}
                                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-white font-bold hover:bg-indigo-700 transition-colors"
                                >
                                  Enregistrer
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditFlashcard}
                                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-slate-700 font-bold hover:bg-slate-100 transition-colors"
                                >
                                  Annuler
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-2">Question</p>
                              <h3 className="text-xl font-black text-slate-900 whitespace-pre-line">{card.question}</h3>
                              <hr className="my-4 border-slate-100" />
                              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                                <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-2">Bonne réponse</p>
                                <p className="text-slate-800 whitespace-pre-line">{card.answer}</p>
                              </div>
                              {!!card.justification && (
                                <>
                                  <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                                    <p className="text-xs font-bold text-indigo-700 uppercase tracking-wider mb-2">Pourquoi c&apos;est la bonne réponse</p>
                                    <p className="text-slate-800 whitespace-pre-line">{card.justification}</p>
                                  </div>
                                </>
                              )}
                              {!!card.commonMistakes?.length && (
                                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                                  <p className="text-xs font-bold text-rose-700 uppercase tracking-wider mb-3">Mauvaises réponses fréquentes</p>
                                  <div className="space-y-3">
                                    {card.commonMistakes.map((mistake, mistakeIndex) => (
                                      <div key={`${card.id}-mistake-${mistakeIndex}`} className="rounded-xl bg-white/80 p-3 border border-rose-100">
                                        <p className="font-bold text-slate-900">{mistake.answer}</p>
                                        <p className="mt-1 text-sm text-slate-700 whitespace-pre-line">{mistake.explanation}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {canEditResources && (
                                <div className="mt-5 flex flex-wrap gap-3">
                                  <button
                                    type="button"
                                    onClick={() => { void moveFlashcardItem(resourceCourseId, card.id, 'up'); }}
                                    disabled={courseFlashcards[0]?.id === card.id}
                                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-slate-700 font-bold hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    <i className="fas fa-arrow-up"></i>
                                    Monter
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { void moveFlashcardItem(resourceCourseId, card.id, 'down'); }}
                                    disabled={courseFlashcards[courseFlashcards.length - 1]?.id === card.id}
                                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-slate-700 font-bold hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    <i className="fas fa-arrow-down"></i>
                                    Descendre
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startEditFlashcard(card)}
                                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-slate-700 font-bold hover:bg-slate-100 transition-colors"
                                  >
                                    <i className="fas fa-pen"></i>
                                    Modifier
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startDuplicateItem(card, 'flashcard')}
                                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-slate-700 font-bold hover:bg-slate-100 transition-colors"
                                  >
                                    <i className="fas fa-copy"></i>
                                    Dupliquer
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deleteCourseFlashcard(card.id)}
                                    className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-2 text-rose-600 font-bold hover:bg-rose-50 transition-colors"
                                  >
                                    <i className="fas fa-trash"></i>
                                    Supprimer
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </article>
                      )}) : (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-600">
                          {!!courseFlashcards.length && (
                            <div className="mb-4 space-y-3">
                              {courseFlashcards.map((card) => {
                                const difficultyMeta = getFlashcardDifficultyLineStyle(card.difficulty);
                                return (
                                  <div key={card.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                                      <span>Difficulté</span>
                                      <span>{difficultyMeta.level}/5</span>
                                    </div>
                                    <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                                      <div className={`absolute inset-0 ${difficultyMeta.barClassName}`}></div>
                                      <div
                                        className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white bg-white shadow"
                                        style={{ left: `calc(${difficultyMeta.percentage}% - 0.5rem)` }}
                                      ></div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <p className="font-semibold text-slate-800">
                            {courseFlashcards.length} cartes sont prêtes pour ce cours.
                          </p>
                          <p className="mt-2">
                            Clique sur <span className="font-semibold">Charger les cartes du cours</span>, puis sur <span className="font-semibold">Réviser en mode flashcards</span> pour commencer la révision.
                          </p>
                        </div>
                      )}
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
                      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm lg:col-span-2">
                        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                          <div className="max-w-2xl">
                            <h2 className="text-2xl font-black text-slate-900 mb-3 flex items-center gap-2">
                              <i className="fas fa-video text-orange-600"></i>
                              Prendre un rendez-vous
                            </h2>
                            <p className="text-slate-600">
                              Réserve une plage horaire directement via le calendrier Zoom.
                            </p>
                          </div>
                          <div className="flex justify-start lg:justify-end">
                            <a
                              href={zoomSchedulerUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => trackExternalClick('zoom', 'Contact zoom')}
                              className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-white font-bold hover:bg-orange-600 transition-colors"
                            >
                              Ouvrir le calendrier Zoom
                            </a>
                          </div>
                        </div>
                      </div>

                      {effectiveUserRole === 'student' && (
                        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm lg:col-span-2">
                          <h2 className="text-2xl font-black text-slate-900 mb-3 flex items-center gap-2">
                            <i className="fas fa-envelope text-indigo-600"></i>
                            Formulaire de contact
                          </h2>
                          <p className="text-slate-600 mb-6">
                            Remplis ce formulaire pour demander un mot de passe, poser une question ou nous écrire directement.
                          </p>

                          {renderContactRequestForm()}
                        </div>
                      )}

                      {canEditResources && (
                        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm lg:col-span-2">
                          <h2 className="text-2xl font-black text-slate-900 mb-2 flex items-center gap-2">
                            <i className="fas fa-inbox text-indigo-600"></i>
                            Demandes de contact reçues
                          </h2>
                          <p className="text-slate-600 mb-6">
                            Messages envoyés depuis le formulaire étudiant.
                          </p>

                          {contactRequestsLoading && (
                            <p className="text-slate-500">Chargement des demandes...</p>
                          )}

                          {contactRequestsError && (
                            <p className="text-rose-600">{contactRequestsError}</p>
                          )}

                          {!contactRequestsLoading && !contactRequestsError && (
                            <div className="space-y-4">
                              {contactRequests.length === 0 ? (
                                <div className="rounded-2xl border border-slate-200 p-4 text-slate-500">
                                  Aucune demande de contact pour le moment.
                                </div>
                              ) : (
                                contactRequests.map((request) => (
                                  <article key={request.id} className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                      <div>
                                        <h3 className="text-lg font-black text-slate-900">{request.name}</h3>
                                        <p className="text-slate-600">{request.email}</p>
                                        <p className="text-slate-600">{request.university}</p>
                                        {request.courseGroup && (
                                          <p className="text-slate-600">{request.courseGroup}</p>
                                        )}
                                      </div>
                                      <div className="flex flex-col items-start gap-3 md:items-end">
                                        <p className="text-sm text-slate-500">
                                          {new Date(request.createdAt).toLocaleString('fr-FR')}
                                        </p>
                                        <button
                                          type="button"
                                          onClick={() => { void handleDeleteContactRequest(request.id); }}
                                          disabled={contactDeletingId === request.id}
                                          className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-60"
                                        >
                                          <i className="fas fa-trash"></i>
                                          {contactDeletingId === request.id ? 'Suppression...' : 'Supprimer'}
                                        </button>
                                      </div>
                                    </div>

                                    {request.message && (
                                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                                        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Message</p>
                                        <p className="mt-2 whitespace-pre-wrap text-slate-700">{request.message}</p>
                                      </div>
                                    )}

                                    <div className="mt-4 flex flex-wrap gap-2">
                                      {request.selections.length > 0 ? request.selections.map((selection) => (
                                        <span key={`${request.id}-${selection}`} className="rounded-full bg-white border border-slate-200 px-3 py-1 text-sm text-slate-700">
                                          {selection}
                                        </span>
                                      )) : (
                                        <span className="rounded-full bg-white border border-slate-200 px-3 py-1 text-sm text-slate-500">
                                          Message libre
                                        </span>
                                      )}
                                    </div>
                                  </article>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {canEditResources && (
                        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm lg:col-span-2">
                          <h2 className="text-2xl font-black text-slate-900 mb-2 flex items-center gap-2">
                            <i className="fas fa-chart-line text-indigo-600"></i>
                            Compteur d'accès à l'app
                          </h2>
                          <p className="text-slate-600 mb-6">
                            Statistiques cumulées des connexions réussies (depuis le lancement).
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
                                <p className="text-xs uppercase tracking-wider text-slate-500 font-bold">Depuis le lancement</p>
                                <p className="text-lg font-black text-slate-900">
                                  {accessMetrics.firstAccessAt
                                    ? new Date(accessMetrics.firstAccessAt).toLocaleDateString('fr-FR')
                                    : 'N/A'}
                                </p>
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

                          {!accessMetricsLoading && !accessMetricsError && accessMetrics && (
                            <div className="mt-8 border-t border-slate-200 pt-8">
                              <h3 className="text-xl font-black text-slate-900 mb-2">Ce mois-ci</h3>
                              <p className="text-slate-600 mb-6">
                                Statistiques du mois en cours.
                              </p>

                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                                  <p className="text-xs uppercase tracking-wider text-slate-500 font-bold">Total</p>
                                  <p className="text-3xl font-black text-slate-900">{accessMetrics.monthly.total}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                                  <p className="text-xs uppercase tracking-wider text-slate-500 font-bold">Étudiants</p>
                                  <p className="text-3xl font-black text-slate-900">{accessMetrics.monthly.student}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                                  <p className="text-xs uppercase tracking-wider text-slate-500 font-bold">Professeur</p>
                                  <p className="text-3xl font-black text-slate-900">{accessMetrics.monthly.professor}</p>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="mt-8 border-t border-slate-200 pt-8">
                            <h3 className="text-xl font-black text-slate-900 mb-2">Statistiques détaillées</h3>
                            <p className="text-slate-600 mb-6">
                              Pages les plus visitées, cours les plus consultés et clics externes.
                            </p>

                            {analyticsSummaryLoading && (
                              <p className="text-slate-500">Chargement des statistiques détaillées...</p>
                            )}

                            {analyticsSummaryError && (
                              <p className="text-rose-600">{analyticsSummaryError}</p>
                            )}

                            {!analyticsSummaryLoading && !analyticsSummaryError && analyticsSummary && (
                              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                                  <h4 className="font-black text-slate-900 mb-4">Pages les plus visitées</h4>
                                  <div className="space-y-3">
                                    {analyticsSummary.pageViews.length > 0 ? analyticsSummary.pageViews.slice(0, 5).map((entry) => (
                                      <div key={`page-view-${entry.section}`} className="flex items-center justify-between gap-4">
                                        <span className="text-slate-700">{entry.section}</span>
                                        <span className="font-black text-slate-900">{entry.count}</span>
                                      </div>
                                    )) : (
                                      <p className="text-slate-500">Aucune donnée pour le moment.</p>
                                    )}
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                                  <h4 className="font-black text-slate-900 mb-4">Cours les plus consultés</h4>
                                  <div className="space-y-3">
                                    {analyticsSummary.courseViews.length > 0 ? analyticsSummary.courseViews.slice(0, 5).map((entry) => (
                                      <div key={`course-view-${entry.courseId}`} className="flex items-center justify-between gap-4">
                                        <span className="text-slate-700">{visibleTopics.find((topic) => topic.id === entry.courseId)?.title || entry.courseId}</span>
                                        <span className="font-black text-slate-900">{entry.count}</span>
                                      </div>
                                    )) : (
                                      <p className="text-slate-500">Aucune donnée pour le moment.</p>
                                    )}
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                                  <h4 className="font-black text-slate-900 mb-4">Balado</h4>
                                  <div className="flex items-center justify-between gap-4">
                                    <span className="text-slate-700">Ouvertures de la page / épisodes</span>
                                    <span className="font-black text-slate-900">{analyticsSummary.podcastOpens}</span>
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                                  <h4 className="font-black text-slate-900 mb-4">Recrutement</h4>
                                  <div className="flex items-center justify-between gap-4">
                                    <span className="text-slate-700">Ouvertures de la page</span>
                                    <span className="font-black text-slate-900">{recruitmentPageViews}</span>
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                                  <h4 className="font-black text-slate-900 mb-4">Clics externes</h4>
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between gap-4">
                                      <span className="text-slate-700">Blog</span>
                                      <span className="font-black text-slate-900">{analyticsSummary.externalClicks.blog}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-4">
                                      <span className="text-slate-700">Contact</span>
                                      <span className="font-black text-slate-900">{analyticsSummary.externalClicks.contact}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-4">
                                      <span className="text-slate-700">Zoom</span>
                                      <span className="font-black text-slate-900">{analyticsSummary.externalClicks.zoom}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="mt-8 border-t border-slate-200 pt-8">
                            <h3 className="text-xl font-black text-slate-900 mb-2">Statistiques détaillées du mois</h3>
                            <p className="text-slate-600 mb-6">
                              Pages les plus visitées, cours les plus consultés et clics externes pour le mois en cours.
                            </p>

                            {analyticsSummaryLoading && (
                              <p className="text-slate-500">Chargement des statistiques détaillées du mois...</p>
                            )}

                            {analyticsSummaryError && (
                              <p className="text-rose-600">{analyticsSummaryError}</p>
                            )}

                            {!analyticsSummaryLoading && !analyticsSummaryError && analyticsSummary && (
                              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                                  <h4 className="font-black text-slate-900 mb-4">Pages les plus visitées</h4>
                                  <div className="space-y-3">
                                    {analyticsSummary.monthly.pageViews.length > 0 ? analyticsSummary.monthly.pageViews.slice(0, 5).map((entry) => (
                                      <div key={`monthly-page-view-${entry.section}`} className="flex items-center justify-between gap-4">
                                        <span className="text-slate-700">{entry.section}</span>
                                        <span className="font-black text-slate-900">{entry.count}</span>
                                      </div>
                                    )) : (
                                      <p className="text-slate-500">Aucune donnée pour le moment.</p>
                                    )}
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                                  <h4 className="font-black text-slate-900 mb-4">Cours les plus consultés</h4>
                                  <div className="space-y-3">
                                    {analyticsSummary.monthly.courseViews.length > 0 ? analyticsSummary.monthly.courseViews.slice(0, 5).map((entry) => (
                                      <div key={`monthly-course-view-${entry.courseId}`} className="flex items-center justify-between gap-4">
                                        <span className="text-slate-700">{visibleTopics.find((topic) => topic.id === entry.courseId)?.title || entry.courseId}</span>
                                        <span className="font-black text-slate-900">{entry.count}</span>
                                      </div>
                                    )) : (
                                      <p className="text-slate-500">Aucune donnée pour le moment.</p>
                                    )}
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                                  <h4 className="font-black text-slate-900 mb-4">Balado</h4>
                                  <div className="flex items-center justify-between gap-4">
                                    <span className="text-slate-700">Ouvertures de la page / épisodes</span>
                                    <span className="font-black text-slate-900">{analyticsSummary.monthly.podcastOpens}</span>
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                                  <h4 className="font-black text-slate-900 mb-4">Recrutement</h4>
                                  <div className="flex items-center justify-between gap-4">
                                    <span className="text-slate-700">Ouvertures de la page</span>
                                    <span className="font-black text-slate-900">{monthlyRecruitmentPageViews}</span>
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50">
                                  <h4 className="font-black text-slate-900 mb-4">Clics externes</h4>
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between gap-4">
                                      <span className="text-slate-700">Blog</span>
                                      <span className="font-black text-slate-900">{analyticsSummary.monthly.externalClicks.blog}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-4">
                                      <span className="text-slate-700">Contact</span>
                                      <span className="font-black text-slate-900">{analyticsSummary.monthly.externalClicks.contact}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-4">
                                      <span className="text-slate-700">Zoom</span>
                                      <span className="font-black text-slate-900">{analyticsSummary.monthly.externalClicks.zoom}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
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
                Partage, reproduction, utilisation du matériel avec approbation préliminaire et à des fins éducatives et académiques seulement.
              </p>
            </footer>
          </>
        )}
      </main>

      {showOnboarding && effectiveUserRole === 'student' && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/55 p-4">
          <div className="flex min-h-full items-start justify-center py-4 md:items-center">
            <div className="w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl md:p-8">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-indigo-500">Bienvenue</p>
            <h2 className="mt-2 text-3xl font-black text-slate-900">Comment utiliser la plateforme</h2>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="font-black text-slate-900">Par où commencer</h3>
                <p className="mt-2 text-slate-600">Va sur la page Accueil pour voir les dernières annonces, les nouveaux contenus et ce qu&apos;il y a à faire cette semaine.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="font-black text-slate-900">Où trouver vos contenus</h3>
                <p className="mt-2 text-slate-600">Les documents généraux sont dans Contenu. Chaque cours possède aussi son propre contenu, ses lectures et ses cartes mémo.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="font-black text-slate-900">Comment réviser avec les cartes mémo</h3>
                <p className="mt-2 text-slate-600">Ouvre Cartes mémo, charge les cartes du cours puis lance la révision en mode flashcards.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="font-black text-slate-900">Fonctions utiles</h3>
                <p className="mt-2 text-slate-600">Tu peux enregistrer des favoris, utiliser la recherche globale, écouter le balado et consulter les annonces importantes.</p>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={dismissOnboarding}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors"
              >
                C&apos;est compris
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-indigo-500">Contact</p>
                <h2 className="mt-2 text-3xl font-black text-slate-900">Formulaire de contact</h2>
                <p className="mt-3 text-slate-600">
                  Utilise ce formulaire pour demander un mot de passe ou nous écrire directement.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowContactModal(false);
                  setContactSubmitError(null);
                  setContactSubmitSuccess(null);
                }}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
                aria-label="Fermer le formulaire de contact"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="mt-6">
              {renderContactRequestForm()}
            </div>
          </div>
        </div>
      )}

      {duplicateState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-indigo-500">Dupliquer</p>
            <h2 className="mt-2 text-3xl font-black text-slate-900">
              {duplicateState.kind === 'content' ? 'Dupliquer un contenu' : 'Dupliquer une carte mémo'}
            </h2>
            <p className="mt-3 text-slate-600">
              Choisis le cours de destination pour copier <span className="font-semibold">{duplicateState.item.title || duplicateState.item.question}</span>.
            </p>

            <label className="mt-6 block">
              <span className="text-sm font-semibold text-slate-700">Cours de destination</span>
              <select
                value={duplicateTargetCourseId}
                onChange={(event) => setDuplicateTargetCourseId(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Choisir un cours</option>
                {visibleTopics.map((topic) => (
                  <option key={`duplicate-topic-${topic.id}`} value={topic.id}>{topic.title}</option>
                ))}
              </select>
            </label>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setDuplicateState(null);
                  setDuplicateTargetCourseId('');
                }}
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-5 py-3 text-slate-700 font-bold hover:bg-slate-100 transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => { void confirmDuplicate(); }}
                disabled={!duplicateTargetCourseId}
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Dupliquer
              </button>
            </div>
          </div>
        </div>
      )}

      {showFlashcards && flashcardModalCards.length > 0 && (
        <FlashcardDeck 
          cards={flashcardModalCards} 
          onClose={() => {
            setShowFlashcards(false);
            setFlashcardModalCards([]);
          }} 
        />
      )}

      {coursePasswordTopic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl">
            <div className="mb-6">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-indigo-500">Cours protégé</p>
              <h2 className="mt-2 text-3xl font-black text-slate-900">{coursePasswordTopic.title}</h2>
              <p className="mt-3 text-slate-600">
                Entre le mot de passe de ce cours pour continuer en mode étudiant.
              </p>
            </div>

            <form onSubmit={handleCourseUnlock} className="space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Mot de passe du cours</span>
                <input
                  type="password"
                  value={coursePasswordValue}
                  onChange={(event) => setCoursePasswordValue(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Entrez le mot de passe"
                  autoFocus
                />
              </label>

              {coursePasswordError && (
                <p className="text-sm font-medium text-rose-600">{coursePasswordError}</p>
              )}

              <button
                type="button"
                onClick={() => openPasswordHelpForm(coursePasswordTopic.title, false)}
                className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
              >
                <i className="fas fa-circle-question text-xs"></i>
                Vous n&apos;avez pas ce mot de passe ?
              </button>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="submit"
                  disabled={coursePasswordLoading}
                  className="inline-flex flex-1 items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {coursePasswordLoading ? 'Vérification...' : 'Déverrouiller le cours'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCoursePasswordTopic(null);
                    setCoursePasswordValue('');
                    setCoursePasswordError(null);
                  }}
                  className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-300 px-5 py-3 text-slate-700 font-bold hover:bg-slate-100 transition-colors"
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
