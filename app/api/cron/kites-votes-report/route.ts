import { NextRequest, NextResponse } from 'next/server'
import { getTopVotersInRange } from '@/lib/db/queries'
import { sendEmail } from '@/lib/graph'
import { buildTopVotersReportHtml, getLastCalendarMonthRange, getCalendarMonthRange } from '@/lib/utils'

// Monthly "Top 5 Employees by Poll Participation" report — ranks employees by
// how many polls they responded to in the given month. See getTopVotersInRange
// in lib/db/queries.ts.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // ?month=YYYY-MM lets this be re-run against a specific past month for
    // testing; defaults to the real "last calendar month" for the scheduled cron.
    const monthOverride = req.nextUrl.searchParams.get('month')
    const { startIso, endIsoExclusive, label } = monthOverride
      ? getCalendarMonthRange(monthOverride)
      : getLastCalendarMonthRange(new Date())
    const monthName = label.split(' ')[0]
    const topVoters = await getTopVotersInRange(startIso, endIsoExclusive, 5)

    // ?to= lets this be triggered ad hoc for a specific test recipient;
    // defaults to the configured report distribution list for the real cron run.
    const overrideTo = req.nextUrl.searchParams.get('to')
    const recipients = overrideTo
      ? [overrideTo]
      : (process.env.KITES_REPORT_RECIPIENTS ?? '').split(',').map(e => e.trim()).filter(Boolean)

    if (recipients.length === 0) {
      return NextResponse.json({ error: 'No recipients configured (set KITES_REPORT_RECIPIENTS or pass ?to=)' }, { status: 400 })
    }

    await sendEmail({
      from: process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com',
      to: recipients,
      subject: `Top 5 Employees by Poll Participation - ${monthName}`,
      htmlBody: buildTopVotersReportHtml({ monthLabel: monthName, topVoters }),
    })

    return NextResponse.json({
      sent: true,
      recipients,
      period: label,
      topVoters: topVoters.map(v => ({ name: v.full_name, votes: v.voteCount })),
    })
  } catch (err) {
    console.error('Top voters report error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Report failed' }, { status: 500 })
  }
}
