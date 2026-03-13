
export interface Flashcard {
  id: string;
  courseId?: string;
  question: string;
  answer: string;
  justification?: string;
  createdAt?: string;
}

export interface Topic {
  id: string;
  title: string;
  description: string;
  content: string;
  category: string;
  icon: string;
}

export interface StudySession {
  topicId: string;
  summary?: string;
  flashcards: Flashcard[];
  podcastAudio?: string; // data URL (audio/mp3;base64,...)
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  TOPIC_DETAIL = 'TOPIC_DETAIL',
  FLASHCARDS = 'FLASHCARDS'
}
