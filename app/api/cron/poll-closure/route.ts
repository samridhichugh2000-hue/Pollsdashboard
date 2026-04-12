import { NextResponse } from 'next/server'
import { getPollsByStatus, updatePollStatus, createAuditLog, upsertPollResponse } from '@/lib/db/queries'
import { sendEmail, getFormResponses } from '@/lib/graph'
import { buildResultsEmailHtml } from '@/lib/utils'

const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const activePolls = await getPollsByStatus(['SENT', 'REMINDER_SENT'] as Parameters<typeof getPollsByStatus>[0])
  let closed = 0

  for (const poll of activePolls) {
    if (!poll.sent_at) continue

    const sentAt = new Date(poll.sent_at).getTime()
    const now = Date.now()

    if (now - sentAt < FORTY_EIGHT_HOURS) continue

    try {
      // Fetch responses from MS Forms
      if (poll.ms_form_id) {
        const responses = await getFormResponses(poll.ms_form_id)
        if (responses.length > 0) {
          await upsertPollResponse(poll.id, JSON.stringify(responses))
        }
      }

      // Send results email to EA
      const htmlBody = buildResultsEmailHtml(poll.topic)
      await sendEmail({
        from: process.env.PRIYA_EMAIL!,
        to: process.env.RESULTS_RECIPIENT_EMAIL ?? 'ea@koenig-solutions.com',
        subject: `Poll Results: ${poll.topic}`,
        htmlBody,
      })

      await updatePollStatus(poll.id, 'CLOSED', {
        closed_at: new Date().toISOString(),
      })

      await createAuditLog(poll.id, 'AUTO_CLOSED', 'cron')
      closed++
    } catch (err) {
      console.error(`Failed to close poll ${poll.id}:`, err)
    }
  }

  return NextResponse.json({ closed })
}
