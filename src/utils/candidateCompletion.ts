import type { Candidate, DocumentType } from '../types';
import { DOCUMENT_TYPES_REQUIRED } from '../types';

export function getCandidateDocTypes(c: Candidate): DocumentType[] {
  const types: DocumentType[] = [...DOCUMENT_TYPES_REQUIRED];
  if (c.formAnswers?.tieneInfonavit) types.push('aviso_retencion');
  if (c.formAnswers?.tieneFonacot) types.push('estado_cuenta_fonacot');
  return types;
}

export function computeCompletion(c: Candidate): number {
  const docTypes = getCandidateDocTypes(c);
  const validCount = docTypes.filter((t) => c.documents[t]?.status === 'valid').length;
  const hasFormAnswers = c.formAnswers != null;
  const total = docTypes.length + 1;
  const completed = validCount + (hasFormAnswers ? 1 : 0);
  return Math.round((completed / total) * 100);
}
