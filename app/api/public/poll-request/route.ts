import { NextRequest, NextResponse } from 'next/server'
import { createPoll, updatePoll } from '@/lib/db/queries'
import { generatePollDraft } from '@/lib/draft-generator'
import { formatDate } from '@/lib/utils'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      requester_name: string
      requester_email: string
      topic: string
      department: string
      questions?: string[]
      context?: string
      single_response?: boolean
    }

    const { requester_name, requester_email, topic, department } = body

    if (!requester_name?.trim() || !requester_email?.trim() || !topic?.trim() || !department?.trim()) {
      return NextResponse.json({ error: 'Name, email, topic and department are required.' }, { status: 400 })
    }

    const deadline = formatDate(new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString())

    const poll = await createPoll({
      topic: topic.trim(),
      department: department.trim(),
      requested_by: `${requester_name.trim()} <${requester_email.trim()}>`,
      source: 'external',
      questions: body.questions?.filter(q => q.trim()) ?? [],
      remarks: body.context?.trim() || undefined,
      single_response: body.single_response !== false,
    })

    const draft = generatePollDraft(
      poll.topic,
      poll.department,
      requester_name,
      deadline,
      body.questions?.filter(q => q.trim())
    )

    await updatePoll(poll.id, {
      draft_email_body: draft.emailBody,
      questions: JSON.stringify(draft.questions),
      status: 'DRAFT',
    })

    return NextResponse.json({ success: true, id: poll.id }, { status: 201 })
  } catch (err) {
    console.error('Public poll request error:', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
