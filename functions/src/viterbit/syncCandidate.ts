/**
 * Keeps a candidate record in step with Viterbit.
 *
 * Viterbit is the source of truth for who the candidate is (name, contacto) and
 * for the hiring details (salario, fecha de inicio, buró, psicometría, plaza,
 * puesto). The webhook writes those once, when the candidate is approved; every
 * later edit made in Viterbit used to stay there, leaving the dashboard — and
 * every document generated from it — on the values captured that day.
 *
 * This module re-reads Viterbit and writes back only what actually changed. It
 * is shared by the "Sincronizar" button on a candidate, the Viterbit update
 * webhook and the bulk sweep, so all three agree on what a field means.
 */

import { FieldValue } from 'firebase-admin/firestore';
import {
  fetchCandidateInfo,
  fetchCandidatureInfo,
  fetchJobInfo,
  fetchUserFullName,
} from './viterbitApi';

export interface ViterbitSnapshot {
  /** Full name as Viterbit spells it; '' when the candidate couldn't be read. */
  fullName: string;
  email: string;
  phone: string;
  reference: string;
  contrasena: string;
  buro: string;
  psicometriaIntegridad: string;
  salary: string;
  startDate: string;
  startDateIso: string;
  position: string;
  hiringManager: string;
  company: string;
  departmentProfile: string;
  plaza: string;
  plazaCity: string;
}

export const EMPTY_SNAPSHOT: ViterbitSnapshot = {
  fullName: '', email: '', phone: '', reference: '', contrasena: '',
  buro: '', psicometriaIntegridad: '',
  salary: '', startDate: '', startDateIso: '',
  position: '', hiringManager: '', company: '', departmentProfile: '',
  plaza: '', plazaCity: '',
};

export interface ViterbitIds {
  viterbitCandidateId?: string;
  viterbitCandidatureId?: string;
  viterbitJobId?: string;
}

/** Collapses whitespace and case so "  JUAN  PÉREZ " and "Juan Pérez" match. */
function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Same split the webhook uses when it creates a candidate: first token, rest. */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Reads everything Viterbit knows about a candidate in one pass.
 *
 * The job is resolved from the candidature when the stored jobId is missing, so
 * a candidate moved to another vacancy in Viterbit still syncs.
 */
export async function fetchViterbitSnapshot(
  ids: ViterbitIds,
  apiKey: string,
): Promise<ViterbitSnapshot> {
  const [candidate, candidature] = await Promise.all([
    fetchCandidateInfo(ids.viterbitCandidateId ?? '', apiKey),
    fetchCandidatureInfo(ids.viterbitCandidatureId ?? '', apiKey),
  ]);

  const jobId = candidature?.jobId || ids.viterbitJobId || '';
  const job = await fetchJobInfo(jobId, apiKey);
  const hiringManager = await fetchUserFullName(job.hiringManagerId, apiKey);

  return {
    fullName: candidate?.fullName ?? '',
    email: candidate?.email ?? '',
    phone: candidate?.phone ?? '',
    reference: candidate?.reference ?? '',
    contrasena: candidate?.contrasena ?? '',
    buro: candidate?.screening.buro ?? '',
    psicometriaIntegridad: candidate?.screening.psicometriaIntegridad ?? '',
    // Only the candidature's hired_info — the agreed salary and start date, and
    // the pair the carta oferta and the contrato print.
    salary: candidature?.salary ?? '',
    startDate: candidature?.startDate ?? '',
    startDateIso: candidature?.startDateIso ?? '',
    position: job.title,
    hiringManager,
    company: job.company,
    departmentProfile: job.departmentProfile,
    plaza: job.plaza,
    plazaCity: job.city,
  };
}

/**
 * Diffs a snapshot against the stored candidate and returns only the fields
 * that changed.
 *
 * An empty value in Viterbit never clears a stored one: a partial API response
 * (a rate-limited job read, a candidature without hired_info) would otherwise
 * wipe data the dashboard already has. The name is special-cased — the stored
 * first/last split is left alone while it still spells the same full name, so a
 * manual correction to how a compound name was split survives the sync.
 */
export function buildViterbitUpdates(
  stored: Record<string, unknown>,
  snapshot: ViterbitSnapshot,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};

  const put = (field: string, value: string) => {
    if (!value) return;
    if (asText(stored[field]).trim() === value.trim()) return;
    updates[field] = value;
  };

  if (snapshot.fullName) {
    const storedFullName = `${asText(stored.firstName)} ${asText(stored.lastName)}`;
    if (normalizeName(storedFullName) !== normalizeName(snapshot.fullName)) {
      const { firstName, lastName } = splitFullName(snapshot.fullName);
      if (firstName) {
        updates.firstName = firstName;
        updates.lastName = lastName;
      }
    }
  }

  // Email is matched case-insensitively — Viterbit echoes back whatever casing
  // was typed, and rewriting it would break nothing but churn the record.
  if (snapshot.email && asText(stored.email).trim().toLowerCase() !== snapshot.email.trim().toLowerCase()) {
    updates.email = snapshot.email;
  }

  put('phone', snapshot.phone);
  put('viterbitReference', snapshot.reference);
  put('viterbitContrasena', snapshot.contrasena);
  put('viterbitBuro', snapshot.buro);
  put('viterbitPsicometriaIntegridad', snapshot.psicometriaIntegridad);
  put('viterbitSalary', snapshot.salary);
  put('viterbitStartDate', snapshot.startDate);
  put('viterbitStartDateIso', snapshot.startDateIso);
  put('position', snapshot.position);
  put('viterbitHiringManager', snapshot.hiringManager);
  put('viterbitCompany', snapshot.company);
  put('plaza', snapshot.plaza);
  put('plazaCity', snapshot.plazaCity);

  if (snapshot.departmentProfile) {
    put('viterbitDepartmentProfile', snapshot.departmentProfile);
    put('profile', snapshot.departmentProfile);
  }

  return updates;
}

export interface SyncResult {
  /** Field names written, empty when Viterbit matches what we already store. */
  changed: string[];
  updates: Record<string, unknown>;
  snapshot: ViterbitSnapshot;
}

/**
 * Re-reads Viterbit for one candidate and writes back what changed.
 *
 * Nothing is written when nothing differs — `updatedAt` stays where it was, so
 * the dashboard keeps showing when the record really last moved.
 */
export async function syncCandidateFromViterbit(
  ref: FirebaseFirestore.DocumentReference,
  stored: Record<string, unknown>,
  apiKey: string,
): Promise<SyncResult> {
  const snapshot = await fetchViterbitSnapshot(
    {
      viterbitCandidateId: asText(stored.viterbitCandidateId),
      viterbitCandidatureId: asText(stored.viterbitCandidatureId),
      viterbitJobId: asText(stored.viterbitJobId),
    },
    apiKey,
  );

  const updates = buildViterbitUpdates(stored, snapshot);
  const changed = Object.keys(updates);

  if (changed.length > 0) {
    await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
    console.info(`[viterbitSync] ${ref.id} updated: ${changed.join(', ')}`);
  }

  return { changed, updates, snapshot };
}
