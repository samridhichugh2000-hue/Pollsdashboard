import { NextResponse } from 'next/server'
import { getPollsByStatus, updatePollStatus, createAuditLog, upsertPollResponse, getPollResponse } from '@/lib/db/queries'
import { sendEmail, getFormResponses } from '@/lib/graph'
import { buildResultsEmailHtml } from '@/lib/utils'
import * as XLSX from 'xlsx'

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

      // Send results email to EA
      const htmlBody = buildResultsEmailHtml(poll.topic, attachments.length > 0)
      await sendEmail({
        from: process.env.PRIYA_EMAIL!,
        to: process.env.RESULTS_RECIPIENT_EMAIL ?? 'ea@koenig-solutions.com',
        subject: `Poll Results: ${poll.topic}`,
        htmlBody,
        ...(attachments.length > 0 && { attachments }),
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
