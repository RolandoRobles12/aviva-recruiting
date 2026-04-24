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
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../lib/firebase';
import type { ContractTemplate, PdfFieldPosition, PdfVariableMapping } from '../types';

const COL = 'contract_templates';
const API_BASE = import.meta.env.VITE_FUNCTIONS_URL ?? '';

// Firestore rejects undefined values — strip them before writing.
function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

export async function getContractTemplates(): Promise<ContractTemplate[]> {
  const q = query(collection(db, COL), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ContractTemplate));
}

export async function createContractTemplate(
  data: Omit<ContractTemplate, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const docRef = await addDoc(collection(db, COL), {
    ...stripUndefined(data),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function updateContractTemplate(
  id: string,
  data: Partial<Omit<ContractTemplate, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  await updateDoc(doc(db, COL, id), { ...stripUndefined(data), updatedAt: serverTimestamp() });
}

export async function deleteContractTemplate(id: string): Promise<void> {
  // Try to delete associated PDF from storage
  try {
    const docSnap = await getDocs(query(collection(db, COL)));
    const tmpl = docSnap.docs.find((d) => d.id === id);
    if (tmpl?.data().pdfStoragePath) {
      const storageRef = ref(storage, tmpl.data().pdfStoragePath);
      await deleteObject(storageRef);
    }
  } catch {
    // Ignore storage deletion errors
  }
  await deleteDoc(doc(db, COL, id));
}

/**
 * Upload a PDF file to Firebase Storage for use as a contract template.
 * Returns the storage path and download URL.
 */
export async function uploadContractPdf(
  file: File,
  templateName: string
): Promise<{ storagePath: string; downloadUrl: string }> {
  const safeName = templateName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
  const timestamp = Date.now();
  const storagePath = `contract_templates/${safeName}_${timestamp}.pdf`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file, {
    contentType: 'application/pdf',
    customMetadata: {
      templateName,
      uploadedAt: new Date().toISOString(),
    },
  });

  const downloadUrl = await getDownloadURL(storageRef);
  return { storagePath, downloadUrl };
}

/**
 * Call the analyzePdfTemplate Cloud Function to detect signature fields.
 */
export async function analyzePdfTemplate(
  storagePath: string
): Promise<{
  pageCount: number;
  pageDimensions: Array<{ width: number; height: number }>;
  detectedFields: PdfFieldPosition[];
  hasAcroForm: boolean;
  fileSize: number;
}> {
  const resp = await fetch(`${API_BASE}/analyzePdfTemplate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storagePath }),
  });

  if (!resp.ok) {
    const json = await resp.json().catch(() => ({}));
    throw new Error(json.error || `Error analyzing PDF: HTTP ${resp.status}`);
  }

  const json = await resp.json();
  return json.analysis;
}

export interface DetectedPlaceholder {
  occurrence: number;
  variable: string;
  context: string;
  pageIndex: number;
  xPercent: number;
  yPercent: number;
  fontSize: number;
  pageDimensions: { width: number; height: number };
}

/**
 * Call the analyzeContractVariables Cloud Function.
 * Sends the PDF to Claude, which detects each *** placeholder and identifies the variable.
 */
export async function analyzeContractVariables(storagePath: string): Promise<{
  extractedText: string;
  placeholders: DetectedPlaceholder[];
  variableMappings: PdfVariableMapping[];
  signatureFields: PdfFieldPosition[];
  pageDimensions: Array<{ width: number; height: number }>;
}> {
  const resp = await fetch(`${API_BASE}/analyzeContractVariables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storagePath }),
  });

  if (!resp.ok) {
    const json = await resp.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error || `Error al analizar el contrato: HTTP ${resp.status}`);
  }

  return resp.json();
}

/**
 * Send plain contract text to Claude. Returns the variable name for each *** in order.
 * Uses minimal tokens (plain text only, no base64 PDF) — stays within any rate limit.
 */
export async function analyzeContractText(
  text: string
): Promise<{ textMappings: Array<{ variableName: string; occurrence: number }> }> {
  const resp = await fetch(`${API_BASE}/analyzeContractVariables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!resp.ok) {
    const json = await resp.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error || `Error al analizar el contrato: HTTP ${resp.status}`);
  }

  return resp.json();
}
