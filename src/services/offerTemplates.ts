import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { OfferTemplate } from '../types';

const COL = 'offer_templates';

export async function getOfferTemplates(): Promise<OfferTemplate[]> {
  const q = query(collection(db, COL), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as OfferTemplate));
}

export async function getOfferTemplate(id: string): Promise<OfferTemplate | null> {
  const snap = await getDoc(doc(db, COL, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as OfferTemplate;
}

export async function createOfferTemplate(
  data: Omit<OfferTemplate, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const ref = await addDoc(collection(db, COL), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateOfferTemplate(
  id: string,
  data: Partial<Omit<OfferTemplate, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  await updateDoc(doc(db, COL, id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteOfferTemplate(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}
