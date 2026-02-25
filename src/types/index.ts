import { Timestamp } from 'firebase/firestore';

// ─── Document Types ───────────────────────────────────────────────────────────

export type DocumentType =
  | 'ine'
  | 'curp'
  | 'rfc'
  | 'comprobante_domicilio'
  | 'comprobante_estudios';

export type DocumentStatus = 'pending' | 'uploaded' | 'valid' | 'invalid' | 'review';

export interface CandidateDocument {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  fileName?: string;
  storagePath?: string;
  downloadUrl?: string;
  uploadedAt?: Timestamp;
  ocrResult?: OcrResult;
  rejectionReason?: string;
}

export interface OcrResult {
  rawText: string;
  extractedData: Record<string, string>;
  confidence: number;
  validationPassed: boolean;
  validationErrors: string[];
  processedAt: Timestamp;
}

// ─── Candidate ────────────────────────────────────────────────────────────────

export type CandidateStatus =
  | 'invited'       // link sent, no documents yet
  | 'in_progress'   // uploading documents
  | 'under_review'  // all documents uploaded, team reviewing
  | 'approved'      // all documents valid
  | 'rejected';     // rejected

export interface Candidate {
  id: string;
  // Personal data
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  position: string;
  // Process metadata
  status: CandidateStatus;
  formToken: string;
  formExpiresAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string; // recruiter uid
  // Documents
  documents: Record<DocumentType, CandidateDocument>;
  // Completion tracking
  completionPercentage: number;
  // Follow-up emails
  lastReminderSentAt?: Timestamp;
  reminderCount: number;
  // Integrations
  driveFolder?: DriveFolderRef;
  sheetsRowIndex?: number;
  notes?: string;
  // Viterbit integration
  viterbitCandidatureId?: string;
}

export interface DriveFolderRef {
  folderId: string;
  folderUrl: string;
  createdAt: Timestamp;
}

// ─── Recruiter / Auth ─────────────────────────────────────────────────────────

export interface RecruiterProfile {
  uid: string;
  email: string;
  displayName: string;
  photoUrl?: string;
  role: 'admin' | 'recruiter';
  createdAt: Timestamp;
}

// ─── Email ────────────────────────────────────────────────────────────────────

export type EmailTemplateType = 'invitation' | 'reminder' | 'approved' | 'rejected' | 'ocr_error';

export interface EmailLog {
  id: string;
  candidateId: string;
  templateType: EmailTemplateType;
  sentTo: string;
  sentAt: Timestamp;
  sentBy: string;
  success: boolean;
  error?: string;
}

// ─── API Payloads ─────────────────────────────────────────────────────────────

export interface CreateCandidatePayload {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  position: string;
}

export interface SendInvitationPayload {
  candidateId: string;
}

export interface SendReminderPayload {
  candidateId: string;
  customMessage?: string;
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export interface DashboardStats {
  total: number;
  invited: number;
  inProgress: number;
  underReview: number;
  approved: number;
  rejected: number;
}

// ─── Document Config ──────────────────────────────────────────────────────────

export const DOCUMENT_CONFIG: Record<DocumentType, { label: string; description: string; required: boolean }> = {
  ine: {
    label: 'INE / Identificación Oficial',
    description: 'Credencial de elector vigente (ambos lados) u otro ID oficial',
    required: true,
  },
  curp: {
    label: 'CURP',
    description: 'Clave Única de Registro de Población (documento oficial)',
    required: true,
  },
  rfc: {
    label: 'RFC con homoclave',
    description: 'Registro Federal de Contribuyentes con homoclave (SAT)',
    required: true,
  },
  comprobante_domicilio: {
    label: 'Comprobante de Domicilio',
    description: 'Recibo de luz, agua, teléfono o estado de cuenta (máx. 3 meses)',
    required: true,
  },
  comprobante_estudios: {
    label: 'Comprobante de Estudios',
    description: 'Título, certificado o constancia de último grado de estudios',
    required: true,
  },
};

export const DOCUMENT_TYPES: DocumentType[] = [
  'ine',
  'curp',
  'rfc',
  'comprobante_domicilio',
  'comprobante_estudios',
];
