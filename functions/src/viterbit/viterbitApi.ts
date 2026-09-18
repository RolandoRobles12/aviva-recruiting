/**
 * One place to read Viterbit.
 *
 * The webhook, the per-candidate refresh and the bulk sync all need the same job
 * / candidature / candidate fields. Each used to fetch and parse them on its own,
 * which is how the copies drifted: the webhook captured a snapshot at creation
 * time and nothing ever read Viterbit again for those fields, so an edit made
 * there after the candidate existed never reached Firestore.
 */

import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { readCustomField, readScreeningFields, type ViterbitScreeningFields } from '../utils/viterbitFields';
import { toIsoDateString } from '../utils/startDate';
import { extractJobPlaza } from './jobPlaza';
import { fetchCandidateRaw } from './candidateScreening';

export const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

/** Custom-field aliases, one list per concept (Viterbit names them per object). */
const HIRING_MANAGER_KEYS = ['custom_job_hiring_manager', 'hiring_manager'];
const COMPANY_KEYS = ['empresa', 'custom_job_empresa', 'company'];
const DEPARTMENT_PROFILE_KEYS = ['job_department_profile', 'department_profile'];

export interface ViterbitStage {
  id: string;
  name: string;
}

export interface ViterbitJobInfo {
  title: string;
  stages: ViterbitStage[];
  hiringManagerId: string;
  company: string;
  departmentProfile: string;
  /** Store name — the job's external_id, verbatim ("MEX0147 Oxkutzcab BA"). */
  plaza: string;
  /** City of the store, from the job's address. */
  city: string;
}

/*
 * The vacancy's salary range and start date are deliberately NOT read here.
 * Salario and fecha de inicio are what the carta oferta and the contrato print,
 * and the only place that carries the agreed ones is the candidature's
 * hired_info. A vacancy range ("$12,000 - $15,000 MXN") is not an offer, so
 * falling back to it would both print a wrong figure and defeat the
 * `offer_held` gate that waits for the real one.
 */

export interface ViterbitCandidatureInfo {
  stageId: string;
  stageName: string;
  jobId: string;
  salary: string;
  /** Spanish display text, e.g. "15 de julio de 2026". */
  startDate: string;
  /** Canonical "YYYY-MM-DD". */
  startDateIso: string;
}

export interface ViterbitCandidateInfo {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  reference: string;
  contrasena: string;
  screening: ViterbitScreeningFields;
}

const EMPTY_JOB: ViterbitJobInfo = {
  title: '', stages: [], hiringManagerId: '', company: '', departmentProfile: '',
  plaza: '', city: '',
};

function money(amount: number, currency: string): string {
  return `$${amount.toLocaleString('es-MX')} ${currency}`;
}

/** "15 de julio de 2026" from whatever date string Viterbit returns. */
function toDisplayDate(raw: string): string {
  if (!raw) return '';
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return '';
  return format(parsed, "d 'de' MMMM 'de' yyyy", { locale: es });
}

/**
 * Reads a job/candidature custom field. Viterbit returns them either as a
 * record or as an array depending on the endpoint — readCustomField normalises
 * both — and a few of them also appear as plain keys on the payload root.
 */
function customReader(data: Record<string, unknown>) {
  const raw = data.custom_field_values ?? data.custom_fields;
  return (keys: string[]): string => {
    const value = readCustomField(raw, keys);
    if (value) return value;
    for (const key of keys) {
      const rootValue = data[key];
      if (typeof rootValue === 'string' && rootValue.trim()) return rootValue;
    }
    return '';
  };
}

/**
 * Resolves the department profile name. `includes[]=department_profile` often
 * comes back null, so fall back to department_id + department_profile_id and
 * look the name up in the department's profile list.
 */
async function resolveDepartmentProfile(
  data: Record<string, unknown>,
  getCustom: (keys: string[]) => string,
  apiKey: string,
): Promise<string> {
  const raw = data.department_profile;
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;
  const direct =
    (obj?.name as string) ||
    (obj?.title as string) ||
    getCustom(DEPARTMENT_PROFILE_KEYS);
  if (direct) return direct;

  const deptId = (data.department_id as string) || '';
  const profileId = (data.department_profile_id as string) || '';
  if (!deptId || !profileId) return '';

  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/departments/${deptId}/profiles`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) {
      console.error('[viterbit] department profiles HTTP', resp.status);
      return '';
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const profiles =
      (json.data as Array<Record<string, unknown>>) ??
      (Array.isArray(json) ? (json as Array<Record<string, unknown>>) : []);
    const matched = profiles.find((p) => String(p.id) === String(profileId));
    return (matched?.name as string) || (matched?.title as string) || '';
  } catch (err) {
    console.error('[viterbit] department profiles error:', err);
    return '';
  }
}

/** Job info; returns empty fields (never throws) so a failed read degrades. */
export async function fetchJobInfo(jobId: string, apiKey: string): Promise<ViterbitJobInfo> {
  if (!jobId) return EMPTY_JOB;
  try {
    const resp = await fetch(
      `${VITERBIT_API_BASE}/jobs/${jobId}?includes[]=stages&includes[]=custom_field_values`,
      { headers: { 'X-API-Key': apiKey } },
    );
    if (!resp.ok) {
      console.error(`[viterbit] fetchJobInfo ${jobId} → HTTP ${resp.status}`);
      return EMPTY_JOB;
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    const getCustom = customReader(data);

    const { plaza, city } = extractJobPlaza(data);
    const departmentProfile = await resolveDepartmentProfile(data, getCustom, apiKey);

    return {
      title: (data.title as string) || (data.name as string) || '',
      stages: (data.stages as ViterbitStage[]) ?? [],
      hiringManagerId: getCustom(HIRING_MANAGER_KEYS),
      // No default here: callers decide what an unnamed company falls back to,
      // and nothing overwrites a stored value with a guess.
      company: getCustom(COMPANY_KEYS),
      departmentProfile,
      plaza,
      city,
    };
  } catch (err) {
    console.error('[viterbit] fetchJobInfo error:', err);
    return EMPTY_JOB;
  }
}

/** Candidature info, including the hired_info the offer letter is built from. */
export async function fetchCandidatureInfo(
  candidatureId: string,
  apiKey: string,
): Promise<ViterbitCandidatureInfo | null> {
  if (!candidatureId) return null;
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) {
      console.error(`[viterbit] fetchCandidatureInfo ${candidatureId} → HTTP ${resp.status}`);
      return null;
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;

    const currentStage = (data.current_stage as Record<string, unknown>) ?? {};
    const hiredInfo = (data.hired_info as Record<string, unknown>) ?? {};
    const salaryAmount = hiredInfo.salary as number | undefined;
    const rawStartDate = (hiredInfo.start_at as string) ?? '';

    return {
      stageId: (currentStage.id as string) ?? '',
      stageName: (currentStage.name as string) ?? '',
      jobId: (data.job_id as string) ?? '',
      salary: salaryAmount ? money(salaryAmount, (hiredInfo.currency as string) ?? 'MXN') : '',
      startDate: toDisplayDate(rawStartDate),
      startDateIso: toIsoDateString(rawStartDate),
    };
  } catch (err) {
    console.error('[viterbit] fetchCandidatureInfo error:', err);
    return null;
  }
}

/**
 * Candidate info: name, contact data and the screening results that gate the
 * offer letter. Returns null when the candidate can't be read or carries no
 * email, which is the one field every downstream step needs.
 */
export async function fetchCandidateInfo(
  candidateViterbitId: string,
  apiKey: string,
): Promise<ViterbitCandidateInfo | null> {
  if (!candidateViterbitId) return null;

  const data = await fetchCandidateRaw(candidateViterbitId, apiKey);
  if (!data) {
    console.error(`[viterbit] fetchCandidateInfo ${candidateViterbitId} → no data`);
    return null;
  }

  const firstName = (data.first_name as string) || (data.nombre as string) || '';
  const lastName =
    (data.last_name as string) ||
    (data.surname as string) ||
    (data.apellido as string) ||
    (data.apellidos as string) ||
    '';
  const fullName =
    (data.full_name as string) ||
    (data.name as string) ||
    (data.fullname as string) ||
    `${firstName} ${lastName}`.trim();

  const email = (data.email as string) || (data.correo as string) || '';
  if (!email) {
    console.error(`[viterbit] fetchCandidateInfo ${candidateViterbitId} → candidate has no email`);
    return null;
  }

  const contrasena =
    readCustomField(data.custom_field_values ?? data.custom_fields, ['contrasena_correo_corporativo']) ||
    (data.contrasena_correo_corporativo as string) ||
    '';

  return {
    fullName,
    firstName,
    lastName,
    email,
    phone: (data.phone as string) || (data.telephone as string) || (data.mobile as string) || '',
    reference: (data.reference as string) || '',
    contrasena,
    screening: readScreeningFields(data),
  };
}

/** Display name of a Viterbit user (used for the hiring manager). */
export async function fetchUserFullName(userId: string, apiKey: string): Promise<string> {
  if (!userId) return '';
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/users/${userId}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) return '';
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    return (data.full_name as string) ?? '';
  } catch (err) {
    console.error('[viterbit] fetchUserFullName error:', err);
    return '';
  }
}

/** Moves a candidature to a stage. Throws on a non-2xx response. */
export async function moveToStage(candidatureId: string, stageId: string, apiKey: string): Promise<void> {
  const resp = await fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}/stage`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage_id: stageId }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`moveToStage ${stageId} → HTTP ${resp.status}: ${text}`);
  }
}
