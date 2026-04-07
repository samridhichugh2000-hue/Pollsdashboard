import { NextResponse } from 'next/server'
import { getPollsByStatus, updatePollStatus, createAuditLog } from '@/lib/db/queries'

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
      description: `Poll Creation & RMS Publishing Task\n\nSteps:\n1. Poll creation via MS Forms\n2. Email circulation\n3. Reminder scheduling\n4. RMS publishing on Koenig News panel\n5. Result upload post closure\n\nPanel: Koenig News Panel`,
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
