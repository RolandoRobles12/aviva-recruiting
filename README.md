# Aviva Recruiting

Sistema de reclutamiento y gestión de todo el proceso de ingreso para el equipo de Aviva: documentación, carta oferta, contrato, pruebas psicométricas, integración con el ATS (Viterbit) y seguimiento post-contratación.

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + Vite + TypeScript + Tailwind CSS |
| Estado / datos | TanStack Query, React Hook Form + Zod |
| Editor de plantillas | Tiptap |
| Base de datos | Firebase Firestore |
| Almacenamiento | Firebase Storage |
| Backend | Firebase Cloud Functions (Node 18) |
| Autenticación | Firebase Authentication (Google) |
| OCR | Google Cloud Vision API |
| Email | Gmail API (Google Workspace) |
| Integraciones | Google Drive, Google Sheets, Viterbit (ATS), HubSpot, Jira, Slack |

---

## Módulos

### 1. Documentación de ingreso

1. El reclutador crea un candidato desde el dashboard (o llega automáticamente vía webhook de **Viterbit**) → se genera un **token único**
2. Se envía un **correo de invitación** con el enlace personalizado al candidato
3. El candidato sube sus documentos (INE, CURP, RFC, comprobante de domicilio, comprobante de estudios, etc. — configurables desde **Configuración del formulario**)
4. Una **Cloud Function** dispara Google Cloud Vision para validar cada documento por OCR al subirse
5. Los documentos válidos se guardan en **Firebase Storage** y Firestore; el reclutador puede sincronizar a **Google Drive** y **Google Sheets**
6. Si hay documentos pendientes, se pueden enviar **correos de seguimiento** (manuales o programados)
7. Con todos los documentos validados, el reclutador aprueba o rechaza al candidato

### 2. Carta oferta

- Generación de la carta oferta en PDF a partir de plantillas configurables (variables del candidato/puesto)
- Envío por correo y **firma electrónica** del candidato con evidencia (fecha, IP, firma capturada)
- Reemisión de oferta con datos corregidos, restringida a roles autorizados (líder, nómina, legal, admin) — invalida la oferta y el contrato previamente firmados

### 3. Contrato

- Generación del contrato en PDF a partir de plantillas Word/HTML con variables detectadas automáticamente
- Firma electrónica del contrato con semáforo de estado según la validez de los campos capturados (verde = listo, ámbar = revisar)
- Envío del contrato firmado por correo y registro de evidencia de firma

### 4. Pruebas psicométricas

- Banco de preguntas y escenarios configurable por el admin (ponderaciones, bandas de calificación, tamaño de la prueba)
- El candidato resuelve la prueba desde un enlace dedicado
- Calificación automática con semáforo de resultado y detección de respuestas poco confiables

### 5. Integración con Viterbit (ATS)

- Webhook que recibe candidatos y cambios de etapa desde Viterbit
- Sincronización de datos del candidato y bloqueo de movimientos de etapa cuando hay documentos/contrato pendientes
- Aprobaciones pendientes procesadas de forma programada

### 6. Seguimiento de desempeño

- Revisión automática (programada) a los 15/30 días de ingreso del colaborador
- Backfill manual para candidatos ya contratados

### 7. Provisión de cuentas y otras integraciones

- Creación de cuentas/recursos corporativos (correo, Slack, HubSpot) al confirmarse la contratación
- Integraciones auxiliares con Jira y tickets de correo para seguimiento operativo

### 8. Roles y permisos

- Roles: `admin`, `reclutador`, `lider` (líder de reclutamiento), `nomina`, `legal`
- Permisos granulares por módulo (candidatos, proceso de reclutamiento, pruebas psicométricas, configuración, administración), editables desde **Configuración → Roles**

---

## Setup

### 1. Prerrequisitos

- Node.js 18+
- Firebase CLI: `npm install -g firebase-tools`
- Proyecto en [Firebase Console](https://console.firebase.google.com) con:
  - Authentication (Google provider habilitado)
  - Firestore
  - Storage
  - Cloud Functions (plan Blaze)
- Google Cloud Vision API habilitada en el proyecto
- Google Workspace con OAuth 2.0 para Gmail, Drive y Sheets
- (Opcional, según integraciones habilitadas) credenciales de Viterbit, HubSpot, Jira y Slack

### 2. Variables de entorno (Frontend)

```bash
cp .env.example .env
```

Llena el archivo `.env` con las credenciales de tu proyecto Firebase y la URL base de las Functions (`VITE_FUNCTIONS_URL`, normalmente `/api`).

### 3. Configuración de Cloud Functions

```bash
# Autenticarse
firebase login

# Configurar variables de entorno de las Functions
firebase functions:config:set \
  gmail.client_id="TU_CLIENT_ID" \
  gmail.client_secret="TU_CLIENT_SECRET" \
  gmail.refresh_token="TU_REFRESH_TOKEN" \
  gmail.user="reclutamiento@aviva.com" \
  drive.client_id="TU_CLIENT_ID" \
  drive.client_secret="TU_CLIENT_SECRET" \
  drive.refresh_token="TU_REFRESH_TOKEN" \
  drive.parent_folder_id="ID_CARPETA_DRIVE_RAIZ" \
  sheets.client_id="TU_CLIENT_ID" \
  sheets.client_secret="TU_CLIENT_SECRET" \
  sheets.refresh_token="TU_REFRESH_TOKEN" \
  sheets.spreadsheet_id="ID_GOOGLE_SHEETS" \
  sheets.sheet_name="Candidatos"
```

> Para obtener los tokens OAuth 2.0 de Google, usa el [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
> con los scopes: Gmail Send, Drive, Spreadsheets.
>
> Las integraciones con Viterbit, HubSpot, Jira y Slack usan sus propias variables de configuración/secretos; revisa `functions/src/integrations/` para las que estén habilitadas en tu despliegue.

### 4. Instalar y correr en desarrollo

```bash
# Frontend
npm install
npm run dev

# Functions (en otra terminal)
cd functions
npm install
npm run build:watch
```

### 5. Deploy

```bash
# Build del frontend
npm run build

# Deploy completo (hosting + functions + rules)
firebase deploy
```

---

## Estructura del proyecto

```
aviva-recruiting/
├── src/                            # Frontend React
│   ├── components/
│   │   ├── candidate/              # Formulario y subida de documentos del candidato
│   │   ├── dashboard/              # Dashboard del reclutador (lista y detalle de candidatos)
│   │   ├── offer/                  # Firma y visualización de la carta oferta
│   │   ├── psychometric/           # Banco de preguntas, sesiones y resultados de la prueba
│   │   ├── settings/               # Pantallas de configuración
│   │   ├── layout/                 # Layout general
│   │   └── ui/                     # Componentes reutilizables
│   ├── hooks/                      # React hooks (auth, candidates, form, psychometric session)
│   ├── pages/                      # Páginas: Dashboard, Documentos, Oferta, Contrato,
│   │                                #   Pruebas psicométricas, Plantillas, Roles, Ajustes, etc.
│   ├── services/                   # Servicios Firebase (Firestore, Storage, Functions)
│   ├── types/                      # Tipos TypeScript (incluye roles y permisos)
│   └── lib/                        # Configuración Firebase
├── functions/                      # Cloud Functions
│   └── src/
│       ├── email/                  # Invitaciones, recordatorios, OAuth de Gmail
│       ├── ocr/                    # Validación de documentos por OCR
│       ├── offer/                  # Generación, envío y firma de carta oferta
│       ├── contract/               # Generación, análisis y firma de contrato
│       ├── psychometricTest/       # Banco de preguntas, calificación y sesiones
│       ├── viterbit/               # Webhook y sincronización con el ATS
│       ├── performance/            # Seguimiento de desempeño a 15/30 días
│       ├── integrations/           # Drive, Sheets, HubSpot, Jira, Slack, provisión de cuentas
│       └── utils/                  # Admin SDK, permisos, helpers compartidos
├── firestore.rules                 # Reglas de seguridad Firestore
├── storage.rules                   # Reglas de seguridad Storage
├── firestore.indexes.json          # Índices Firestore
└── firebase.json                   # Configuración Firebase
```
