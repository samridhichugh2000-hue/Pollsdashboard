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

  const text = await res.text()
  if (!text) return {} as T
  return JSON.parse(text) as T
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

export interface EmailAttachment {
  name: string
  contentType: string
  contentBytes: string // base64
}

export interface SendEmailOptions {
  from: string
  to: string | string[]
  subject: string
  htmlBody: string
  replyToMessageId?: string
  conversationId?: string
  attachments?: EmailAttachment[]
}

function extractEmail(addr: string): string {
  const match = addr.match(/<([^>]+)>/)
  return match ? match[1].trim() : addr.trim()
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const toRecipients = Array.isArray(options.to)
    ? options.to.map((addr) => ({ emailAddress: { address: extractEmail(addr) } }))
    : [{ emailAddress: { address: extractEmail(options.to) } }]

  const message: Record<string, unknown> = {
    subject: options.subject,
    body: { contentType: 'HTML', content: options.htmlBody },
    toRecipients,
  }

  if (options.attachments?.length) {
    message.attachments = options.attachments.map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
    }))
  }

  await graphRequest(`/users/${options.from}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({ message, saveToSentItems: true }),
  })
}

// Sends email via two-step (create draft → send) and returns the stable internetMessageId.
// The Graph message `id` changes when it moves from Drafts → Sent Items, but
// `internetMessageId` (RFC 2822 Message-ID header) is stable and safe to store for threading.
export async function sendEmailGetId(options: SendEmailOptions): Promise<string> {
  const toRecipients = Array.isArray(options.to)
    ? options.to.map((addr) => ({ emailAddress: { address: extractEmail(addr) } }))
    : [{ emailAddress: { address: extractEmail(options.to) } }]

  const messageBody: Record<string, unknown> = {
    subject: options.subject,
    body: { contentType: 'HTML', content: options.htmlBody },
    toRecipients,
  }
  if (options.attachments?.length) {
    messageBody.attachments = options.attachments.map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
    }))
  }

  // Create draft — response includes stable internetMessageId
  const created = await graphRequest<{ id: string; internetMessageId: string }>(
    `/users/${options.from}/messages`,
    { method: 'POST', body: JSON.stringify(messageBody) }
  )

  // Send the draft
  await graphRequest(`/users/${options.from}/messages/${created.id}/send`, { method: 'POST' })

  // Return the RFC Message-ID (e.g. <abc@...>) — persists after Drafts → Sent move
  return created.internetMessageId
}

// Sends an HTML email threaded onto the same conversation as the original release email.
// Uses In-Reply-To / References headers (RFC 2822) — no dependency on Graph message IDs.
export async function replyToMessageWithHtml(
  from: string,
  internetMessageId: string, // the RFC Message-ID stored from sendEmailGetId
  options: { subject: string; htmlBody: string; to: string[]; attachments?: EmailAttachment[] }
): Promise<void> {
  const toRecipients = options.to.map((addr) => ({ emailAddress: { address: extractEmail(addr) } }))

  const messageBody: Record<string, unknown> = {
    subject: options.subject,
    body: { contentType: 'HTML', content: options.htmlBody },
    toRecipients,
    // Standard RFC 2822 threading headers — Outlook threads by these
    internetMessageHeaders: [
      { name: 'In-Reply-To', value: internetMessageId },
      { name: 'References', value: internetMessageId },
    ],
  }
  if (options.attachments?.length) {
    messageBody.attachments = options.attachments.map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
    }))
  }

  const created = await graphRequest<{ id: string }>(
    `/users/${from}/messages`,
    { method: 'POST', body: JSON.stringify(messageBody) }
  )
  await graphRequest(`/users/${from}/messages/${created.id}/send`, { method: 'POST' })
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
