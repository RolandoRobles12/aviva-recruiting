/**
 * One-off script: insert a contract template into Firestore.
 * Run with:
 *   cd functions
 *   FIRESTORE_EMULATOR_HOST="" npx ts-node --project tsconfig.scripts.json scripts/seedContractTemplate.ts
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'aviva-recruiting' });
}

const db = admin.firestore();

const BODY_HTML = `<p>Contrato individual de trabajo que celebran por una parte <strong>Aviva Financial S.A. de C.V. SOFOM ENR</strong>, representada por Salvador Hernández Díaz de León, en lo sucesivo "La Empresa", y por otra parte <strong>{{firstName}} {{lastName}}</strong>, en lo sucesivo "El Trabajador".</p>

<h2>Declaraciones</h2>
<p>La Empresa declara ser una persona moral constituida conforme a las leyes mexicanas, con domicilio en Calle Varsovia 36, Colonia Juárez, Delegación Cuauhtémoc, CP 06600, CDMX.</p>
<p>El Trabajador declara llamarse <strong>{{firstName}} {{lastName}}</strong> y tener capacidad legal para celebrar el presente contrato.</p>

<h2>Cláusulas</h2>
<p><strong>PRIMERA.</strong> El Trabajador se obliga a prestar sus servicios personales subordinados a La Empresa en el puesto de <strong>{{position}}</strong>, iniciando el <strong>{{startDate}}</strong>.</p>
<p><strong>SEGUNDA.</strong> El Trabajador percibirá un salario bruto mensual de <strong>{{salary}}</strong>, pagadero de forma quincenal.</p>
<p><strong>TERCERA.</strong> El Trabajador se obliga a mantener absoluta confidencialidad sobre la información de La Empresa a la que tenga acceso con motivo de su cargo.</p>

<h2>Firmas</h2>
<p>Leído que fue el presente contrato, ambas partes lo firman en señal de conformidad en la Ciudad de México, el <strong>{{date}}</strong>.</p>

<table style="width:100%; border-collapse:collapse; margin-top:16px;">
<tr>
<td style="width:50%; text-align:center; padding:8px; border:1px solid #ccc; vertical-align:top;">
<p><strong>La Empresa</strong></p>
<p style="margin-top:40px; border-top:1px solid #000; padding-top:6px;"><strong>SALVADOR HERNÁNDEZ DÍAZ DE LEÓN</strong><br>Representante Legal</p>
</td>
<td style="width:50%; text-align:center; padding:8px; border:1px solid #ccc; vertical-align:top;">
<p><strong>El Trabajador</strong></p>
<p style="margin-top:40px; border-top:1px solid #000; padding-top:6px;"><strong>{{firstName}} {{lastName}}</strong><br>Por su propio derecho</p>
</td>
</tr>
</table>`;

async function main() {
  // Check if a template already exists to avoid duplicates
  const existing = await db.collection('contract_templates').get();
  if (!existing.empty) {
    console.log(`Ya existen ${existing.size} template(s) de contrato en Firestore:`);
    existing.docs.forEach((d) => console.log(`  - ${d.id}: ${d.data().name}`));
    console.log('Borrando templates anteriores y creando el nuevo...');
    for (const d of existing.docs) {
      await d.ref.delete();
      console.log(`  ✓ Eliminado: ${d.id}`);
    }
  }

  const ref = db.collection('contract_templates').doc();
  await ref.set({
    name: 'Contrato Prueba — Promotor de Crédito',
    positionKeywords: ['promotor', 'crédito', 'credito', 'asesor', 'ventas'],
    templateType: 'html',
    bodyHtml: BODY_HTML,
    initialsOnEveryPage: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`✓ Contract template creado con ID: ${ref.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
