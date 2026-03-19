/**
 * One-off script: insert a test candidate into Firestore.
 * Run with: npx ts-node --project tsconfig.json scripts/seedTestCandidate.ts
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'aviva-recruiting' });
}

const db = admin.firestore();

const DOCUMENT_TYPES = ['ine', 'curp', 'rfc', 'comprobante_domicilio', 'comprobante_estudios'];

async function main() {
  const documents = Object.fromEntries(
    DOCUMENT_TYPES.map((type) => [type, { id: type, type, status: 'pending' }])
  );

  const ref = db.collection('candidates').doc();
  await ref.set({
    firstName: 'Rolando',
    lastName: 'Test',
    email: 'ventas@avivacredito.com',
    phone: null,
    position: 'Prueba',
    status: 'invited',
    formToken: null,
    formExpiresAt: null,
    offerToken: null,
    offerExpiresAt: null,
    contractToken: null,
    contractExpiresAt: null,
    documents,
    formAnswers: null,
    completionPercentage: 0,
    reminderCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'seed_script',
    viterbitCandidatureId: null,
    viterbitJobId: null,
  });

  console.log(`✓ Candidato de prueba creado con ID: ${ref.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
