import { NextResponse } from 'next/server'
import { getPollsByStatus, getPollAttachments } from '@/lib/db/queries'
import { releasePollNow } from '@/lib/poll-release'
import { toISTDateStr } from '@/lib/utils'

// Auto-releases one-time polls scheduled for a future date (SCHEDULE_RELEASE
// action) once their scheduled IST calendar day arrives. Deliberately does
// not skip weekends — unlike reminders/closure alerts, the release date here
// was a deliberate choice by whoever scheduled it, not a routine nudge.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const todayISTDate = toISTDateStr(new Date())
  let released = 0
  let skipped = 0

  const scheduledPolls = await getPollsByStatus('SCHEDULED')
  for (const poll of scheduledPolls) {
    if (!poll.scheduled_release_at) continue
    if (toISTDateStr(new Date(poll.scheduled_release_at)) > todayISTDate) continue // not due yet

    try {
      const allEmails: string[] = poll.scheduled_release_emails ? JSON.parse(poll.scheduled_release_emails) : []
      if (!allEmails.length || !poll.ms_form_link || !poll.draft_email_body) {
        console.warn(`Scheduled poll ${poll.id} is missing recipients/form/draft — skipping`)
        skipped++
        continue
      }
      const attachments = await getPollAttachments(poll.id)
      await releasePollNow(poll, poll.id, allEmails, attachments, 'cron')
      released++
    } catch (err) {
      console.error(`Failed to auto-release scheduled poll ${poll.id}:`, err)
    }
  }

  return NextResponse.json({ released, skipped })
}
