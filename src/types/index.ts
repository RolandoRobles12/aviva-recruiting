import { Timestamp } from 'firebase/firestore';

// ─── Document Types ───────────────────────────────────────────────────────────

export type DocumentType =
  | 'acta_nacimiento'
  | 'curp'
  | 'nss'
  | 'caratula_bancaria'
  | 'certificado_estudios'
  | 'constancia_fiscal'
  | 'carta_recomendacion'
  | 'ine'
  | 'comprobante_domicilio'
  | 'foto_profesional'
  | 'aviso_retencion'
  | 'estado_cuenta_fonacot';

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
  documentTypeDetected?: string;
  processedAt: Timestamp;
}

// ─── Form Answers (candidate questionnaire) ──────────────────────────────────

export type Parentesco = 'padre_madre' | 'hermano' | 'esposo' | 'hijo';

export interface FormAnswers {
  estadoCivil?: 'soltero' | 'casado' | 'union_libre';
  tieneHijos?: boolean;
  tieneInfonavit?: boolean;
  tieneFonacot?: boolean;
  tallaPlayera?: 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
  sobreTi?: string;
  trabajoEntidadFinanciera?: boolean;
  nombreEntidadFinanciera?: string;
  // Beneficiario
  beneficiarioNombre?: string;
  beneficiarioTelefono?: string;
  beneficiarioCorreo?: string;
  beneficiarioParentesco?: Parentesco;
  // Contacto de emergencia 1
  contacto1Nombre?: string;
  contacto1Telefono?: string;
  contacto1Correo?: string;
  contacto1Parentesco?: Parentesco;
  // Contacto de emergencia 2
  contacto2Nombre?: string;
  contacto2Telefono?: string;
  contacto2Correo?: string;
  contacto2Parentesco?: Parentesco;
  // Dynamic custom questions (keyed by FormQuestion.id)
  customAnswers?: Record<string, string>;
}

export const PARENTESCO_LABELS: Record<Parentesco, string> = {
  padre_madre: 'Padre / Madre',
  hermano: 'Hermano(a)',
  esposo: 'Esposo(a)',
  hijo: 'Hijo(a)',
};

// ─── Form Questions (configurable) ───────────────────────────────────────────

export type QuestionType = 'text' | 'textarea' | 'yes_no' | 'radio' | 'select';

export interface FormQuestion {
  id: string;
  label: string;
  type: QuestionType;
  options?: string[];   // for radio / select
  required: boolean;
  enabled: boolean;
  order: number;
  /** If set, this question maps to a hardcoded field in FormAnswers with special rendering */
  builtinKey?: string;
}

// ─── Candidate ────────────────────────────────────────────────────────────────

export type CandidateStatus =
  | 'offer_sent'       // offer letter sent, pending candidate signature
  | 'offer_signed'     // candidate signed offer, document collection active
  | 'invited'          // documents link sent, no documents yet
  | 'in_progress'      // uploading documents
  | 'under_review'     // all documents uploaded, team reviewing
  | 'approved'         // all documents valid
  | 'rejected'         // rejected
  | 'contract_sent'    // employment contract sent, pending signature
  | 'contract_signed'  // candidate signed contract
  | 'email_pending'    // waiting for IT to create corporate email (Jira ticket)
  | 'email_ready'      // corporate email created, HubSpot/Slack accounts provisioned
  | 'induction';       // induction email sent, training phase

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
  // Form answers (questionnaire)
  formAnswers?: FormAnswers;
  // Completion tracking
  completionPercentage: number;
  // Follow-up emails
  lastReminderSentAt?: Timestamp;
  reminderCount: number;
  notes?: string;
  // Offer letter
  offerToken?: string;
  offerExpiresAt?: Timestamp;
  offerSignedAt?: Timestamp;
  offerSignatureUrl?: string;
  offerPdfUrl?: string;
  offerTemplateId?: string;
  // Contract
  contractToken?: string;
  contractExpiresAt?: Timestamp;
  contractSignedAt?: Timestamp;
  contractSignatureUrl?: string;
  contractPdfUrl?: string;
  contractEvidenceUrl?: string;
  contractTemplateId?: string;
  // Corporate email (Correos stage)
  corporateEmail?: string;
  jiraTicketKey?: string;
  jiraTicketId?: string;
  // Viterbit integration
  viterbitCandidatureId?: string;
  viterbitJobId?: string;
  viterbitStageIds?: {
    ofertaEnviada: string;
    documentos: string;
    contrato: string;
    correos: string;
    induccion: string;
  };
  // Viterbit job custom fields (populated from job API on webhook)
  viterbitSalary?: string;
  viterbitStartDate?: string;
  viterbitHiringManager?: string;
  viterbitCompany?: string;
  viterbitDepartmentProfile?: string;
}

// ─── Offer Templates ──────────────────────────────────────────────────────────

export interface OfferTemplate {
  id: string;
  name: string;               // e.g. "Promotor de crédito"
  positionKeywords: string[]; // job title substrings to auto-match (lowercase)
  // Fallback values used only when Viterbit job data is unavailable
  salary?: string;
  benefits?: string;          // Benefits package — defined per template (same for all positions)
  startDate?: string;
  bodyHtml: string;           // HTML with {{variable}} placeholders
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Recruiter / Auth ─────────────────────────────────────────────────────────

export interface GmailTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  scope: string;
}

export interface RecruiterProfile {
  uid: string;
  email: string;
  displayName: string;
  photoUrl?: string;
  role: 'admin' | 'recruiter';
  createdAt: Timestamp;
  gmailConnected?: boolean;
}

// ─── Email ────────────────────────────────────────────────────────────────────

export type EmailTemplateType = 'invitation' | 'reminder' | 'approved' | 'rejected' | 'ocr_error' | 'offer' | 'onboarding' | 'contract' | 'induction';

// ─── Contract Templates ──────────────────────────────────────────────────────

export type ContractTemplateType = 'html' | 'pdf';

/** A detected or manually-placed field on a PDF page (signature, initials, date, text). */
export interface PdfFieldPosition {
  id: string;
  type: 'signature' | 'initials' | 'date' | 'text';
  pageIndex: number; // 0-based
  x: number;         // points from left
  y: number;         // points from bottom (PDF coordinate system)
  width: number;
  height: number;
  label?: string;
  required: boolean;
}

/** Where to overlay a template variable on a PDF page. */
export interface PdfVariableMapping {
  variableName: string; // e.g. 'firstName', 'salary'
  pageIndex: number;
  x: number;
  y: number;
  fontSize: number;
  fontWeight?: 'normal' | 'bold';
}

export interface ContractTemplate {
  id: string;
  name: string;
  positionKeywords: string[];
  templateType: ContractTemplateType; // 'html' for rich-text, 'pdf' for uploaded PDF
  // ── HTML template fields ──
  bodyHtml: string;  // HTML with {{variable}} placeholders
  // ── PDF template fields ──
  pdfUrl?: string;            // Download URL of the uploaded PDF
  pdfStoragePath?: string;    // Firebase Storage path
  pdfPageCount?: number;      // Number of pages in the PDF
  pdfFileSize?: number;       // File size in bytes
  signatureFields?: PdfFieldPosition[];     // Where signatures/initials go
  variableMappings?: PdfVariableMapping[];  // Where to overlay variables
  // ── Initials configuration ──
  initialsOnEveryPage: boolean; // Place initials on every page
  initialsPosition?: {          // Default position for initials
    x: number;
    y: number;
    width: number;
    height: number;
  };
  // ── Metadata ──
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

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
  offerSent: number;    // offer_sent — pending signature
  documents: number;   // offer_signed + invited + in_progress
  underReview: number;
  approved: number;
  rejected: number;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface EmailTemplateSettings {
  subject: string;
  bodyText: string;
}

export interface EmailTemplatesSettings {
  invitation: EmailTemplateSettings;
  reminder: EmailTemplateSettings;
  offer: EmailTemplateSettings;
  contract: EmailTemplateSettings;
}

export interface ReminderSettings {
  enabled: boolean;
  intervalHours: number;
  maxReminders: number;
}

export interface LinkDurationSettings {
  formDays: number;
  offerDays: number;
  contractDays: number;
}

export interface DocumentSetting {
  label: string;
  description: string;
  required: boolean;
}

export type DocumentSettings = Record<DocumentType, DocumentSetting>;

// ─── Document Config ──────────────────────────────────────────────────────────

export const DOCUMENT_CONFIG: Record<DocumentType, { label: string; description: string; required: boolean }> = {
  acta_nacimiento: {
    label: 'Acta de Nacimiento',
    description: 'Copia de tu acta de nacimiento',
    required: true,
  },
  curp: {
    label: 'CURP',
    description: 'Clave Única de Registro de Población (documento oficial)',
    required: true,
  },
  nss: {
    label: 'Número de Seguridad Social',
    description: 'Documento con tu Número de Seguridad Social (NSS)',
    required: true,
  },
  caratula_bancaria: {
    label: 'Carátula Bancaria',
    description: 'Carátula bancaria o último estado de cuenta',
    required: true,
  },
  certificado_estudios: {
    label: 'Certificado de Estudios',
    description: 'Último certificado de estudios oficial (Título universitario, Certificado de bachiller o preparatoria)',
    required: true,
  },
  constancia_fiscal: {
    label: 'Constancia de Situación Fiscal',
    description: 'Constancia de Situación Fiscal Actualizada (SAT)',
    required: true,
  },
  carta_recomendacion: {
    label: 'Carta de Recomendación',
    description: 'Copia de carta de recomendación o constancia laboral',
    required: true,
  },
  ine: {
    label: 'INE',
    description: 'Credencial de elector vigente (ambos lados)',
    required: true,
  },
  comprobante_domicilio: {
    label: 'Comprobante de Domicilio',
    description: 'Comprobante de domicilio menor a 3 meses (luz, agua, teléfono)',
    required: true,
  },
  foto_profesional: {
    label: 'Foto Profesional',
    description: 'Sube una foto profesional tuya',
    required: true,
  },
  aviso_retencion: {
    label: 'Aviso de Retención (INFONAVIT)',
    description: 'Documento de aviso de retención del INFONAVIT',
    required: false, // conditional on tieneInfonavit
  },
  estado_cuenta_fonacot: {
    label: 'Estado de Cuenta (FONACOT)',
    description: 'Estado de cuenta del crédito FONACOT',
    required: false, // conditional on tieneFonacot
  },
};

/** Core required document types (always shown) */
export const DOCUMENT_TYPES_REQUIRED: DocumentType[] = [
  'acta_nacimiento',
  'curp',
  'nss',
  'caratula_bancaria',
  'certificado_estudios',
  'constancia_fiscal',
  'carta_recomendacion',
  'ine',
  'comprobante_domicilio',
  'foto_profesional',
];

/** Conditional document types */
export const DOCUMENT_TYPES_CONDITIONAL: DocumentType[] = [
  'aviso_retencion',
  'estado_cuenta_fonacot',
];

/** All document types (for iteration) */
export const DOCUMENT_TYPES: DocumentType[] = [
  ...DOCUMENT_TYPES_REQUIRED,
  ...DOCUMENT_TYPES_CONDITIONAL,
];
