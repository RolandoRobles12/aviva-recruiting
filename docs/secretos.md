# Secretos de Cloud Functions

Todas las credenciales viven en **Google Secret Manager** y se declaran una sola vez
en `functions/src/utils/secrets.ts`. Antes, varias eran parámetros `defineString`:
texto plano en `functions/.env`, visible para cualquiera con acceso a la
configuración de las funciones en la consola.

## Cuáles son

| Secreto | Para qué | ¿Obligatorio? |
|---|---|---|
| `DRIVE_SERVICE_ACCOUNT` | JSON de la cuenta de servicio de Drive/Sheets | Sí (ya existía) |
| `CHECKINS_SERVICE_ACCOUNT` | JSON de la cuenta de servicio de check-ins | Sí (ya existía) |
| `SLACK_CHAT_BOT_TOKEN` | Bot de alertas de OCR | Sí (ya existía) |
| `ANTHROPIC_API_KEY` | Validación de documentos y análisis de contratos | Sí |
| `VITERBIT_API_KEY` | API de Viterbit | Sí |
| `SLACK_BOT_TOKEN` | Bot del workspace principal | Sí |
| `JIRA_API_TOKEN` | Tickets de onboarding | Sí |
| `HUBSPOT_API_KEY` | Cuentas de HubSpot | Sí |
| `GMAIL_OAUTH_CLIENT_SECRET` | OAuth de Gmail de los reclutadores | Sí |
| `SLACK_GUEST_BOT_TOKEN` | Invitaciones al workspace de invitados | Opcional: si no se usa, valor `-` |
| `GMAIL_SA_PRIVATE_KEY` | Envío de respaldo con cuenta de servicio | Opcional: si no se usa, valor `-` |

Los identificadores que no son secretos (IDs de canal, URLs, correos, `JIRA_BASE_URL`,
`GMAIL_OAUTH_CLIENT_ID`, etapas de Viterbit…) siguen en `functions/.env`.

Cada función recibe **todos** los secretos: las v2 por `setGlobalOptions`
(`functions/src/globalOptions.ts`) y las cuatro v1 por `.runWith()`. Es más
sencillo y seguro de mantener que rastrear qué función usa qué llave, a cambio
de que cada función tenga acceso a todas. `tests/secrets.test.ts` falla si
alguna función queda sin algún secreto.

## Migración (una sola vez, antes del primer deploy con este cambio)

Necesitas permisos de Editor/Owner en el proyecto de Firebase.

1. **Crea cada secreto nuevo**, copiando el valor que hoy tiene en `functions/.env`
   (o `functions/.env.<proyecto>`):

   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY
   firebase functions:secrets:set VITERBIT_API_KEY
   firebase functions:secrets:set SLACK_BOT_TOKEN
   firebase functions:secrets:set JIRA_API_TOKEN
   firebase functions:secrets:set HUBSPOT_API_KEY
   firebase functions:secrets:set GMAIL_OAUTH_CLIENT_SECRET
   firebase functions:secrets:set SLACK_GUEST_BOT_TOKEN   # o "-" si no se usa
   firebase functions:secrets:set GMAIL_SA_PRIVATE_KEY    # o "-" si no se usa
   ```

   Cada comando pide el valor de forma interactiva. Para la llave privada de
   Gmail (varias líneas) usa `--data-file=ruta/al/archivo`.

2. **Borra esas mismas 8 líneas de `functions/.env`** (y de cualquier
   `functions/.env.<proyecto>`). Firebase se niega a desplegar un nombre que sea
   secreto y parámetro a la vez.

3. **Para el emulador local**, crea `functions/.secret.local` (ya está en
   `.gitignore`) con los 11 secretos en formato `NOMBRE=valor`, una línea cada
   uno. El emulador lee de ahí; sin ese archivo intenta leer Secret Manager con
   tus credenciales de `gcloud`.

4. **Despliega** normalmente:

   ```bash
   cd functions && npm run deploy
   ```

   Si falta algún secreto, el deploy falla indicando cuál; créalo y vuelve a
   desplegar.

5. **Verifica** en la consola de Google Cloud, en la configuración de alguna
   función, que esas llaves aparezcan como secretos y ya no como variables de
   entorno.

## Rotar una llave

```bash
firebase functions:secrets:set VITERBIT_API_KEY
cd functions && npm run deploy
```

Las funciones toman la versión nueva al redesplegarse. Después se puede destruir
la versión vieja con `firebase functions:secrets:prune`.
