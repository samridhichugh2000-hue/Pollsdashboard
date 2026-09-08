import { NextResponse } from 'next/server'
import { getPollsByStatus, updatePollStatus, createAuditLog, getPollResponse } from '@/lib/db/queries'
import { runMigrations } from '@/lib/db/schema'
import { autoPublishResultsToRms } from '@/lib/kites-api'
import type { Poll } from '@/types'

interface RMSEntry {
  respondent?: string
  email?: string
  submitted_at: string
  answers: { question: string; answer: string }[]
  actionable?: boolean | null
  classification?: string | null
  status?: string | null
  remarks?: string
  reply_sent_at?: string
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

// Runs autoPublishResultsToRms (push + upload) for one poll and reflects the
// outcome in status/audit log — the same best-effort chain that used to run
// inline inside poll-closure, moved here so a slow RMS push (observed taking
// 60–90s+ for polls with many responses) can never delay or starve the actual
// closing step, which needs to stay fast and run every poll every night.
async function publishOne(poll: Poll): Promise<'uploaded' | 'pushed' | 'failed'> {
  const pollResponse = await getPollResponse(poll.id)
  const entries: RMSEntry[] = pollResponse?.response_data ? JSON.parse(pollResponse.response_data) : []
  if (entries.length === 0) {
    await createAuditLog(poll.id, 'RMS_PUSH_FAILED', 'cron', { error: 'No responses to publish' })
    return 'failed'
  }

  const result = await autoPublishResultsToRms(poll, entries)
  if (result.uploaded && result.newsId) {
    await updatePollStatus(poll.id, 'RESULTS_UPLOADED', { rms_news_id: result.newsId, results_uploaded_at: new Date().toISOString() })
    await createAuditLog(poll.id, 'RESULTS_UPLOADED', 'cron', { newsId: result.newsId, via: 'auto' })
    return 'uploaded'
  }
  if (result.pushed && result.newsId) {
    await updatePollStatus(poll.id, 'RMS_PUBLISHED', { rms_news_id: result.newsId })
    await createAuditLog(poll.id, 'PUSHED_TO_RMS', 'cron', { newsId: result.newsId, via: 'auto' })
    await createAuditLog(poll.id, 'RESULTS_UPLOAD_FAILED', 'cron', { error: result.error, step: result.step })
    return 'pushed'
  }
  await createAuditLog(poll.id, 'RMS_PUSH_FAILED', 'cron', { error: result.error, step: result.step })
  return 'failed'
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await runMigrations()

  // Previously-failed RMS Task creations still get their own bounded retry —
  // unrelated to the Kites publish path below.
  const failedTaskPolls = await getPollsByStatus(['RMS_TASK_FAILED'] as Parameters<typeof getPollsByStatus>[0])
  let retried = 0
  let stillFailing = 0

  for (const poll of failedTaskPolls) {
    const maxRetries = 3
    let attempt = 0
    let success = false
    while (attempt < maxRetries && !success) {
      attempt++
      try {
        const taskId = await createRMSTask(poll)
        await updatePollStatus(poll.id, 'RMS_TASK_CREATED', { rms_task_id: taskId })
        await createAuditLog(poll.id, 'RMS_TASK_RETRY_SUCCESS', 'cron', { attempt })
        success = true
        retried++
      } catch (err) {
        console.error(`RMS task retry attempt ${attempt} failed for poll ${poll.id}:`, err)
        if (attempt === maxRetries) {
          stillFailing++
          await createAuditLog(poll.id, 'RMS_RETRY_EXHAUSTED', 'cron', {
            error: err instanceof Error ? err.message : 'Unknown',
          })
        }
      }
    }
  }

  // Kites publish: covers both "never attempted" (RESULTS_SHARED/CLOSED with
  // no rms_news_id yet) and previously-failed pushes/uploads — one pass, same
  // best-effort autoPublishResultsToRms chain for all of them.
  const candidateStatuses = ['RESULTS_SHARED', 'CLOSED', 'RMS_PUBLISH_FAILED'] as Parameters<typeof getPollsByStatus>[0]
  const candidates = await getPollsByStatus(candidateStatuses)
  const toPublish = candidates.filter(p => !p.rms_news_id || p.status === 'RMS_PUBLISH_FAILED')

  let uploaded = 0
  let pushed = 0
  let failed = 0
  for (const poll of toPublish) {
    try {
      const outcome = await publishOne(poll)
      if (outcome === 'uploaded') uploaded++
      else if (outcome === 'pushed') pushed++
      else failed++
    } catch (err) {
      failed++
      console.error(`RMS publish failed for poll ${poll.id}:`, err)
      try {
        await createAuditLog(poll.id, 'RMS_PUSH_FAILED', 'cron', { error: err instanceof Error ? err.message : String(err) })
      } catch { /* logging the failure must never itself break the loop */ }
    }
  }

  return NextResponse.json({
    rmsTaskRetried: retried,
    rmsTaskStillFailing: stillFailing,
    kitesUploaded: uploaded,
    kitesPushedOnly: pushed,
    kitesFailed: failed,
    kitesCandidates: toPublish.length,
  })
}
