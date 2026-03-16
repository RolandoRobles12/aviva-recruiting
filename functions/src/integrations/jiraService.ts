import { defineString } from 'firebase-functions/params';

const JIRA_BASE_URL = defineString('JIRA_BASE_URL');       // e.g. https://aviva.atlassian.net
const JIRA_USER_EMAIL = defineString('JIRA_USER_EMAIL');   // e.g. admin@avivacredito.com
const JIRA_API_TOKEN = defineString('JIRA_API_TOKEN');
const JIRA_PROJECT_KEY = defineString('JIRA_PROJECT_KEY'); // e.g. IT

function getAuthHeader(): string {
  return `Basic ${Buffer.from(`${JIRA_USER_EMAIL.value()}:${JIRA_API_TOKEN.value()}`).toString('base64')}`;
}

/**
 * Create a Jira Service Management ticket to request a corporate email account.
 * Returns the ticket key (e.g. "IT-123") and ID.
 */
export async function createEmailTicket(params: {
  candidateName: string;
  position: string;
  candidateId: string;
  personalEmail: string;
}): Promise<{ ticketKey: string; ticketId: string }> {
  const baseUrl = JIRA_BASE_URL.value().replace(/\/$/, '');

  const resp = await fetch(`${baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        project: { key: JIRA_PROJECT_KEY.value() },
        summary: `Crear correo corporativo — ${params.candidateName} (${params.position})`,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: `Solicitud automática de creación de correo corporativo para nuevo colaborador.`,
                },
              ],
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Nombre: ', marks: [{ type: 'strong' }] },
                { type: 'text', text: params.candidateName },
              ],
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Puesto: ', marks: [{ type: 'strong' }] },
                { type: 'text', text: params.position },
              ],
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Email personal: ', marks: [{ type: 'strong' }] },
                { type: 'text', text: params.personalEmail },
              ],
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Instrucciones: Crear el correo corporativo y escribirlo en el campo "Correo Corporativo" de este ticket antes de cerrarlo.',
                  marks: [{ type: 'strong' }],
                },
              ],
            },
          ],
        },
        issuetype: { name: 'Task' },
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Jira createIssue failed: HTTP ${resp.status} — ${text}`);
  }

  const data = (await resp.json()) as { key: string; id: string };
  return { ticketKey: data.key, ticketId: data.id };
}

/**
 * Check if a Jira ticket is resolved/closed and read the corporate email
 * from a custom field or from the ticket comments.
 *
 * Returns the corporate email if found, null if ticket is still open.
 */
export async function checkTicketResolved(ticketKey: string): Promise<{
  resolved: boolean;
  corporateEmail: string | null;
}> {
  const baseUrl = JIRA_BASE_URL.value().replace(/\/$/, '');

  const resp = await fetch(
    `${baseUrl}/rest/api/3/issue/${ticketKey}?fields=status,comment,customfield_10100`,
    {
      headers: {
        'Authorization': getAuthHeader(),
        'Accept': 'application/json',
      },
    }
  );

  if (!resp.ok) {
    console.error(`Jira getIssue ${ticketKey} → HTTP ${resp.status}`);
    return { resolved: false, corporateEmail: null };
  }

  const data = (await resp.json()) as {
    fields: {
      status: { statusCategory: { key: string } };
      comment: { comments: Array<{ body: { content: Array<{ content: Array<{ text?: string }> }> } }> };
      customfield_10100?: string;
    };
  };

  const statusKey = data.fields.status.statusCategory.key;
  const isDone = statusKey === 'done';

  if (!isDone) {
    return { resolved: false, corporateEmail: null };
  }

  // Try custom field first
  const customFieldEmail = data.fields.customfield_10100;
  if (customFieldEmail && customFieldEmail.includes('@')) {
    return { resolved: true, corporateEmail: customFieldEmail.trim() };
  }

  // Fallback: search last comments for an email address
  const comments = data.fields.comment?.comments ?? [];
  for (let i = comments.length - 1; i >= 0; i--) {
    const blocks = comments[i].body?.content ?? [];
    for (const block of blocks) {
      const texts = block.content ?? [];
      for (const t of texts) {
        const emailMatch = t.text?.match(/[\w.-]+@[\w.-]+\.\w+/);
        if (emailMatch) {
          return { resolved: true, corporateEmail: emailMatch[0].trim() };
        }
      }
    }
  }

  return { resolved: true, corporateEmail: null };
}
