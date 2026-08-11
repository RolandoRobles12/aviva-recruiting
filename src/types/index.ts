import { Timestamp } from 'firebase/firestore';

// ─── Candidate Profiles ───────────────────────────────────────────────────────

export const CANDIDATE_PROFILES = [
  'Promotor/a Aviva tu Compra',
  'Promotor/a Aviva tu Compra CM',
  'Promotor/a Aviva tu Casa',
  'Promotor/a Aviva tu Compra (Comodín)',
  'Promotor/a Aviva tu Compra (Temporal)',
  'Promotor/a Aviva tu Compra (Internalización)',
  'Promotor/a Aviva tu Negocio',
  'Trainee Sucursal (Kiosk Trainee)',
  'Gerente de Sucursal (Kiosk Manager)',
] as const;

export type CandidateProfile = typeof CANDIDATE_PROFILES[number];

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
  | 'offer_held'           // candidate created but offer withheld — salary, start date, buró or psicometría de integridad still unknown in Viterbit
  | 'offer_sent'           // offer letter sent, pending candidate signature
  | 'offer_signed'         // candidate signed offer, document collection active
  | 'invited'              // documents link sent, no documents yet
  | 'in_progress'          // uploading documents
  | 'under_review'         // all documents uploaded, team reviewing
  | 'approved'             // all documents valid
  | 'rejected'             // rejected
  | 'contract_sent'        // employment contract sent, pending signature
  | 'contract_signed'      // candidate signed contract
  | 'email_pending'        // legacy — waiting for corporate email (Jira flow, no longer used)
  | 'email_ready'          // corporate email created and HubSpot owner provisioned
  | 'induction'            // in Viterbit Onboarding stage, waiting for email provisioning
  | 'onboarding_iniciado'  // first LMS login completed
  | 'promotor_exitoso'     // met 30-day HubSpot deal target
  | 'bajo_desempeno'       // missed 30-day HubSpot deal target
  | 'disqualified';        // manually disqualified at any stage

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
  // True when OCR-sourced contract data (CURP, RFC, domicilio, CLABE, banco,
  // NSS) is missing or below the confidence threshold — the contract was
  // generated but held from the candidate until a recruiter confirms the data.
  contractReviewRequired?: boolean;
  contractReviewReasons?: string[];
  // Corporate email (Correos stage)
  corporateEmail?: string;
  activatedAt?: Timestamp;
  jiraTicketKey?: string;
  jiraTicketId?: string;
  // Google Drive
  driveFolderId?: string;
  driveSyncStatus?: {
    syncedAt: Timestamp;
    uploaded: string[];
    failed: string[];
    skipped: string[];
  };
  // HubSpot
  hubspotOwnerId?: string;
  // 15/30-day performance checks
  performance15DayCheckedAt?: Timestamp;
  performance15DayDeals?: number;
  performance30DayCheckedAt?: Timestamp;
  performance30DayDeals?: number;
  // Viterbit integration
  viterbitCandidateId?: string;
  viterbitCandidatureId?: string;
  viterbitReference?: string;
  viterbitContrasena?: string;
  viterbitJobId?: string;
  viterbitStageIds?: {
    ofertaEnviada: string;
    documentos: string;
    contrato: string;
    correos: string;
    induccion: string;
    onboardingIniciado?: string;
    promotorExitoso?: string;
  };
  // Profile (canonical — set from Viterbit or manually on creation)
  profile?: string;
  // Disqualification
  disqualificationReason?: string;
  // Manual overrides for OCR-extracted contract fields (rfc, curp, clabe, nss, domicilio, banco)
  dataOverrides?: Record<string, string>;
  // Viterbit job custom fields (populated from job API on webhook)
  viterbitSalary?: string;
  viterbitStartDate?: string;      // display text, e.g. "15 de julio de 2026"
  viterbitStartDateIso?: string;   // canonical machine-readable date, e.g. "2026-07-15"
  // Screening results — the offer letter is held until both are known
  viterbitBuro?: string;
  viterbitPsicometriaIntegridad?: string;
  /** Hiring details still missing while the candidate sits in offer_held */
  offerHeldReasons?: string[];
  // Offer reissue (see reissueOffer function) — prior state archived in the
  // reissue_history subcollection
  reissuePriorStatus?: CandidateStatus;
  reissuedAt?: Timestamp;
  reissueCount?: number;
  // Contract reissue (see reissueContract function) — prior state archived in
  // the same reissue_history subcollection (scope: 'contract')
  contractReissuedAt?: Timestamp;
  contractReissueCount?: number;
  viterbitHiringManager?: string;
  viterbitCompany?: string;
  viterbitDepartmentProfile?: string;
}

// ─── Psychometric Test (standalone module — not yet linked to Candidate) ──────
// Mirrors functions/src/psychometricTest/types.ts, which is the canonical shape
// (all scoring happens server-side). Keep both files in step.

/** Traits scored by the Likert item bank (IPIP-style items adapted to Spanish). */
export type PsychometricTrait =
  | 'responsabilidad'
  | 'estabilidad_emocional'
  | 'extraversion'
  | 'amabilidad'
  | 'integridad';

export const PSYCHOMETRIC_TRAITS: PsychometricTrait[] = [
  'responsabilidad',
  'estabilidad_emocional',
  'extraversion',
  'amabilidad',
  'integridad',
];

/** Likert scales that measure response style and never enter the profile. */
export type PsychometricValidityScale = 'deseabilidad_social' | 'infrecuencia';

export const PSYCHOMETRIC_VALIDITY_SCALES: PsychometricValidityScale[] = [
  'deseabilidad_social',
  'infrecuencia',
];

export type PsychometricLikertScale = PsychometricTrait | PsychometricValidityScale;

export const PSYCHOMETRIC_LIKERT_SCALES: PsychometricLikertScale[] = [
  ...PSYCHOMETRIC_TRAITS,
  ...PSYCHOMETRIC_VALIDITY_SCALES,
];

/** Scales that appear as a score in the recruiter's report. */
export type PsychometricScoredScale = PsychometricTrait | 'sjt';

export const PSYCHOMETRIC_SCORED_SCALES: PsychometricScoredScale[] = [...PSYCHOMETRIC_TRAITS, 'sjt'];

export const PSYCHOMETRIC_TRAIT_LABELS: Record<PsychometricTrait, string> = {
  responsabilidad: 'Responsabilidad',
  estabilidad_emocional: 'Estabilidad emocional',
  extraversion: 'Extraversión / Asertividad',
  amabilidad: 'Amabilidad / Orientación de servicio',
  integridad: 'Integridad / Apego a normas',
};

export const PSYCHOMETRIC_SCALE_LABELS: Record<PsychometricLikertScale | 'sjt', string> = {
  ...PSYCHOMETRIC_TRAIT_LABELS,
  sjt: 'Juicio situacional',
  deseabilidad_social: 'Deseabilidad social (validez)',
  infrecuencia: 'Infrecuencia (validez)',
};

export interface PsychometricLikertQuestion {
  id: string;
  type: 'likert';
  text: string;
  scale: PsychometricLikertScale;
  /** Legacy field: pre-`scale` documents stored the trait here. */
  trait?: PsychometricTrait;
  /** true if agreeing with the item means a LOW scale score (scored 6 - value) */
  reverseScored: boolean;
  enabled: boolean;
  order: number;
}

/** Instructed-response check: the text says which option to pick. */
export interface PsychometricAttentionQuestion {
  id: string;
  type: 'attention';
  text: string;
  /** The Likert value (1-5) the instruction asks for. */
  expectedValue: number;
  enabled: boolean;
  order: number;
}

export interface PsychometricSjtOption {
  text: string;
  /** Effectiveness of the response, 0 = least effective. Max is per-question. */
  score: number;
}

export interface PsychometricSjtQuestion {
  id: string;
  type: 'sjt';
  text: string; // escenario
  options: PsychometricSjtOption[];
  competency?: string;
  enabled: boolean;
  order: number;
}

export type PsychometricQuestion =
  | PsychometricLikertQuestion
  | PsychometricAttentionQuestion
  | PsychometricSjtQuestion;

export type PsychometricScaleWeights = Record<PsychometricScoredScale, number>;

export interface PsychometricBandCutoffs {
  /** score < lowMax → banda "bajo" */
  lowMax: number;
  /** lowMax <= score < highMin → "medio"; score >= highMin → "alto" */
  highMin: number;
}

/** Cutoffs used once local norms exist and scores become percentile-referenced. */
export interface PsychometricPercentileCutoffs {
  lowMaxPercentile: number;
  highMinPercentile: number;
}

export interface PsychometricQuestionCounts {
  /** ítems Likert a aplicar POR RASGO en cada sesión. 0 = usar todos los habilitados. */
  likertPerTrait: number;
  /** escenarios SJT a aplicar por sesión. 0 = usar todos los habilitados. */
  sjt: number;
  deseabilidadSocial: number;
  infrecuencia: number;
  atencion: number;
}

export interface PsychometricTestConfig {
  weights: PsychometricScaleWeights;
  bandCutoffs: PsychometricBandCutoffs;
  percentileCutoffs: PsychometricPercentileCutoffs;
  timeLimitMinutes: number;
  questionCounts: PsychometricQuestionCounts;
  /** Una escala con menos ítems respondidos se reporta "sin datos", no como 0. */
  minItemsPerScale: number;
  /** Usar normas locales para las bandas en cuanto la muestra alcance. */
  useLocalNorms: boolean;
}

export type PsychometricBand = 'bajo' | 'medio' | 'alto';

/** De dónde salió la banda: cortes absolutos o la muestra local acumulada. */
export type PsychometricNormSource = 'absoluta' | 'normas_provisionales' | 'normas_locales';

export interface PsychometricScaleResult {
  scale: PsychometricScoredScale;
  hasData: boolean;
  itemsApplied: number;
  itemsAnswered: number;
  rawAverage: number;
  normalizedScore: number; // 0-100
  percentile?: number;
  zScore?: number;
  band: PsychometricBand;
  bandSource: PsychometricNormSource;
}

export type PsychometricValidityFlag =
  | 'respuestas_incompletas'
  | 'control_atencion_fallido'
  | 'patron_repetitivo'
  | 'baja_variacion'
  | 'respuestas_muy_rapidas'
  | 'respuestas_inconsistentes'
  | 'inconsistencia_par_impar'
  | 'escala_infrecuencia_alta'
  | 'posible_deseabilidad_social';

export type PsychometricValidityVerdict = 'confiable' | 'revisar' | 'no_confiable';

export interface PsychometricValidityIndices {
  completionRate: number;
  attentionChecksTotal: number;
  attentionChecksFailed: number;
  longString: number;
  longStringRatio: number;
  /** Null cuando hay muy pocos ítems para calcularla; 0 significa "siempre la misma opción". */
  irv: number | null;
  evenOddConsistency: number | null;
  keyingInconsistency: number | null;
  medianResponseMs: number | null;
  fastResponseRatio: number;
  infrequencyScore: number | null;
  socialDesirabilityScore: number | null;
}

export interface PsychometricValidity {
  verdict: PsychometricValidityVerdict;
  severity: number;
  flags: PsychometricValidityFlag[];
  indices: PsychometricValidityIndices;
}

export interface PsychometricResult {
  /** 1 = resultados previos a normas/integridad; 2 = esta forma. */
  version: number;
  scales: Record<PsychometricScoredScale, PsychometricScaleResult>;
  compositeScore: number; // 0-100
  compositePercentile?: number;
  compositeZScore?: number;
  compositeBand: PsychometricBand;
  compositeBandSource: PsychometricNormSource;
  compositeHasData: boolean;
  validity: PsychometricValidity;
  validityFlags: PsychometricValidityFlag[];
  normSampleSize: number;
  scoredAtIso?: string;
}

export type PsychometricSessionStatus = 'pending' | 'in_progress' | 'completed' | 'expired';

export interface PsychometricAnswer {
  questionId: string;
  /** likert: 1-5. sjt: índice de la opción tal como se mostró al candidato (post-aleatorización). */
  value: number;
  /** milisegundos entre que se mostró la pregunta y se respondió — usado para detectar respuestas apresuradas. */
  responseMs?: number;
}

export interface PsychometricSession {
  id: string;
  candidateName: string;
  candidateEmail: string;
  token: string;
  status: PsychometricSessionStatus;
  createdAt: Timestamp;
  createdBy: string; // recruiter uid
  expiresAt: Timestamp; // vencimiento del enlace para iniciar
  timeLimitMinutes: number;
  startedAt?: Timestamp;
  /** orden aleatorio (fijo una vez iniciada la sesión) de ids de preguntas aplicadas */
  questionOrder?: string[];
  /** copia de las preguntas aplicadas, para que editar el banco no altere el score */
  appliedQuestions?: PsychometricQuestion[];
  /** orden aleatorio de opciones por pregunta SJT (índices originales), fijo una vez iniciada */
  optionOrders?: Record<string, number[]>;
  /** respuestas guardadas mientras la prueba sigue en curso */
  progressAnswers?: PsychometricAnswer[];
  answers?: PsychometricAnswer[];
  completedAt?: Timestamp;
  /** Puede venir en la forma v1 — normaliza con adaptPsychometricResult(). */
  result?: PsychometricResult;
}

// ─── Offer Templates ──────────────────────────────────────────────────────────

export interface OfferTemplate {
  id: string;
  name: string;               // e.g. "Promotor de crédito"
  profileNames?: string[];    // exact Viterbit profile names this template applies to (primary match)
  positionKeywords: string[]; // job title substrings to auto-match — fallback when no profileNames
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
  /** 'recruiter' is a legacy value that maps to 'reclutador' */
  role: 'admin' | 'reclutador' | 'lider' | 'nomina' | 'legal' | 'recruiter';
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
  placeholderWidth?: number;
  placeholderHeight?: number;
  erasePlaceholder?: boolean;
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
  pdfExtractedText?: string;                // Plain text extracted by AI for HTML display
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
  profile?: string;
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

export interface BrandingSettings {
  logoUrl?: string;
  companySignatureUrl?: string;
  legalRepInitialsUrl?: string;
}

export interface DocumentSetting {
  label: string;
  description: string;
  required: boolean;
  condition?: {
    questionBuiltinKey: string; // e.g. 'tiene_infonavit'
    value: boolean;
  };
}

export type DocumentSettings = Record<DocumentType, DocumentSetting>;

// ─── Document Config ──────────────────────────────────────────────────────────

export const DOCUMENT_CONFIG: Record<DocumentType, { label: string; description: string; required: boolean; condition?: { questionBuiltinKey: string; value: boolean } }> = {
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
    label: 'Fotografía',
    description: 'Sube una fotografía para que te conozcamos',
    required: true,
  },
  aviso_retencion: {
    label: 'Aviso de Retención (INFONAVIT)',
    description: 'Documento de aviso de retención del INFONAVIT',
    required: false, // conditional on tieneInfonavit
    condition: { questionBuiltinKey: 'tiene_infonavit', value: true },
  },
  estado_cuenta_fonacot: {
    label: 'Estado de Cuenta (FONACOT)',
    description: 'Estado de cuenta del crédito FONACOT',
    required: false, // conditional on tieneFonacot
    condition: { questionBuiltinKey: 'tiene_fonacot', value: true },
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
