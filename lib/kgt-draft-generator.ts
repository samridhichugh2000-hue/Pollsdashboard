/**
 * Default template generator for KGT (knowledge/ownership transfer) requests.
 * Unlike regular polls, KGT wording is fixed by HR — no category detection,
 * just the topic dropped into the standard template.
 */

export interface KGTQuestion {
  text: string
  type: 'yes_no' | 'open_ended'
}

export interface DraftKGTContent {
  subject: string
  emailBody: string
  questions: KGTQuestion[]
}

export function generateKGTSubject(topic: string): string {
  return `KGT Opportunity – ${topic}`
}

export function generateDefaultKGTDraft(topic: string, issueDetails?: string): DraftKGTContent {
  const subject = generateKGTSubject(topic)

  const emailBody = `Dear Team,

We are inviting expressions of interest for the KGT opportunity to take ownership of ${topic}.

Issue Summary:
${issueDetails ?? '[Describe the current issue]'}

Actions Taken:
1. [List actions already taken]
2. [List actions already taken]

Purpose of KGT:
The selected individual will take ownership of this initiative by understanding the existing issues, the troubleshooting performed, and the remaining activities. The objective is to ensure successful implementation, smooth future operations, and ongoing support for ${topic}.

If you are interested in taking up this KGT opportunity, please complete the poll.

Regards,
Team HR`

  const questions: KGTQuestion[] = [
    { text: `Are you interested in taking ownership of the ${topic} KGT?`, type: 'yes_no' },
    { text: `Do you have any prior experience or knowledge with ${topic}?`, type: 'yes_no' },
    { text: 'If Yes, please provide brief details.', type: 'open_ended' },
  ]

  return { subject, emailBody, questions }
}
