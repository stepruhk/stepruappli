import type { Flashcard } from '../types';
export const GIFT_MAX_QUESTIONS: number;
export const GIFT_MAX_BYTES: number;
export type GiftQuestion = Omit<Flashcard, 'id' | 'courseId' | 'createdAt'> & { title: string };
export function parseGift(input: string): { questions: GiftQuestion[]; errors: { line: number; message: string }[] };
