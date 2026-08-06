import type { CandidateStatus, DocumentStatus } from '../../types';

const CANDIDATE_STATUS_CONFIG: Record<CandidateStatus, { label: string; className: string }> = {
  offer_held:   { label: 'Datos pendientes', className: 'badge-invalid' },
  offer_sent:   { label: 'Carta enviada',    className: 'badge-offer-sent' },
  offer_signed: { label: 'Carta firmada',  className: 'badge-offer-signed' },
  invited:      { label: 'Invitado',       className: 'badge-pending' },
  in_progress:  { label: 'En progreso',    className: 'badge-review' },
  under_review: { label: 'En revisión',    className: 'badge-review' },
  approved:     { label: 'Aprobado',       className: 'badge-valid' },
  rejected:        { label: 'Rechazado',        className: 'badge-invalid' },
  contract_sent:   { label: 'Contrato enviado', className: 'badge-review' },
  contract_signed: { label: 'Contrato firmado', className: 'badge-valid' },
  email_pending:        { label: 'Correo pendiente',     className: 'badge-review' },
  email_ready:          { label: 'Correo listo',         className: 'badge-valid' },
  induction:            { label: 'Onboarding',           className: 'badge-valid' },
  onboarding_iniciado:  { label: 'Onboarding Iniciado',  className: 'badge-review' },
  promotor_exitoso:     { label: 'Promotor Exitoso',     className: 'badge-valid' },
  bajo_desempeno:       { label: 'Bajo Desempeño',       className: 'badge-invalid' },
  disqualified:         { label: 'Descalificado',        className: 'badge-invalid' },
};

const DOCUMENT_STATUS_CONFIG: Record<DocumentStatus, { label: string; className: string }> = {
  pending: { label: 'Pendiente', className: 'badge-pending' },
  uploaded: { label: 'Subido', className: 'badge-review' },
  valid: { label: 'Válido', className: 'badge-valid' },
  invalid: { label: 'Inválido', className: 'badge-invalid' },
  review: { label: 'En revisión', className: 'badge-review' },
};

interface Props {
  status: CandidateStatus | DocumentStatus;
  type?: 'candidate' | 'document';
}

export function StatusBadge({ status, type = 'candidate' }: Props) {
  const config =
    type === 'candidate'
      ? CANDIDATE_STATUS_CONFIG[status as CandidateStatus]
      : DOCUMENT_STATUS_CONFIG[status as DocumentStatus];

  return <span className={config.className}>{config.label}</span>;
}
