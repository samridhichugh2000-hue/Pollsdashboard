import { NextResponse } from 'next/server'
import { getPollsByStatus, updatePollStatus, createAuditLog, upsertPollResponse } from '@/lib/db/queries'
import { getFormResponses } from '@/lib/graph'

const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

function toISTDateStr(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().split('T')[0]
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const activePolls = await getPollsByStatus(['SENT', 'REMINDER_SENT'] as Parameters<typeof getPollsByStatus>[0])
  const todayISTDate = toISTDateStr(new Date())
  let closed = 0

  for (const poll of activePolls) {
    // Cron fires at 11:58 PM IST daily. A poll whose deadline is today closes at that
    // moment. Legacy polls with no deadline fall back to a 48h-after-send guard.
    if (poll.deadline) {
      if (toISTDateStr(new Date(poll.deadline)) > todayISTDate) continue
    } else {
      if (!poll.sent_at || Date.now() - new Date(poll.sent_at).getTime() < FORTY_EIGHT_HOURS) continue
    }

    try {
      // Snapshot latest responses from MS Forms into DB so they are ready
      // when results are shared manually from the dashboard.
      if (poll.ms_form_id) {
        const responses = await getFormResponses(poll.ms_form_id)
        if (responses.length > 0) {
          await upsertPollResponse(poll.id, JSON.stringify(responses))
        }
      }

      // Close the poll — results are NOT auto-sent. Share manually via the dashboard.
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
