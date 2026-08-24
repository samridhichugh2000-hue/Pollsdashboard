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

const POLL_KEYWORDS = ['poll', 'survey', 'questionnaire', 'run a poll', 'create a poll', 'conduct a poll', 'conduct a survey']
const EXCLUDE_SENDERS = [process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com']

// Subjects containing these phrases are system/dashboard-generated — never poll requests
const EXCLUDE_SUBJECT_PHRASES = [
  'acknowledgment of new task',
  'feedback by user for rms',
  'poll approval required',   // approval notification emails sent by the dashboard
  'automatic reply:',         // out-of-office / auto-reply emails
  'accepted:',                // calendar acceptance emails
  'reminder: for rms task',   // RMS system reminders
  'acknowledgment of new agent improvement request', // agent-improvement ticketing system notifications
  'new agent task',                                  // agent-task assignment notifications
  'agent improvements that you must be aware of',    // agent-improvement digest emails
]

// Body phrases that indicate a dashboard-released poll email or a reply to one
const EXCLUDE_BODY_PHRASES = [
  'fill out the poll',
  'take the poll',
]

export function isSystemNotificationEmail(subject: string): boolean {
  const s = subject.toLowerCase()
  return EXCLUDE_SUBJECT_PHRASES.some(phrase => s.includes(phrase))
}

// Candidates are found by recency, not by the mailbox's isRead flag — a
// message can be marked read by anyone with mailbox access (e.g. opening it
// in Outlook's preview pane) well before the detector ever sees it, which
// used to hide it from every future run with no record it had arrived.
// Callers dedup against the app's own processed_inbox_messages table instead
// (see lib/db/queries.ts getProcessedMessageIds/markMessageProcessed), so
// "already handled" is a fact the app records itself.
const CANDIDATE_WINDOW_DAYS = 14

export async function getRecentPollEmails(userEmail: string): Promise<GraphMessage[]> {
  const since = new Date(Date.now() - CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const messages = await getInboxMessages(userEmail, `receivedDateTime ge ${since}`)
  return messages.filter((m) => {
    if (EXCLUDE_SENDERS.some(s => m.from.emailAddress.address.toLowerCase() === s.toLowerCase())) return false
    if (isSystemNotificationEmail(m.subject)) return false
    const body = (m.bodyPreview ?? '').toLowerCase()
    if (EXCLUDE_BODY_PHRASES.some(phrase => body.includes(phrase))) return false
    const text = `${m.subject} ${body}`
    return POLL_KEYWORDS.some(kw => text.includes(kw))
  })
}

// KGT (knowledge/ownership transfer) requests come from a small named list of
// people — any recent mail from an authorized requester is a candidate, since
// they don't always spell out "KGT" in the subject. Kept unfiltered by
// keyword; the dashboard's DRAFT review step is the actual confirmation gate.
export async function getRecentKGTEmails(userEmail: string, authorizedEmails: Set<string>): Promise<GraphMessage[]> {
  const since = new Date(Date.now() - CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const messages = await getInboxMessages(userEmail, `receivedDateTime ge ${since}`)
  return messages.filter((m) => {
    const sender = m.from.emailAddress.address.toLowerCase()
    if (!authorizedEmails.has(sender)) return false
    if (isSystemNotificationEmail(m.subject)) return false
    return true
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

  // Graph only grants this app direct mailbox access via Priya's account —
  // calling /users/{mailbox}/sendMail for polls@ (or any other address)
  // 404s with ErrorInvalidUser. So the API call always goes through Priya's
  // mailbox; a different visible sender (e.g. polls@) is achieved the same
  // way sendEmailGetId/replyToMessageWithHtml already do it — via Exchange
  // Send-As, by setting the message's own `from` field.
  const actingMailbox = process.env.PRIYA_EMAIL!
  const message: Record<string, unknown> = {
    subject: options.subject,
    body: { contentType: 'HTML', content: options.htmlBody },
    toRecipients,
    ...(options.from && options.from !== actingMailbox && { from: { emailAddress: { address: options.from } } }),
  }

  if (options.cc) {
    const ccList = Array.isArray(options.cc) ? options.cc : [options.cc]
    message.ccRecipients = ccList.map((addr) => ({ emailAddress: { address: extractEmail(addr) } }))
  }

  if (options.bcc) {
    const bccList = Array.isArray(options.bcc) ? options.bcc : [options.bcc]
    message.bccRecipients = bccList.map((addr) => ({ emailAddress: { address: extractEmail(addr) } }))
  }

  if (options.attachments?.length) {
    message.attachments = options.attachments.map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
    }))
  }

  await graphRequest(`/users/${actingMailbox}/sendMail`, {
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

// polls@koenig-solutions.com is a Send-As address, not a real mailbox object
// — Graph 404s (ErrorInvalidUser) on any /users/polls@.../messages call, so
// despite release/reminder emails displaying "From: polls@", their Sent
// Items copy actually lands in whichever mailbox executed the send, not the
// impersonated From address. Before the mail identity moved from Priya to
// Gunjan (2026-08-21), that was Priya's mailbox — so any poll released
// before the switch is only findable there, never under the current
// PRIYA_EMAIL. Kept as a permanent fallback so old polls stay forwardable.
const LEGACY_ACTING_MAILBOX = 'priya.upadhyay@koenig-solutions.com'

// Looks up a previously-sent message in Sent Items by its RFC internetMessageId.
// Shared by replyToMessageWithHtml and forwardMessageWithHtml.
// ConsistencyLevel: eventual is required for filtering on non-indexed properties.
async function findSentMessage(from: string, internetMessageId: string, logLabel: string): Promise<{ mailbox: string; id: string }> {
  const filter = `internetMessageId eq '${internetMessageId.replace(/'/g, "''")}'`
  // $count=true is required alongside ConsistencyLevel:eventual for advanced query capabilities
  const qs = `$filter=${encodeURIComponent(filter)}&$select=id&$top=1&$count=true`

  const pollsMailbox = process.env.POLLS_MAILBOX
  const mailboxesToSearch = [...new Set([pollsMailbox, from, LEGACY_ACTING_MAILBOX].filter(Boolean))] as string[]

  console.log(`[${logLabel}] Searching for internetMessageId: ${internetMessageId}`)
  for (const mailbox of mailboxesToSearch) {
    try {
      console.log(`[${logLabel}] Searching mailbox: ${mailbox}`)
      const search = await graphRequest<{ value: Array<{ id: string }> }>(
        `/users/${mailbox}/mailFolders/SentItems/messages?${qs}`,
        { headers: { ConsistencyLevel: 'eventual' } }
      )
      console.log(`[${logLabel}] Found ${search.value?.length ?? 0} result(s) in ${mailbox}`)
      if (search.value?.[0]?.id) {
        return { mailbox, id: search.value[0].id }
      }
    } catch (searchErr) {
      console.warn(`[${logLabel}] Could not search mailbox ${mailbox} (skipping):`, searchErr)
    }
  }

  throw new Error(`Could not find message in Sent Items (internetMessageId: ${internetMessageId}). Searched: ${mailboxesToSearch.join(', ')}`)
}

// Replies on the same thread as the original release email, using the Graph
// /reply endpoint (which handles threading natively).
export async function replyToMessageWithHtml(
  from: string,
  internetMessageId: string, // RFC Message-ID stored from sendEmailGetId
  options: { subject: string; htmlBody: string; to: string[]; bcc?: string[]; attachments?: EmailAttachment[] }
): Promise<void> {
  const { mailbox: foundInMailbox, id: sentMessageId } = await findSentMessage(from, internetMessageId, 'replyToMessageWithHtml')

  const toRecipients = options.to.map((addr) => ({ emailAddress: { address: extractEmail(addr) } }))
  const pollsSender = process.env.POLLS_MAILBOX ?? from
  const message: Record<string, unknown> = {
    body: { contentType: 'HTML', content: options.htmlBody },
    toRecipients,
    from: { emailAddress: { address: pollsSender } },
  }
  if (options.bcc?.length) {
    message.bccRecipients = options.bcc.map((addr) => ({ emailAddress: { address: extractEmail(addr) } }))
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

// Forwards a previously-sent message (found by RFC internetMessageId, same
// lookup as replyToMessageWithHtml) instead of composing a new email —
// Graph's createForward action carries the original message's own
// attachments onto the new draft automatically, so a poll's release
// attachments ride along through every reminder/closure email that forwards
// it, and ultimately to the results-sharing email at the end of the chain.
// Returns the new message's internetMessageId so callers can thread further
// forwards (e.g. "forward the last reminder") off this one.
export async function forwardMessageWithHtml(
  from: string,
  internetMessageId: string,
  options: { htmlBody: string; to: string[]; bcc?: string[]; attachments?: EmailAttachment[] }
): Promise<string> {
  const { mailbox: foundInMailbox, id: sourceMessageId } = await findSentMessage(from, internetMessageId, 'forwardMessageWithHtml')

  const toRecipients = options.to.map((addr) => ({ emailAddress: { address: extractEmail(addr) } }))
  const bccRecipients = options.bcc?.length
    ? options.bcc.map((addr) => ({ emailAddress: { address: extractEmail(addr) } }))
    : undefined
  const pollsSender = process.env.POLLS_MAILBOX ?? from

  // createForward returns a draft (in Drafts) with the original message's
  // attachments and quoted content already copied in — we only need to
  // prepend our own HTML ahead of that quoted content, not rebuild it.
  const draft = await graphRequest<{ id: string; internetMessageId: string; body: { contentType: string; content: string } }>(
    `/users/${foundInMailbox}/messages/${sourceMessageId}/createForward`,
    {
      method: 'POST',
      body: JSON.stringify({
        toRecipients,
        ...(bccRecipients && { bccRecipients }),
        message: { from: { emailAddress: { address: pollsSender } } },
      }),
    }
  )

  await graphRequest(`/users/${foundInMailbox}/messages/${draft.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: { contentType: 'HTML', content: options.htmlBody + (draft.body?.content ?? '') } }),
  })

  if (options.attachments?.length) {
    for (const a of options.attachments) {
      await graphRequest(`/users/${foundInMailbox}/messages/${draft.id}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.name,
          contentType: a.contentType,
          contentBytes: a.contentBytes,
        }),
      })
    }
  }

  await graphRequest(`/users/${foundInMailbox}/messages/${draft.id}/send`, { method: 'POST' })

  return draft.internetMessageId
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
