/**
 * Microsoft Graph API client helpers.
 * Uses application-level OAuth 2.0 (client credentials) for server-side access.
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

async function getAppAccessToken(): Promise<string> {
  const tenantId = process.env.AZURE_AD_TENANT_ID!
  const clientId = process.env.AZURE_AD_CLIENT_ID!
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET!

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }),
    }
  )

  const data = await res.json() as Record<string, string>
  if (!res.ok) {
    throw new Error(`Token request failed: ${data.error_description ?? JSON.stringify(data)}`)
  }
  return data.access_token
}

async function graphRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAppAccessToken()
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Graph API error ${res.status}: ${body}`)
  }

  if (res.status === 204) return {} as T
  return res.json() as Promise<T>
}

// ─── Inbox Reading ─────────────────────────────────────────────────────────────

export interface GraphMessage {
  id: string
  internetMessageId: string
  conversationId: string
  subject: string
  bodyPreview: string
  body: { content: string; contentType: string }
  from: { emailAddress: { address: string; name: string } }
  receivedDateTime: string
  isRead: boolean
}

export async function getInboxMessages(userEmail: string, filter?: string): Promise<GraphMessage[]> {
  const encodedFilter = filter ? `&$filter=${encodeURIComponent(filter)}` : ''
  const data = await graphRequest<{ value: GraphMessage[] }>(
    `/users/${userEmail}/mailFolders/Inbox/messages?$top=50&$orderby=receivedDateTime desc${encodedFilter}`
  )
  return data.value ?? []
}

export async function getUnreadPollEmails(userEmail: string): Promise<GraphMessage[]> {
  const messages = await getInboxMessages(userEmail, `isRead eq false`)
  return messages.filter((m) => m.subject.toLowerCase().includes('poll'))
}

// ─── Email Sending ─────────────────────────────────────────────────────────────

export interface SendEmailOptions {
  from: string
  to: string | string[]
  subject: string
  htmlBody: string
  replyToMessageId?: string
  conversationId?: string
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const toRecipients = Array.isArray(options.to)
    ? options.to.map((addr) => ({ emailAddress: { address: addr } }))
    : [{ emailAddress: { address: options.to } }]

  await graphRequest(`/users/${options.from}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject: options.subject,
        body: { contentType: 'HTML', content: options.htmlBody },
        toRecipients,
      },
      saveToSentItems: true,
    }),
  })
}

export async function replyToEmail(
  userEmail: string,
  messageId: string,
  htmlBody: string
): Promise<void> {
  await graphRequest(`/users/${userEmail}/messages/${messageId}/reply`, {
    method: 'POST',
    body: JSON.stringify({
      message: { body: { contentType: 'HTML', content: htmlBody } },
    }),
  })
}

export async function markEmailAsRead(userEmail: string, messageId: string): Promise<void> {
  await graphRequest(`/users/${userEmail}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ isRead: true }),
  })
}

// ─── Microsoft Forms ──────────────────────────────────────────────────────────

export interface MSForm {
  id: string
  webUrl: string
  title: string
}

export function createMSForm(pollId: string, title: string): MSForm {
  // MS Forms API does not support programmatic form creation with application permissions.
  // We use a self-hosted response page at /respond/[pollId] instead.
  const appUrl = process.env.NEXTAUTH_URL?.replace('http://localhost:3000', 'https://pollsdashboard.vercel.app') ?? 'https://pollsdashboard.vercel.app'
  return {
    id: pollId,
    webUrl: `${appUrl}/respond/${pollId}`,
    title,
  }
}

export async function getFormResponses(formId: string): Promise<Record<string, unknown>[]> {
  try {
    const data = await graphRequest<{ value: Record<string, unknown>[] }>(
      `/forms/${formId}/responses`
    )
    return data.value ?? []
  } catch {
    return []
  }
}
