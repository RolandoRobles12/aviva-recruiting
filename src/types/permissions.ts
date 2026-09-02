// ─── Role Types ────────────────────────────────────────────────────────────────

export type RoleType = 'admin' | 'reclutador' | 'lider' | 'nomina' | 'legal';

/** Legacy value stored in Firestore before the roles redesign */
export type StoredRoleType = RoleType | 'recruiter';

/** Normalize legacy 'recruiter' → 'reclutador' */
export function normalizeRole(role: StoredRoleType): RoleType {
  return role === 'recruiter' ? 'reclutador' : role;
}

// ─── Permission Keys ───────────────────────────────────────────────────────────

export type PermissionKey =
  // Candidatos
  | 'candidates_view_own'
  | 'candidates_view_all'
  | 'candidates_create'
  // Proceso de reclutamiento
  | 'process_send_offer'
  | 'process_reissue_offer'
  | 'process_review_docs'
  | 'process_delete_document'
  | 'process_reissue_contract'
  | 'process_view_contracts'
  | 'process_provision_accounts'
  // Pruebas psicométricas
  | 'psychometric_sessions'
  | 'psychometric_manage_bank'
  // Reportes
  | 'reports_view'
  // Configuración
  | 'config_templates'
  | 'config_settings'
  | 'config_form'
  // Administración
  | 'admin_manage_roles'
  | 'admin_manage_users';

export type RolePermissions = Record<PermissionKey, boolean>;

// ─── Permission Groups (for UI rendering) ─────────────────────────────────────

export interface PermissionItem {
  key: PermissionKey;
  label: string;
  description: string;
}

export interface PermissionGroup {
  id: string;
  label: string;
  items: PermissionItem[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'candidates',
    label: 'Candidatos',
    items: [
      {
        key: 'candidates_view_own',
        label: 'Ver sus propios candidatos',
        description: 'Acceso a los candidatos que el usuario creó',
      },
      {
        key: 'candidates_view_all',
        label: 'Ver todos los candidatos',
        description: 'Acceso a candidatos de todos los reclutadores',
      },
      {
        key: 'candidates_create',
        label: 'Crear candidatos',
        description: 'Agregar nuevos candidatos al sistema',
      },
    ],
  },
  {
    id: 'process',
    label: 'Proceso de Reclutamiento',
    items: [
      {
        key: 'process_send_offer',
        label: 'Enviar carta oferta',
        description: 'Reenviar el correo de carta oferta al candidato',
      },
      {
        key: 'process_reissue_offer',
        label: 'Reemitir carta oferta',
        description: 'Reemitir la carta con datos corregidos — invalida la oferta y el contrato firmados',
      },
      {
        key: 'process_review_docs',
        label: 'Revisar documentos',
        description: 'Ver y marcar documentos como válidos o inválidos',
      },
      {
        key: 'process_delete_document',
        label: 'Eliminar documento cargado',
        description: 'Borra un documento subido por el candidato (y su archivo) para que lo vuelva a subir',
      },
      {
        key: 'process_reissue_contract',
        label: 'Reemitir contrato',
        description: 'Reemitir el contrato con datos corregidos — invalida el contrato firmado y envía uno nuevo',
      },
      {
        key: 'process_view_contracts',
        label: 'Ver contratos firmados',
        description: 'Acceder a los contratos y evidencias de firma',
      },
      {
        key: 'process_provision_accounts',
        label: 'Provisionar cuentas corporativas',
        description: 'Crear correo corporativo, Slack y HubSpot',
      },
    ],
  },
  {
    id: 'psychometric',
    label: 'Pruebas Psicométricas',
    items: [
      {
        key: 'psychometric_sessions',
        label: 'Generar y revisar pruebas',
        description: 'Crear sesiones de prueba psicométrica y ver los resultados de los candidatos',
      },
      {
        key: 'psychometric_manage_bank',
        label: 'Editar banco de preguntas',
        description: 'Configurar preguntas, escenarios y ponderaciones de la prueba psicométrica',
      },
    ],
  },
  {
    id: 'reports',
    label: 'Reportes',
    items: [
      {
        key: 'reports_view',
        label: 'Ver dashboard de operación',
        description: 'Acceso al reporte de promotores por plaza, vertical y desempeño',
      },
    ],
  },
  {
    id: 'config',
    label: 'Configuración',
    items: [
      {
        key: 'config_templates',
        label: 'Editar plantillas',
        description: 'Crear y editar plantillas de oferta, contrato y correo',
      },
      {
        key: 'config_settings',
        label: 'Ajustes generales',
        description: 'Configurar recordatorios, duración de enlaces y conexión Gmail',
      },
      {
        key: 'config_form',
        label: 'Configurar formulario',
        description: 'Gestionar preguntas y documentos requeridos en el formulario',
      },
    ],
  },
  {
    id: 'admin',
    label: 'Administración',
    items: [
      {
        key: 'admin_manage_roles',
        label: 'Gestionar roles y permisos',
        description: 'Editar los permisos de cada rol del sistema',
      },
      {
        key: 'admin_manage_users',
        label: 'Gestionar usuarios',
        description: 'Ver y cambiar el rol de los usuarios del sistema',
      },
    ],
  },
];

// ─── All-permissions-true (Admin) ─────────────────────────────────────────────

export const ALL_PERMISSIONS: RolePermissions = {
  candidates_view_own: true,
  candidates_view_all: true,
  candidates_create: true,
  process_send_offer: true,
  process_reissue_offer: true,
  process_review_docs: true,
  process_delete_document: true,
  process_reissue_contract: true,
  process_view_contracts: true,
  process_provision_accounts: true,
  psychometric_sessions: true,
  psychometric_manage_bank: true,
  reports_view: true,
  config_templates: true,
  config_settings: true,
  config_form: true,
  admin_manage_roles: true,
  admin_manage_users: true,
};

// ─── Default permissions per role ─────────────────────────────────────────────

export const ROLE_DEFAULTS: Record<RoleType, RolePermissions> = {
  admin: { ...ALL_PERMISSIONS },

  reclutador: {
    candidates_view_own: true,
    candidates_view_all: false,
    candidates_create: true,
    process_send_offer: true,
    process_reissue_offer: false,
    process_review_docs: true,
    process_delete_document: false,
    process_reissue_contract: false,
    process_view_contracts: false,
    process_provision_accounts: false,
    psychometric_sessions: true,
    psychometric_manage_bank: false,
    reports_view: false,
    config_templates: false,
    config_settings: false,
    config_form: false,
    admin_manage_roles: false,
    admin_manage_users: false,
  },

  lider: {
    candidates_view_own: true,
    candidates_view_all: true,
    candidates_create: true,
    process_send_offer: true,
    process_reissue_offer: true,
    process_review_docs: true,
    process_delete_document: false,
    process_reissue_contract: true,
    process_view_contracts: true,
    process_provision_accounts: true,
    psychometric_sessions: true,
    psychometric_manage_bank: false,
    reports_view: true,
    config_templates: false,
    config_settings: true,
    config_form: false,
    admin_manage_roles: false,
    admin_manage_users: false,
  },

  nomina: {
    candidates_view_own: false,
    candidates_view_all: true,
    candidates_create: false,
    process_send_offer: false,
    process_reissue_offer: true,
    process_review_docs: false,
    process_delete_document: false,
    process_reissue_contract: true,
    process_view_contracts: true,
    process_provision_accounts: true,
    psychometric_sessions: false,
    psychometric_manage_bank: false,
    reports_view: false,
    config_templates: false,
    config_settings: false,
    config_form: false,
    admin_manage_roles: false,
    admin_manage_users: false,
  },

  legal: {
    candidates_view_own: false,
    candidates_view_all: true,
    candidates_create: false,
    process_send_offer: false,
    process_reissue_offer: true,
    process_review_docs: true,
    process_delete_document: false,
    process_reissue_contract: true,
    process_view_contracts: true,
    process_provision_accounts: false,
    psychometric_sessions: false,
    psychometric_manage_bank: false,
    reports_view: false,
    config_templates: false,
    config_settings: false,
    config_form: false,
    admin_manage_roles: false,
    admin_manage_users: false,
  },
};

// ─── Role metadata (label, color, description) ────────────────────────────────

export const ROLE_META: Record<RoleType, { label: string; color: string; description: string }> = {
  admin:      { label: 'Admin',                  color: 'red',    description: 'Acceso completo al sistema' },
  reclutador: { label: 'Reclutador',             color: 'blue',   description: 'Gestión de candidatos y proceso de reclutamiento' },
  lider:      { label: 'Líder de Reclutamiento', color: 'purple', description: 'Supervisión del equipo y proceso completo' },
  nomina:     { label: 'Nómina',                 color: 'green',  description: 'Acceso a contratos y provisión de cuentas' },
  legal:      { label: 'Legal',                  color: 'amber',  description: 'Revisión de documentos y contratos' },
};

export const ROLE_ORDER: RoleType[] = ['reclutador', 'lider', 'nomina', 'legal', 'admin'];
