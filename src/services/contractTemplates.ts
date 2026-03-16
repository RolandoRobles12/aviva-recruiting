import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { ContractTemplate } from '../types';

const COL = 'contract_templates';

export async function getContractTemplates(): Promise<ContractTemplate[]> {
  const q = query(collection(db, COL), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ContractTemplate));
}

export async function createContractTemplate(
  data: Omit<ContractTemplate, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const ref = await addDoc(collection(db, COL), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateContractTemplate(
  id: string,
  data: Partial<Omit<ContractTemplate, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  await updateDoc(doc(db, COL, id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteContractTemplate(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}
