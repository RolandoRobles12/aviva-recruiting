import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '../utils/admin';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

async function fetchViterbitUser(userId: string, apiKey: string): Promise<string> {
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/users/${userId}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) return '';
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    return (data.full_name as string) ?? '';
  } catch {
    return '';
  }
}

// Fetches salary and start date from the candidature's hired_info.
async function fetchCandidatureHiredInfo(
  candidatureId: string,
  apiKey: string,
): Promise<{ salary: string; startDate: string }> {
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) return { salary: '', startDate: '' };
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    const hiredInfo = (data.hired_info as Record<string, unknown>) ?? {};
    const salaryAmount = hiredInfo.salary as number | undefined;
    const currency = (hiredInfo.currency as string) ?? 'MXN';
    const salary = salaryAmount ? `$${salaryAmount.toLocaleString('es-MX')} ${currency}` : '';
    const rawStartDate = (hiredInfo.start_at as string) ?? '';
    const startDate = rawStartDate
      ? format(new Date(rawStartDate), "d 'de' MMMM 'de' yyyy", { locale: es })
      : '';
    return { salary, startDate };
  } catch {
    return { salary: '', startDate: '' };
  }
}

/**
 * Re-fetch job and candidature data from Viterbit and update the candidate's
 * salary, startDate, hiringManager, company, departmentProfile, and position fields.
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
    if (!jobId) throw new HttpsError('failed-precondition', 'El candidato no tiene viterbitJobId.');

    const candidatureId = candidate.viterbitCandidatureId as string | undefined;
    const apiKey = VITERBIT_API_KEY.value();

    // Fetch job and candidature in parallel
    const [jobResp, candidatureInfo] = await Promise.all([
      fetch(
        `${VITERBIT_API_BASE}/jobs/${jobId}?includes[]=stages&includes[]=custom_field_values`,
        { headers: { 'X-API-Key': apiKey } },
      ),
      candidatureId ? fetchCandidatureHiredInfo(candidatureId, apiKey) : Promise.resolve({ salary: '', startDate: '' }),
    ]);

    if (!jobResp.ok) {
      throw new HttpsError('unavailable', `Viterbit API devolvió HTTP ${jobResp.status}`);
    }

    const json = (await jobResp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;

    // custom_field_values is a key→{value:...} map
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

    // Salary: candidature hired_info takes priority over job salary range
    let salary = candidatureInfo.salary;
    if (!salary) {
      const salaryMin = data.salary_min as { amount?: number; currency?: string } | undefined;
      const salaryMax = data.salary_max as { amount?: number; currency?: string } | undefined;
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
    }

    // Start date: candidature hired_info takes priority over custom field
    const startDate = candidatureInfo.startDate || getCustom('hired_start_date_job') || getCustom('start_date') || '';

    // Department profile
    const deptProfileRaw = data.department_profile;
    const deptProfileObj = (deptProfileRaw && typeof deptProfileRaw === 'object')
      ? deptProfileRaw as Record<string, unknown>
      : undefined;
    let departmentProfile =
      (deptProfileObj?.name as string) ||
      (deptProfileObj?.title as string) ||
      getCustom('job_department_profile') ||
      getCustom('department_profile') ||
      '';

    if (!departmentProfile) {
      const deptId = (data.department_id as string) || '';
      const profileId = (data.department_profile_id as string) || '';
      if (deptId && profileId) {
        try {
          const profResp = await fetch(
            `${VITERBIT_API_BASE}/departments/${deptId}/profiles`,
            { headers: { 'X-API-Key': apiKey } },
          );
          if (profResp.ok) {
            const profJson = (await profResp.json()) as Record<string, unknown>;
            const profiles =
              (profJson.data as Array<Record<string, unknown>>) ??
              (Array.isArray(profJson) ? (profJson as Array<Record<string, unknown>>) : []);
            const matched = profiles.find((p) => String(p.id) === String(profileId));
            if (matched) departmentProfile = (matched.name as string) || (matched.title as string) || '';
          }
        } catch {
          // ignore
        }
      }
    }

    const title = (data.title as string) || (data.name as string) || '';
    const hiringManagerId = getCustom('custom_job_hiring_manager') || getCustom('hiring_manager') || '';
    const hiringManager = hiringManagerId ? await fetchViterbitUser(hiringManagerId, apiKey) : '';
    const company = getCustom('custom_job_empresa') || getCustom('company') || (data.external_id as string) || '';

    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (title) updates.position = title;
    if (salary) updates.viterbitSalary = salary;
    if (startDate) {
      updates.viterbitStartDate = format(new Date(startDate), "d 'de' MMMM 'de' yyyy", { locale: es });
      updates.viterbitStartDateISO = startDate;
    }
    if (hiringManager) updates.viterbitHiringManager = hiringManager;
    if (company) updates.viterbitCompany = company;
    if (departmentProfile) {
      updates.viterbitDepartmentProfile = departmentProfile;
      updates.profile = departmentProfile;
    }

    await snap.ref.update(updates);

    return {
      success: true,
      salary: (updates.viterbitSalary as string) || null,
      startDate: (updates.viterbitStartDateISO as string) || null,
      position: (updates.position as string) || null,
    };
  },
);
