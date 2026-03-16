# Plan: Mejora de la implementación OCR

## Problemas encontrados en el código actual

### 1. OCR se ejecuta DOS veces por cada documento
El frontend llama `triggerOcrValidation()` (callable) después de subir, Y el storage trigger `onDocumentUploaded` también corre OCR automáticamente. Esto duplica el procesamiento y puede causar condiciones de carrera.

### 2. Cloud Vision no soporta PDFs con `textDetection`
El método `vision.textDetection()` solo funciona con imágenes. Como los candidatos subirán PDFs también, necesitamos usar `asyncBatchAnnotateFiles` para PDFs.

### 3. El cálculo de completitud no considera validación
`updateCandidateCompletion` cuenta cualquier documento que NO sea 'pending' como progreso. Un documento 'invalid' no debería contar como completado si la validación es estricta.

### 4. En fallo de OCR se marca como 'review' en vez de 'invalid'
El usuario pidió validación estricta automática: si no pasa, se rechaza. Actualmente en error de OCR se marca como 'review' (revisión manual).

---

## Cambios propuestos

### Paso 1: Eliminar la Cloud Function callable `triggerOcrValidation`
- **Archivo:** `functions/src/ocr/triggerOcrValidation.ts` — eliminar el export `triggerOcrValidation`
- **Archivo:** `functions/src/index.ts` — quitar el export de `triggerOcrValidation`
- **Archivo:** `src/services/functions.ts` — quitar el callable `triggerOcrValidation`
- **Archivo:** `src/components/candidate/DocumentUploadCard.tsx` — quitar la llamada a `triggerOcrValidation()` del paso 3 del upload
- **Razón:** El storage trigger `onDocumentUploaded` ya hace el OCR automáticamente al subir el archivo. El frontend no necesita llamarlo — ya tiene un listener de Firestore en tiempo real que verá la actualización.

### Paso 2: Agregar soporte de PDF al storage trigger
- **Archivo:** `functions/src/ocr/triggerOcrValidation.ts`
- Crear función `extractTextFromFile(bucket, filePath)` que:
  - Si es imagen (jpg/png): usa `vision.textDetection()` como ahora
  - Si es PDF: usa `vision.asyncBatchAnnotateFiles()` para extraer texto de la(s) página(s)
- Aplicar en `onDocumentUploaded`

### Paso 3: Hacer la validación estricta
- **Archivo:** `functions/src/ocr/triggerOcrValidation.ts`
- En el catch del OCR: marcar como `'invalid'` en vez de `'review'` con mensaje "No se pudo procesar el documento. Por favor sube una imagen más clara o un PDF legible."
- Enviar email de error al candidato en todos los fallos

### Paso 4: Arreglar cálculo de completitud
- **Archivo:** `functions/src/utils/candidates.ts`
- `updateCandidateCompletion`: solo contar documentos con status `'valid'` para el porcentaje
- Solo pasar a `'under_review'` cuando TODOS los documentos son `'valid'`

### Paso 5: Mejorar reglas de validación
- **Archivo:** `functions/src/ocr/triggerOcrValidation.ts`
- Hacer las reglas más tolerantes al texto OCR ruidoso (el OCR de fotos de celular suele tener errores de caracteres)
- INE: agregar variantes como "ELECTORAL", "CREDENCIAL", "ELECTOR"
- CURP: relajar pattern para tolerar OCR confundiendo O/0, I/1
- RFC: igual, tolerar confusiones comunes de OCR
- Comprobante domicilio: agregar más proveedores (Naturgy, Telcel, AT&T, Movistar, etc.)
- Comprobante estudios: agregar más variantes (CENEVAL, CONALEP, preparatoria, etc.)

### Paso 6: Actualizar frontend
- **Archivo:** `src/components/candidate/DocumentUploadCard.tsx`
- Quitar import y llamada a `triggerOcrValidation`
- Después de subir, mostrar estado "Validando..." mientras el storage trigger procesa en background
- El listener de Firestore actualizará la UI automáticamente cuando el OCR termine

---

## Archivos afectados
1. `functions/src/ocr/triggerOcrValidation.ts` — reescribir lógica principal
2. `functions/src/utils/candidates.ts` — arreglar completitud
3. `functions/src/index.ts` — quitar export del callable
4. `src/services/functions.ts` — quitar callable
5. `src/components/candidate/DocumentUploadCard.tsx` — simplificar upload flow
