# Drive y Google Sheets

Al firmar el contrato (o con los botones del panel del candidato), el sistema:

1. Crea una carpeta para el candidato **en cada carpeta de Drive configurada** y
   copia ahí su expediente (documentos válidos y PDFs firmados).
2. Agrega su fila **a cada hoja de cálculo configurada**.

## Dónde se configura

*Configuración → Drive y Sheets* (documento `settings/google_workspace`). Nada de
esto está en el código: el primer uso siembra el documento con los destinos que
antes estaban fijos (carpeta Expedientes, hoja MASTER y hoja secundaria), así que
el primer deploy sigue escribiendo exactamente donde antes.

- **Carpetas de Drive**: cualquier número. Una es la **principal**: la que se
  enlaza en la app y se escribe en la columna "Expediente".
- **Hojas**: cualquier número. Cada una apunta a una pestaña, de preferencia por
  **gid** (el `#gid=` de la URL): así se encuentra aunque le cambien el nombre.
- Todo se pega como **enlace**; el servidor extrae los IDs.
- Cada carpeta y hoja debe estar **compartida como Editor** con la cuenta de
  servicio que muestra la pestaña.
- **Probar conexión** revisa lo que está en pantalla (sin guardar y sin escribir
  nada): acceso a cada destino, nombre real de la pestaña y cómo quedarían los
  datos en cada hoja.

## Cómo se acomodan los datos en una hoja

- **Por encabezado (recomendado)**: se lee la fila 1 y cada dato va bajo la
  columna con su título (sin distinguir mayúsculas, acentos ni signos). Insertar,
  mover o renombrar otras columnas no recorre nada, y las columnas que el sistema
  no llena se dejan intactas. Si un título no se reconoce, en "Probar conexión"
  se elige a mano qué columna corresponde a cada dato. Si faltan **Nombre** o
  **Email personal**, esa hoja no se escribe y se reporta el error.
- **Orden fijo de 61 columnas**: el comportamiento anterior. Las dos hojas
  existentes arrancan así; "Probar conexión" avisa qué columnas no parecen
  coincidir. Una vez revisadas, conviene pasarlas a "por encabezado".

Los datos y sus títulos aceptados están en
`functions/src/integrations/sheetsRow.ts` (`FIELD_DEFS`).

## Otros comportamientos

- **Sin duplicados**: si la hoja ya tiene la referencia del candidato, no se
  agrega otra fila (antes, reintentar o re-firmar duplicaba).
- **La contraseña del correo corporativo ya no se escribe** en ninguna hoja: le
  llega al colaborador por correo desde otra herramienta.
- Cada destino es independiente: si uno falla, los demás se escriben igual. El
  resultado queda en el candidato (`driveSyncByDestination`, `sheetsSyncStatus`)
  y el panel del candidato lo muestra.
- Los botones manuales exigen un rol que pueda ver candidatos; antes bastaba con
  tener sesión iniciada.
- Los cambios de configuración aplican al siguiente candidato (caché de hasta 1
  minuto).
