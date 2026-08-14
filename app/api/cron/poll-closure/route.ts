import { NextResponse } from 'next/server'
import { getPollsByStatus, updatePollStatus, createAuditLog, upsertPollResponse, getPollResponse, closeOutUntouchedEntries } from '@/lib/db/queries'
import { sendEmail, getFormResponses } from '@/lib/graph'
import { buildResultsEmailHtml, toISTDateStr, istMinutesOfDay } from '@/lib/utils'
import * as XLSX from 'xlsx'

const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000
const CLOSE_GATE_IST_MINUTES = 23 * 60 + 58 // 11:58 PM IST

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const gateSatisfied = istMinutesOfDay(now) >= CLOSE_GATE_IST_MINUTES

  // ?force=1 lets an admin clear a genuine backlog (polls overdue from a PAST
  // day) without waiting for the nightly window — it must NEVER cut off a
  // poll whose deadline is today before 11:58 PM actually arrives, so it only
  // bypasses the early-return below, not the per-poll "is today's gate open" check.
  const forced = new URL(req.url).searchParams.get('force') === '1'

  if (!forced && !gateSatisfied) {
    return NextResponse.json({ closed: 0, message: 'Too early — polls only close after 11:58 PM IST' })
  }

  const activePolls = await getPollsByStatus(['SENT', 'REMINDER_SENT'] as Parameters<typeof getPollsByStatus>[0])
  const todayISTDate = toISTDateStr(now)
  let closed = 0

  for (const poll of activePolls) {
    if (poll.deadline) {
      const deadlineISTDate = toISTDateStr(new Date(poll.deadline))
      if (deadlineISTDate > todayISTDate) continue // deadline hasn't arrived yet
      // Deadline is today — only close once 11:58 PM IST has actually passed,
      // even on a forced/manual run. A poll from a strictly earlier day is a
      // genuine backlog and can close immediately.
      if (deadlineISTDate === todayISTDate && !gateSatisfied) continue
    } else {
      if (!poll.sent_at || Date.now() - new Date(poll.sent_at).getTime() < FORTY_EIGHT_HOURS) continue
    }

    try {
      // Snapshot latest responses from MS Forms
      if (poll.ms_form_id) {
        const responses = await getFormResponses(poll.ms_form_id)
        if (responses.length > 0) {
          await upsertPollResponse(poll.id, JSON.stringify(responses))
        }
      }

      // Build Excel attachment from stored responses
      const pollResponse = await getPollResponse(poll.id)
      let attachments: { name: string; contentType: string; contentBytes: string }[] = []
      if (pollResponse?.response_data) {
        const entries = JSON.parse(pollResponse.response_data) as Array<{
          respondent?: string; email?: string; submitted_at: string;
          answers: { question: string; answer: string }[]
        }>
        const rows = entries.map((entry, i) => {
          const row: Record<string, string> = {
            '#': String(i + 1),
            Name: entry.respondent ?? 'Anonymous',
          }
          entry.answers.forEach((a, qi) => { row[`Q${qi + 1}: ${a.question}`] = a.answer })
          return row
        })
        const headers = Object.keys(rows[0] ?? {})
        const ws = XLSX.utils.aoa_to_sheet([
          [`Poll: ${poll.topic}`],
          [],
          headers,
          ...rows.map(r => headers.map(h => r[h] ?? '')),
        ])
        ws['!cols'] = headers.map((key) => ({
          wch: Math.max(key.length, ...rows.map((r) => String(r[key] ?? '').length)) + 2,
        }))
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Responses')
        const xlsxBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string
        const filename = `poll-responses-${poll.topic.slice(0, 30).replace(/\s+/g, '-').toLowerCase()}.xlsx`
        attachments = [{ name: filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBytes: xlsxBase64 }]
      }

      // Mark CLOSED first — prevents duplicate sends if the email call fails
      // and the cron retries tomorrow night.
      await updatePollStatus(poll.id, 'CLOSED', {
        closed_at: new Date().toISOString(),
      })
      await createAuditLog(poll.id, 'AUTO_CLOSED', 'cron')
      await closeOutUntouchedEntries(poll.id)

      // Send results to EA
      const htmlBody = buildResultsEmailHtml(poll.topic, attachments.length > 0)
      await sendEmail({
        from: process.env.POLLS_MAILBOX ?? 'polls@koenig-solutions.com',
        to: process.env.RESULTS_RECIPIENT_EMAIL ?? 'ea@koenig-solutions.com',
        subject: `Poll Results: ${poll.topic}`,
        htmlBody,
        ...(attachments.length > 0 && { attachments }),
      })

      // Results just went out unconditionally above — reflect that in status
      // so this poll doesn't sit under "Result Not Sent" forever. Only runs
      // once the send has actually succeeded (this line is unreachable if it throws).
      await updatePollStatus(poll.id, 'RESULTS_SHARED', { results_uploaded_at: new Date().toISOString() })
      await createAuditLog(poll.id, 'RESULTS_SHARED', 'cron')
      closed++
    } catch (err) {
      console.error(`Failed to close poll ${poll.id}:`, err)
    }
  }

  return NextResponse.json({ closed })
}
