import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { FormQuestion } from '../types';

const SETTINGS_DOC = doc(db, 'settings', 'form_questions');

export async function getFormQuestions(): Promise<FormQuestion[]> {
  const snap = await getDoc(SETTINGS_DOC);
  if (!snap.exists()) return [];
  return (snap.data().questions as FormQuestion[]) ?? [];
}

export async function saveFormQuestions(questions: FormQuestion[]): Promise<void> {
  await setDoc(SETTINGS_DOC, { questions });
}
