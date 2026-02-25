# Aviva Recruiting

Sistema de reclutamiento y gestión de documentación de ingreso para el equipo de Aviva.

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + Vite + TypeScript + Tailwind CSS |
| Base de datos | Firebase Firestore |
| Almacenamiento | Firebase Storage |
| Backend | Firebase Cloud Functions (Node 18) |
| OCR | Google Cloud Vision API |
| Email | Gmail API (Google Workspace) |
| Integraciones | Google Drive + Google Sheets |

---

## Módulo 1 — Gestión de Documentación

### Flujo completo

1. El reclutador crea un candidato desde el dashboard → se genera un **token único**
2. Se envía automáticamente un **correo de invitación** con el enlace personalizado
3. El candidato abre el enlace y sube sus documentos:
   - INE / Identificación oficial
   - CURP
   - RFC con homoclave
   - Comprobante de domicilio
   - Comprobante de estudios
4. **Cloud Function** dispara Google Cloud Vision para validar cada documento via OCR
5. Los documentos válidos se guardan en **Firebase Storage** y Firestore
6. El reclutador puede sincronizar a **Google Drive** (carpeta del candidato) y **Google Sheets**
7. Si hay documentos pendientes, el reclutador puede enviar **correos de seguimiento**
8. Con todos los documentos validados, el reclutador puede **aprobar o rechazar** al candidato

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

### 2. Variables de entorno (Frontend)

```bash
cp .env.example .env
```

Llena el archivo `.env` con las credenciales de tu proyecto Firebase.

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
├── src/                          # Frontend React
│   ├── components/
│   │   ├── candidate/            # Formulario del candidato
│   │   ├── dashboard/            # Dashboard del reclutador
│   │   ├── layout/               # Layout general
│   │   └── ui/                   # Componentes reutilizables
│   ├── hooks/                    # React hooks (auth, candidates, form)
│   ├── pages/                    # Páginas (Login, Dashboard, CandidateForm)
│   ├── services/                 # Servicios Firebase (Firestore, Storage, Functions)
│   ├── types/                    # Tipos TypeScript
│   └── lib/                      # Configuración Firebase
├── functions/                    # Cloud Functions
│   └── src/
│       ├── email/                # sendInvitationEmail, sendReminderEmail
│       ├── ocr/                  # triggerOcrValidation, onDocumentUploaded
│       ├── drive/                # syncToGoogleDrive
│       ├── sheets/               # syncToGoogleSheets
│       └── utils/                # admin SDK, helpers
├── firestore.rules               # Reglas de seguridad Firestore
├── storage.rules                 # Reglas de seguridad Storage
├── firestore.indexes.json        # Índices Firestore
└── firebase.json                 # Configuración Firebase
```

---

## Próximos módulos

- **Módulo 2:** Generación y firma de contratos (integración con firma electrónica)
- **Módulo 3:** Creación automática de usuarios en herramientas internas
- **Módulo 4:** Integración con Humand (software de HR)
