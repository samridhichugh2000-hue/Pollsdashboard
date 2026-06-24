import { NextResponse } from 'next/server'
import { getPollsByStatus, updatePollStatus, createAuditLog, upsertPollResponse } from '@/lib/db/queries'
import { getFormResponses } from '@/lib/graph'

const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

function toISTDateStr(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().split('T')[0]
}

function istHour(date: Date): number {
  return new Date(date.getTime() + IST_OFFSET_MS).getUTCHours()
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  // Hard gate: never close polls before 11:50 PM IST regardless of when the cron fires.
  // This protects against midnight-IST false-closes if the cron ever runs off-schedule
  // (e.g. GitHub Actions delay, manual trigger at wrong time).
  if (istHour(now) < 23) {
    return NextResponse.json({ closed: 0, message: 'Too early — polls only close after 11:50 PM IST' })
  }

  const activePolls = await getPollsByStatus(['SENT', 'REMINDER_SENT'] as Parameters<typeof getPollsByStatus>[0])
  const todayISTDate = toISTDateStr(now)
  let closed = 0

  for (const poll of activePolls) {
    if (poll.deadline) {
      if (toISTDateStr(new Date(poll.deadline)) > todayISTDate) continue
    } else {
      if (!poll.sent_at || Date.now() - new Date(poll.sent_at).getTime() < FORTY_EIGHT_HOURS) continue
    }

    try {
      if (poll.ms_form_id) {
        const responses = await getFormResponses(poll.ms_form_id)
        if (responses.length > 0) {
          await upsertPollResponse(poll.id, JSON.stringify(responses))
        }
      }

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
