import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

function isValidViterbitId(id: unknown): id is string {
  if (!id || typeof id !== 'string') return false;
  const normalized = id.trim().toLowerCase();
  return normalized !== '' && normalized !== 'null' && normalized !== 'undefined' && normalized !== '0' && normalized !== 'false';
}

interface ExtractedJobInfo {
  title: string;
  salary: string;
  startDate: string;
  hiringManager: string;
  company: string;
  departmentProfile: string;
  departmentId: string;
  departmentProfileId: string;
}

function extractJobFields(data: Record<string, unknown>): ExtractedJobInfo {
  const custom = (data.custom_field_values as Record<string, unknown>)
    ?? (data.custom_fields as Record<string, unknown>)
    ?? {};
  const getCustom = (key: string): string => {
    const val = custom[key];
    if (val && typeof val === 'object' && 'value' in val) {
      return String((val as Record<string, unknown>).value ?? '');
    }
    return (val as string) ?? (data[key] as string) ?? '';
  };

  const salaryMin = data.salary_min as { amount?: number; currency?: string } | undefined;
  const salaryMax = data.salary_max as { amount?: number; currency?: string } | undefined;
  let salary = '';
  if (salaryMin?.amount && salaryMax?.amount) {
    const currency = salaryMin.currency ?? 'MXN';
    salary = salaryMin.amount === salaryMax.amount
      ? `$${salaryMin.amount.toLocaleString('es-MX')} ${currency}`
      : `$${salaryMin.amount.toLocaleString('es-MX')} - $${salaryMax.amount.toLocaleString('es-MX')} ${currency}`;
  } else if (salaryMin?.amount) {
    salary = `$${salaryMin.amount.toLocaleString('es-MX')} ${salaryMin.currency ?? 'MXN'}`;
  } else if (salaryMax?.amount) {
    salary = `$${salaryMax.amount.toLocaleString('es-MX')} ${salaryMax.currency ?? 'MXN'}`;
  }

  const deptProfileRaw = data.department_profile;
  const deptProfileObj = (deptProfileRaw && typeof deptProfileRaw === 'object')
    ? deptProfileRaw as Record<string, unknown>
    : undefined;
  const departmentProfile =
    (deptProfileObj?.name as string) ||
    (deptProfileObj?.title as string) ||
    getCustom('job_department_profile') ||
    getCustom('department_profile') ||
    '';

  return {
    title: (data.title as string) || (data.name as string) || '',
    salary,
    startDate: getCustom('hired_start_date_job') || getCustom('start_date') || '',
    hiringManager: getCustom('custom_job_hiring_manager') || getCustom('hiring_manager') || '',
    company: getCustom('custom_job_empresa') || getCustom('company') || (data.external_id as string) || '',
    departmentProfile,
    departmentId: (data.department_id as string) || '',
    departmentProfileId: (data.department_profile_id as string) || '',
  };
}

async function resolveProfileName(
  deptId: string,
  profileId: string,
  apiKey: string,
): Promise<string> {
  if (!deptId || !profileId) return '';
  try {
    const profResp = await fetch(
      `${VITERBIT_API_BASE}/departments/${deptId}/profiles`,
      { headers: { 'X-API-Key': apiKey } },
    );
    if (!profResp.ok) return '';
    const profJson = (await profResp.json()) as Record<string, unknown>;
    const profiles =
      (profJson.data as Array<Record<string, unknown>>) ??
      (Array.isArray(profJson) ? (profJson as Array<Record<string, unknown>>) : []);
    const matched = profiles.find((p) => String(p.id) === String(profileId));
    return (matched?.name as string) || (matched?.title as string) || '';
  } catch {
    return '';
  }
}

/**
 * Re-fetch job data from Viterbit and update the candidate's salary, startDate,
 * hiringManager, company, departmentProfile, and position fields.
 *
 * Falls back to the candidature endpoint when the job endpoint returns 400/404.
 */
export const refreshCandidateViterbit = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const { candidateId } = request.data as { candidateId: string };
    if (!candidateId) throw new HttpsError('invalid-argument', 'candidateId requerido');

    const snap = await db.collection('candidates').doc(candidateId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Candidato no encontrado');

    const candidate = snap.data()!;
    const jobId = candidate.viterbitJobId as string | undefined;
    const candidatureId = candidate.viterbitCandidatureId as string | undefined;

    if (!isValidViterbitId(jobId) && !isValidViterbitId(candidatureId)) {
      throw new HttpsError('failed-precondition', 'El candidato no tiene viterbitJobId ni viterbitCandidatureId.');
    }

    const apiKey = VITERBIT_API_KEY.value();
    let info: ExtractedJobInfo | null = null;

    // Primary: try the job endpoint
    if (isValidViterbitId(jobId)) {
      const resp = await fetch(
        `${VITERBIT_API_BASE}/jobs/${jobId}?includes[]=stages&includes[]=custom_field_values&includes[]=department_profile`,
        { headers: { 'X-API-Key': apiKey } },
      );
      if (resp.ok) {
        const json = (await resp.json()) as Record<string, unknown>;
        const data = (json.data as Record<string, unknown>) ?? json;
        console.log('[refreshCandidateViterbit] job endpoint OK, keys:', Object.keys(data).join(', '));
        info = extractJobFields(data);
      } else {
        console.warn(`[refreshCandidateViterbit] job endpoint HTTP ${resp.status} for jobId=${jobId} — trying candidature fallback`);
      }
    }

    // Fallback: try the candidature endpoint and extract the embedded job object
    if (!info && isValidViterbitId(candidatureId)) {
      const resp = await fetch(
        `${VITERBIT_API_BASE}/candidatures/${candidatureId}?includes[]=custom_field_values&includes[]=job`,
        { headers: { 'X-API-Key': apiKey } },
      );
      if (resp.ok) {
        const json = (await resp.json()) as Record<string, unknown>;
        const data = (json.data as Record<string, unknown>) ?? json;
        console.log('[refreshCandidateViterbit] candidature endpoint OK, keys:', Object.keys(data).join(', '));
        // Prefer embedded job object; fall back to candidature-level custom fields
        const jobData = (data.job as Record<string, unknown>) ?? data;
        info = extractJobFields(jobData);
        // If job data was not embedded, at least try candidature custom fields for startDate/etc.
        if (!info.startDate && !info.hiringManager) {
          const candidatureInfo = extractJobFields(data);
          info.startDate = info.startDate || candidatureInfo.startDate;
          info.hiringManager = info.hiringManager || candidatureInfo.hiringManager;
          info.company = info.company || candidatureInfo.company;
        }
      } else {
        console.warn(`[refreshCandidateViterbit] candidature endpoint HTTP ${resp.status} for candidatureId=${candidatureId}`);
      }
    }

    if (!info) {
      throw new HttpsError('unavailable', 'No se pudo obtener información de Viterbit. Verifica que el puesto siga activo.');
    }

    // Resolve department profile name via dept/profile endpoint if not yet found
    if (!info.departmentProfile && info.departmentId && info.departmentProfileId) {
      info.departmentProfile = await resolveProfileName(info.departmentId, info.departmentProfileId, apiKey);
    }

    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (info.title) updates.position = info.title;
    if (info.salary) updates.viterbitSalary = info.salary;
    if (info.startDate) updates.viterbitStartDate = info.startDate;
    if (info.hiringManager) updates.viterbitHiringManager = info.hiringManager;
    if (info.company) updates.viterbitCompany = info.company;
    if (info.departmentProfile) {
      updates.viterbitDepartmentProfile = info.departmentProfile;
      updates.profile = info.departmentProfile;
    }

    await snap.ref.update(updates);

    return {
      success: true,
      salary: (updates.viterbitSalary as string) || null,
      startDate: (updates.viterbitStartDate as string) || null,
      position: (updates.position as string) || null,
    };
  },
);
