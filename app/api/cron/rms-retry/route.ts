import { NextResponse } from 'next/server'
import { getPollsByStatus, updatePollStatus, createAuditLog, getPollResponse } from '@/lib/db/queries'
import { runMigrations } from '@/lib/db/schema'
import { pushPollToKites, buildResponsesHtml } from '@/lib/kites-api'
import type { Poll } from '@/types'

interface RMSEntry { respondent?: string; email?: string; submitted_at: string; answers: { question: string; answer: string }[] }

async function retryKitesPublish(poll: Poll): Promise<void> {
  const pollResponse = await getPollResponse(poll.id)
  if (!pollResponse?.response_data) {
    throw new Error('No stored responses to publish — cannot retry Kites push')
  }
  const entries: RMSEntry[] = JSON.parse(pollResponse.response_data)
  const responsesHtml = buildResponsesHtml(entries)
  const para = `<p><strong>Topic:</strong> ${poll.topic}</p><p><strong>Department:</strong> ${poll.department}</p><p><strong>Total responses:</strong> ${entries.length}</p>`

  const kitesResult = await pushPollToKites(poll, { htmlContent: responsesHtml, para })
  if (!kitesResult.success) throw new Error(kitesResult.error ?? 'Kites push failed')

  const newsId = kitesResult.newsId ? String(kitesResult.newsId) : null
  await updatePollStatus(poll.id, 'RMS_PUBLISHED', newsId ? { rms_news_id: newsId } : undefined)
}

// Placeholder for RMS API integration — will be implemented once RMS API docs are received
async function createRMSTask(poll: { id: string; topic: string; department: string }): Promise<string> {
  const rmsBaseUrl = process.env.RMS_API_BASE_URL
  const rmsApiKey = process.env.RMS_API_KEY

  if (!rmsBaseUrl || !rmsApiKey) {
    throw new Error('RMS API not configured')
  }

  const res = await fetch(`${rmsBaseUrl}/tasks`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${rmsApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'New Requirement in Existing Panel',
      reporter: 'Priya Upadhyay',
      category: 'Medium',
      project_name: 'Poll Action Point',
      description: `Poll Creation & RMS Publishing Task\n\nSteps:\n1. Poll creation via Poll Form\n2. Email circulation\n3. Reminder scheduling\n4. RMS publishing on Koenig News panel\n5. Result upload post closure\n\nPanel: Koenig News Panel`,
      estimated_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      metadata: { poll_id: poll.id, topic: poll.topic, department: poll.department },
    }),
  })

  if (!res.ok) throw new Error(`RMS Task creation failed: ${res.status}`)
  const data = await res.json() as { id: string }
  return data.id
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await runMigrations()
  const failedPolls = await getPollsByStatus(['RMS_TASK_FAILED', 'RMS_PUBLISH_FAILED'] as Parameters<typeof getPollsByStatus>[0])
  let retried = 0
  let stillFailing = 0

  for (const poll of failedPolls) {
    const maxRetries = 3
    let attempt = 0
    let success = false

    while (attempt < maxRetries && !success) {
      attempt++
      try {
        if (poll.status === 'RMS_TASK_FAILED') {
          const taskId = await createRMSTask(poll)
          await updatePollStatus(poll.id, 'RMS_TASK_CREATED', { rms_task_id: taskId })
          await createAuditLog(poll.id, 'RMS_TASK_RETRY_SUCCESS', 'cron', { attempt })
          success = true
          retried++
        } else if (poll.status === 'RMS_PUBLISH_FAILED') {
          await retryKitesPublish(poll)
          await createAuditLog(poll.id, 'RMS_PUBLISH_RETRY_SUCCESS', 'cron', { attempt })
          success = true
          retried++
        }
      } catch (err) {
        console.error(`RMS retry attempt ${attempt} failed for poll ${poll.id}:`, err)
        if (attempt === maxRetries) {
          stillFailing++
          await createAuditLog(poll.id, 'RMS_RETRY_EXHAUSTED', 'cron', {
            error: err instanceof Error ? err.message : 'Unknown',
          })
        }
      }
    }
  }

  return NextResponse.json({ retried, stillFailing, total: failedPolls.length })
}
