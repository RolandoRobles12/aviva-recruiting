/**
 * One-off script: insert the real offer letter template into Firestore.
 * Run with:
 *   cd functions
 *   FIRESTORE_EMULATOR_HOST="" npx ts-node --project tsconfig.scripts.json scripts/seedOfferTemplate.ts
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'aviva-recruiting' });
}

const db = admin.firestore();

const BODY_HTML = `<p>Bienvenido/a <strong>{{name}}</strong>,</p>

<p>Después de escuchar tu historia, tu trayectoria y lo que te mueve, estamos convencidos de que  tu talento puede ayudarnos a hacer realidad nuestra historia en más comunidades y transformar muchas vidas. Hoy queremos dar un paso más contigo y compartirte nuestra carta oferta, y te unas a nuestra misión de ofrecer productos financieros de calidad mediante una experiencia confiable y digna, acercando la tecnología de manera accesible.</p>

<p>Ahora déjanos contarte cómo tu posición nos ayudará en esta misión;</p>

<h2>I. Posición y organización</h2>
<p><strong>Puesto:</strong> {{departmentProfile}}<br>
<strong>Empresa:</strong> {{company}}<br>
<strong>Líder:</strong> {{hiringManager}}<br>
<strong>Fecha de inicio:</strong> {{startDate}}<br>
<strong>Horario:</strong> Lunes a Domingo 10 a 19 con Descanso Jueves*</p>
<p><em>*Pueden cambiar de acuerdo a necesidades del negocio</em></p>

<h2>II. Responsabilidades clave</h2>
<ul>
<li>Atender a clientes en piso de venta, identificar sus necesidades y cerrar ventas de forma inmediata.</li>
<li>Tener pleno conocimiento de las características de los productos que se venden en tienda física y digital.</li>
<li>Construir relaciones positivas y efectivas con gerentes, subgerentes y asociados de tienda.</li>
<li>Ejecutar estrategias de venta, activaciones y promociones dentro del punto de venta.</li>
<li>Proponer e implementar acciones comerciales en colaboración con el equipo de tienda, principalmente con el asociado de venta en línea.</li>
<li>En caso necesario, realizar actividades de cambaceo en zonas cercanas para impulsar el tráfico y las ventas.</li>
<li>Cuidar la imagen y representación de AVIVA en el punto de venta.</li>
</ul>

<h2>III. Compensación y beneficios iniciales</h2>
<p>El plan de compensación de Aviva será dinámico, y evolucionará conforme logremos objetivos por ello te ofrecemos lo siguiente:</p>
<p><strong>Sueldo Bruto:</strong> {{salary}} (antes de impuestos)<br>
<strong>Bono Garantía Bruto:</strong> 1750 MXN (pagado únicamente en las primeras 2 quincenas)*<br>
<strong>Bono Mensual Bruto:</strong> 0 a 14373 MXN (acuerdo al cumplimiento de metas de venta, pagado a quincena vencida)*<br>
<strong>Premios bimestral:</strong> bono variable a los 3 primeros lugares de cada grupo de tienda*<br>
<strong>Seguridad social:</strong> IMSS<br>
<strong>Prima vacacional:</strong> 25%<br>
<strong>Prima dominical:</strong> 25%<br>
<strong>Aguinaldo:</strong> 15 días (proporcional a los días laborados en el año)<br>
<strong>Días Aviva:</strong> 7 días personales al año para reavivar tu energía, después de los 4 meses en Aviva<br>
<strong>Día de cumpleaños:</strong> 1 día al año para celebrar tu vida<br>
<strong>Bono de Maternidad o paternidad:</strong> 15 días de tu salario bruto mensual al nacer tu hijo/a</p>

<p><em>*La compensación variable y beneficios superiores  están sujetos a ajustes conforme a la evolución y necesidades de la operación, garantizando siempre esquemas claros, medibles y alineados al desempeño.</em></p>

<p><strong>¡Nos encanta que estés a unos pasos de ser parte de Aviva!</strong></p>`;

async function main() {
  // Check if a template already exists to avoid duplicates
  const existing = await db.collection('offer_templates').get();
  if (!existing.empty) {
    console.log(`Ya existen ${existing.size} template(s) en Firestore:`);
    existing.docs.forEach((d) => console.log(`  - ${d.id}: ${d.data().name}`));
    console.log('Borrando templates anteriores y creando el nuevo...');
    for (const d of existing.docs) {
      await d.ref.delete();
      console.log(`  ✓ Eliminado: ${d.id}`);
    }
  }

  const ref = db.collection('offer_templates').doc();
  await ref.set({
    name: 'Promotor de crédito',
    positionKeywords: ['promotor', 'crédito', 'credito', 'ventas', 'promotor de crédito'],
    bodyHtml: BODY_HTML,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`✓ Template creado con ID: ${ref.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
