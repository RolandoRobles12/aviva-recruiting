import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { FormQuestion } from '../types';

const SETTINGS_DOC = doc(db, 'settings', 'form_questions');

/** Default built-in questions. Seeded to Firestore on first load. */
export const DEFAULT_BUILTIN_QUESTIONS: FormQuestion[] = [
  { id: 'builtin_estado_civil',           builtinKey: 'estado_civil',           label: 'Estado civil',                                              type: 'radio',    options: ['Soltero/a', 'Casado/a', 'Unión Libre'], required: true,  enabled: true, order: 0 },
  { id: 'builtin_tiene_hijos',            builtinKey: 'tiene_hijos',            label: '¿Tienes hijos?',                                            type: 'yes_no',   required: false, enabled: true, order: 1 },
  { id: 'builtin_tiene_infonavit',        builtinKey: 'tiene_infonavit',        label: '¿Cuentas con crédito INFONAVIT?',                           type: 'yes_no',   required: false, enabled: true, order: 2 },
  { id: 'builtin_tiene_fonacot',          builtinKey: 'tiene_fonacot',          label: '¿Cuentas con un crédito FONACOT?',                          type: 'yes_no',   required: false, enabled: true, order: 3 },
  { id: 'builtin_talla_playera',          builtinKey: 'talla_playera',          label: 'Talla de playera',                                          type: 'radio',    options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], required: false, enabled: true, order: 4 },
  { id: 'builtin_sobre_ti',               builtinKey: 'sobre_ti',               label: 'Cuéntanos un poco sobre ti',                                type: 'textarea', required: false, enabled: true, order: 5 },
  { id: 'builtin_entidad_financiera',     builtinKey: 'entidad_financiera',     label: '¿Anteriormente has laborado en otra entidad financiera?',    type: 'yes_no',   required: false, enabled: true, order: 6 },
  { id: 'builtin_beneficiario',           builtinKey: 'beneficiario',           label: 'Beneficiario (mayor de edad y familiar directo)',            type: 'text',     required: false, enabled: true, order: 7 },
  { id: 'builtin_contacto1',              builtinKey: 'contacto1',              label: 'Primer contacto de emergencia',                             type: 'text',     required: false, enabled: true, order: 8 },
  { id: 'builtin_contacto2',              builtinKey: 'contacto2',              label: 'Segundo contacto de emergencia',                            type: 'text',     required: false, enabled: true, order: 9 },
];

export async function getFormQuestions(): Promise<FormQuestion[]> {
  const snap = await getDoc(SETTINGS_DOC);
  if (!snap.exists() || !(snap.data().questions as FormQuestion[])?.length) {
    // Seed with defaults on first load
    await setDoc(SETTINGS_DOC, { questions: DEFAULT_BUILTIN_QUESTIONS });
    return DEFAULT_BUILTIN_QUESTIONS;
  }
  return (snap.data().questions as FormQuestion[]) ?? [];
}

export async function saveFormQuestions(questions: FormQuestion[]): Promise<void> {
  await setDoc(SETTINGS_DOC, { questions });
}
