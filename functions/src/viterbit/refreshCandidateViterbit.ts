import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

/**
 * Re-fetch job data from Viterbit and update the candidate's salary, startDate,
 * hiringManager, company, departmentProfile, and position fields.
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

    const apiKey = VITERBIT_API_KEY.value();
    const resp = await fetch(
      `${VITERBIT_API_BASE}/jobs/${jobId}?includes[]=custom_fields&includes[]=department_profile&includes[]=stages`,
      { headers: { 'X-API-Key': apiKey } },
    );
    if (!resp.ok) {
      throw new HttpsError('unavailable', `Viterbit API devolvió HTTP ${resp.status}`);
    }
    const json = await resp.json() as { data?: Record<string, unknown> };
    const data = json.data ?? {};

    const getCustom = (key: string): string => {
      const fields = (data.custom_fields as Array<{ key: string; value: unknown }>) ?? [];
      const found = fields.find((f) => f.key === key);
      if (!found) return '';
      if (typeof found.value === 'string') return found.value;
      if (Array.isArray(found.value)) return (found.value as string[]).join(', ');
      return String(found.value ?? '');
    };

    const rawSalary = getCustom('hired_salary_job') || getCustom('salary') || '';
    const salary = rawSalary ? `$${rawSalary.replace(/^\$\s*/, '')}` : '';

    // Resolve department profile
    let departmentProfile = '';
    const includes = (data.includes as Record<string, unknown> | undefined) ?? {};
    const deptProfileRaw = includes['department_profile'] as Record<string, unknown> | null | undefined;
    if (deptProfileRaw && deptProfileRaw.name) {
      departmentProfile = deptProfileRaw.name as string;
    } else {
      const deptId = (data.department_id as string) || '';
      const profileId = (data.department_profile_id as string) || '';
      if (deptId && profileId) {
        try {
          const profResp = await fetch(`${VITERBIT_API_BASE}/departments/${deptId}/profiles`, {
            headers: { 'X-API-Key': apiKey },
          });
          if (profResp.ok) {
            const profiles = (((await profResp.json()).data) as Array<Record<string, unknown>>) ?? [];
            const matched = profiles.find((p) => String(p.id) === String(profileId));
            if (matched) departmentProfile = (matched.name as string) || '';
          }
        } catch {
          // ignore
        }
      }
    }

    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    const title = (data.title as string) || '';
    if (title) updates.position = title;
    if (salary) updates.viterbitSalary = salary;

    const startDate = getCustom('hired_start_date_job') || getCustom('start_date') || '';
    if (startDate) updates.viterbitStartDate = startDate;

    const hiringManager = getCustom('custom_job_hiring_manager') || getCustom('hiring_manager') || '';
    if (hiringManager) updates.viterbitHiringManager = hiringManager;

    const company = getCustom('custom_job_empresa') || getCustom('company') || '';
    if (company) updates.viterbitCompany = company;

    if (departmentProfile) {
      updates.viterbitDepartmentProfile = departmentProfile;
      updates.profile = departmentProfile;
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
