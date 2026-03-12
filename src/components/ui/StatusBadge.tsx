import type { CandidateStatus, DocumentStatus } from '../../types';

const CANDIDATE_STATUS_CONFIG: Record<CandidateStatus, { label: string; className: string }> = {
  offer_sent:   { label: 'Carta enviada',  className: 'badge-offer-sent' },
  offer_signed: { label: 'Carta firmada',  className: 'badge-offer-signed' },
  invited:      { label: 'Invitado',       className: 'badge-pending' },
  in_progress:  { label: 'En progreso',    className: 'badge-review' },
  under_review: { label: 'En revisión',    className: 'badge-review' },
  approved:     { label: 'Aprobado',       className: 'badge-valid' },
  rejected:     { label: 'Rechazado',      className: 'badge-invalid' },
  onboarding:   { label: 'Onboarding',     className: 'badge-onboarding' },
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
