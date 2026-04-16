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
  // Note: Graph API does not allow $orderby with $filter on messages without ConsistencyLevel headers.
  // When a filter is provided we fetch without $orderby and sort in JS instead.
  const url = filter
    ? `/users/${userEmail}/mailFolders/Inbox/messages?$top=100&$filter=${encodeURIComponent(filter)}`
    : `/users/${userEmail}/mailFolders/Inbox/messages?$top=100&$orderby=receivedDateTime desc`
  const data = await graphRequest<{ value: GraphMessage[] }>(url)
  const messages = data.value ?? []
  // Sort newest first when $orderby is not applied
  if (filter) messages.sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())
  return messages
}

const POLL_KEYWORDS = ['poll', 'survey', 'questionnaire', 'feedback form', 'run a poll', 'create a poll', 'conduct a poll', 'conduct a survey']
const EXCLUDE_SENDERS = [process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com']

export async function getUnreadPollEmails(userEmail: string): Promise<GraphMessage[]> {
  const messages = await getInboxMessages(userEmail, `isRead eq false`)
  return messages.filter((m) => {
    if (EXCLUDE_SENDERS.some(s => m.from.emailAddress.address.toLowerCase() === s.toLowerCase())) return false
    const text = `${m.subject} ${m.bodyPreview}`.toLowerCase()
    return POLL_KEYWORDS.some(kw => text.includes(kw))
  })
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
  cc?: string | string[]
  bcc?: string | string[]
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

  // Approval requests, results and reminders are sent from Priya's address — no from override.
  const message: Record<string, unknown> = {
    subject: options.subject,
    body: { contentType: 'HTML', content: options.htmlBody },
    toRecipients,
  }

  if (options.cc) {
    const ccList = Array.isArray(options.cc) ? options.cc : [options.cc]
    message.ccRecipients = ccList.map((addr) => ({ emailAddress: { address: extractEmail(addr) } }))
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

// Sends email via two-step (create draft → send) and returns the stable RFC internetMessageId.
// The Graph message `id` changes when it moves from Drafts → Sent Items, but
// `internetMessageId` (RFC 2822 Message-ID header) is stable and safe to store for threading.
export async function sendEmailGetId(options: SendEmailOptions): Promise<string> {
  const toRecipients = Array.isArray(options.to)
    ? options.to.map((addr) => ({ emailAddress: { address: extractEmail(addr) } }))
    : [{ emailAddress: { address: extractEmail(options.to) } }]

  // Poll release emails are sent from POLLS_MAILBOX (polls@koenig-solutions.com).
  // Priya's mailbox handles the API call; she must have Send As permission on the group.
  const pollsSender = process.env.POLLS_MAILBOX ?? options.from
  const messageBody: Record<string, unknown> = {
    subject: options.subject,
    body: { contentType: 'HTML', content: options.htmlBody },
    toRecipients,
    from: { emailAddress: { address: pollsSender } },
  }
  if (options.bcc) {
    const bccList = Array.isArray(options.bcc) ? options.bcc : [options.bcc]
    messageBody.bccRecipients = bccList.map((addr) => ({ emailAddress: { address: extractEmail(addr) } }))
  }
  if (options.attachments?.length) {
    messageBody.attachments = options.attachments.map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
    }))
  }

  // Create draft — response includes the stable RFC internetMessageId
  const created = await graphRequest<{ id: string; internetMessageId: string }>(
    `/users/${options.from}/messages`,
    { method: 'POST', body: JSON.stringify(messageBody) }
  )

  // Send the draft
  await graphRequest(`/users/${options.from}/messages/${created.id}/send`, { method: 'POST' })

  // Return the RFC Message-ID — stable even after the message moves Drafts → Sent Items
  return created.internetMessageId
}

// Replies on the same thread as the original release email.
// Looks up the sent message in Sent Items by its RFC internetMessageId, then uses
// the Graph /reply endpoint (which handles threading natively).
//
// Exchange saves the sent copy to the FROM address's Sent Items (polls mailbox),
// not Priya's, so we search polls@ first, then fall back to Priya's mailbox.
// ConsistencyLevel: eventual is required for filtering on non-indexed properties.
export async function replyToMessageWithHtml(
  from: string,
  internetMessageId: string, // RFC Message-ID stored from sendEmailGetId
  options: { subject: string; htmlBody: string; to: string[]; attachments?: EmailAttachment[] }
): Promise<void> {
  const filter = `internetMessageId eq '${internetMessageId.replace(/'/g, "''")}'`
  // $count=true is required alongside ConsistencyLevel:eventual for advanced query capabilities
  const qs = `$filter=${encodeURIComponent(filter)}&$select=id&$top=1&$count=true`

  // Search polls mailbox Sent Items first (release email sent "From: polls@"),
  // then fall back to Priya's Sent Items.
  const pollsMailbox = process.env.POLLS_MAILBOX
  const mailboxesToSearch = [...new Set([pollsMailbox, from].filter(Boolean))] as string[]

  let sentMessageId: string | undefined
  let foundInMailbox = from

  console.log(`[replyToMessageWithHtml] Searching for internetMessageId: ${internetMessageId}`)
  for (const mailbox of mailboxesToSearch) {
    try {
      console.log(`[replyToMessageWithHtml] Searching mailbox: ${mailbox}`)
      const search = await graphRequest<{ value: Array<{ id: string }> }>(
        `/users/${mailbox}/mailFolders/SentItems/messages?${qs}`,
        { headers: { ConsistencyLevel: 'eventual' } }
      )
      console.log(`[replyToMessageWithHtml] Found ${search.value?.length ?? 0} result(s) in ${mailbox}`)
      if (search.value?.[0]?.id) {
        sentMessageId = search.value[0].id
        foundInMailbox = mailbox
        break
      }
    } catch (searchErr) {
      console.warn(`[replyToMessageWithHtml] Could not search mailbox ${mailbox} (skipping):`, searchErr)
    }
  }

  if (!sentMessageId) {
    throw new Error(`Could not find release email in Sent Items (internetMessageId: ${internetMessageId}). Searched: ${mailboxesToSearch.join(', ')}`)
  }
  console.log(`[replyToMessageWithHtml] Found message ${sentMessageId} in ${foundInMailbox}, sending reply`)

  const toRecipients = options.to.map((addr) => ({ emailAddress: { address: extractEmail(addr) } }))
  const message: Record<string, unknown> = {
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

  await graphRequest(`/users/${foundInMailbox}/messages/${sentMessageId}/reply`, {
    method: 'POST',
    body: JSON.stringify({ message }),
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
