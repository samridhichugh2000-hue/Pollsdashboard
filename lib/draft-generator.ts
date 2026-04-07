/**
 * Rule-based poll draft generator — no external AI API required.
 * Generates professional email bodies and contextually relevant questions
 * by matching topic keywords to curated HR question banks.
 */

export interface DraftPollContent {
  emailBody: string
  questions: string[]
  subject: string
}

// ─── Question bank keyed by topic category ────────────────────────────────────

const QUESTION_BANK: Record<string, string[]> = {
  satisfaction: [
    'How satisfied are you with your current role and responsibilities? (1 = Very Dissatisfied, 5 = Very Satisfied)',
    'Do you feel your contributions are recognized and valued by the organization?',
    'How would you rate the overall work culture at Koenig Solutions?',
    'Would you recommend Koenig Solutions as a great place to work to others?',
  ],
  engagement: [
    'How engaged do you feel in your day-to-day work activities?',
    'Do you feel motivated to go above and beyond your core responsibilities?',
    'How clearly do you understand how your work contributes to the company\'s goals?',
    'Do you feel you have the tools and resources needed to perform your best?',
  ],
  training: [
    'How relevant was the training content to your current role?',
    'How would you rate the quality and delivery of the training session?',
    'Did the training meet your learning expectations and objectives?',
    'What additional topics would you like covered in future training programs?',
  ],
  feedback: [
    'How effectively does your manager communicate expectations and feedback?',
    'Do you receive constructive feedback that helps you grow professionally?',
    'How comfortable are you sharing ideas or concerns with your team?',
    'Do you feel the performance review process is fair and transparent?',
  ],
  policy: [
    'How aware are you of the new policy and its implications for your work?',
    'Do you feel the policy changes have been clearly communicated to the team?',
    'How supportive is the new policy in helping you perform your role effectively?',
    'Do you have any concerns or suggestions regarding the updated policy?',
  ],
  wellbeing: [
    'How would you rate your current work-life balance?',
    'Do you feel the organization genuinely cares about your wellbeing?',
    'Are you comfortable taking time off when needed without feeling guilty?',
    'Do you feel you have adequate support for mental and physical health at work?',
  ],
  remote: [
    'How productive do you feel while working remotely or in a hybrid setup?',
    'Do you have a suitable work environment and setup at home?',
    'How effectively does your team collaborate in a remote/hybrid model?',
    'What improvements would make the remote working experience better for you?',
  ],
  onboarding: [
    'How smooth and organized was your onboarding experience?',
    'Did you receive adequate guidance and support during your first few weeks?',
    'How clearly were company processes, tools, and culture explained to you?',
    'What aspects of the onboarding could be improved for future joiners?',
  ],
  culture: [
    'How inclusive and diverse do you feel the workplace culture is at Koenig Solutions?',
    'Do you feel comfortable being your authentic self at work?',
    'How well does leadership demonstrate the company\'s core values?',
    'Are there specific cultural aspects you would like the organization to strengthen?',
  ],
  communication: [
    'How satisfied are you with the internal communication across teams and departments?',
    'Do you feel leadership keeps the team well-informed about important decisions?',
    'Are meeting cadences and formats effective for your team\'s collaboration?',
    'What communication channels or practices would improve team productivity?',
  ],
  compensation: [
    'Do you feel your current compensation is fair relative to your role and experience?',
    'Are the benefits offered by Koenig Solutions meeting your professional needs?',
    'How transparent do you find the compensation and appraisal process?',
    'What additional benefits or perks would you value most?',
  ],
  leadership: [
    'How would you rate the leadership effectiveness at Koenig Solutions?',
    'Do you feel leadership is approachable and open to employee suggestions?',
    'Does leadership provide a clear direction and vision for the team?',
    'How confident are you in the decisions made by senior leadership?',
  ],
  event: [
    'How would you rate the overall organization and execution of the event?',
    'Did the event meet your expectations in terms of content and engagement?',
    'What aspects of the event did you find most valuable?',
    'What improvements would you suggest for future events?',
  ],
  exit: [
    'What was the primary reason for your decision to leave Koenig Solutions?',
    'How would you rate your overall experience working at Koenig Solutions?',
    'Would you consider returning to Koenig Solutions in the future?',
    'What suggestions do you have for improving the employee experience?',
  ],
}

const GENERIC_QUESTIONS: string[] = [
  'How would you rate your overall experience with the subject of this poll?',
  'Do you feel the current approach effectively meets your professional needs?',
  'What improvements or changes would you suggest based on your experience?',
]

// ─── Topic → category matcher ──────────────────────────────────────────────────

type QuestionCategory = keyof typeof QUESTION_BANK

const KEYWORD_MAP: Array<{ keywords: string[]; category: QuestionCategory }> = [
  { keywords: ['satisfaction', 'satisfied', 'happiness', 'happy', 'morale'], category: 'satisfaction' },
  { keywords: ['engagement', 'engaged', 'motivation', 'motivated', 'connect'], category: 'engagement' },
  { keywords: ['training', 'learning', 'workshop', 'session', 'course', 'upskill', 'l&d'], category: 'training' },
  { keywords: ['feedback', 'review', 'performance', 'appraisal', 'assessment'], category: 'feedback' },
  { keywords: ['policy', 'guideline', 'rule', 'procedure', 'compliance', 'regulation'], category: 'policy' },
  { keywords: ['wellbeing', 'wellness', 'health', 'stress', 'burnout', 'mental'], category: 'wellbeing' },
  { keywords: ['remote', 'hybrid', 'work from home', 'wfh', 'flexible', 'flexi'], category: 'remote' },
  { keywords: ['onboard', 'induction', 'joining', 'new hire', 'orientation'], category: 'onboarding' },
  { keywords: ['culture', 'values', 'diversity', 'inclusion', 'd&i', 'belonging'], category: 'culture' },
  { keywords: ['communication', 'collaboration', 'meeting', 'update', 'announcement'], category: 'communication' },
  { keywords: ['compensation', 'salary', 'benefit', 'perk', 'pay', 'incentive', 'bonus'], category: 'compensation' },
  { keywords: ['leadership', 'management', 'manager', 'director', 'head', 'lead'], category: 'leadership' },
  { keywords: ['event', 'offsite', 'outing', 'celebration', 'party', 'townhall', 'town hall'], category: 'event' },
  { keywords: ['exit', 'resign', 'leaving', 'attrition', 'turnover', 'farewell'], category: 'exit' },
]

function detectCategory(topic: string, keywords?: string): QuestionCategory | null {
  const lower = topic.toLowerCase()
  for (const { keywords: kws, category } of KEYWORD_MAP) {
    if (kws.some((kw) => lower.includes(kw))) {
      return category
    }
  }

  // Also check provided keywords
  if (keywords) {
    const kwLower = keywords.toLowerCase()
    for (const { keywords: kws, category } of KEYWORD_MAP) {
      if (kws.some((kw) => kwLower.includes(kw))) {
        return category
      }
    }
  }

  return null
}

// ─── Subject generation ───────────────────────────────────────────────────────

export function generateSubject(topic: string): string {
  return `Poll: ${topic}`
}

// ─── Email body templates ─────────────────────────────────────────────────────

function keywordsLine(keywords?: string): string {
  if (!keywords?.trim()) return ''
  const kws = keywords.split(',').map(k => k.trim()).filter(Boolean)
  if (kws.length === 0) return ''
  return ` We are particularly interested in your thoughts around: ${kws.join(', ')}.`
}

function buildEmailBodyProfessional(topic: string, department: string, deadlineDate: string, keywords?: string): string {
  const audience = department === 'All Departments' ? 'all team members' : `the ${department} team`

  return `Dear ${audience},

We invite you to participate in a brief poll on "${topic}".${keywordsLine(keywords)} Your honest feedback is valuable and will help us make informed decisions that benefit the entire team.

Please take a few minutes to share your thoughts before ${deadlineDate}. The poll takes less than 2 minutes to complete.

Regards,
HR Team, Koenig Solutions`
}

function buildEmailBodyFriendly(topic: string, department: string, deadlineDate: string, keywords?: string): string {
  const audience = department === 'All Departments' ? 'everyone' : `the ${department} team`
  const kwNote = keywords?.trim() ? ` — especially around ${keywords.split(',').map(k => k.trim()).filter(Boolean).join(', ')}` : ''

  return `Hi ${audience}! 👋

We'd love to hear from you! We're running a quick poll on "${topic}"${kwNote} and your thoughts mean a lot to us.

It'll only take a couple of minutes — please share your honest feedback before ${deadlineDate}. Every response helps us make things better for the whole team!

Thanks a bunch,
HR Team, Koenig Solutions`
}

function buildEmailBodyFormal(topic: string, department: string, deadlineDate: string, keywords?: string): string {
  const audience = department === 'All Departments' ? 'all members of staff' : `members of the ${department} department`
  const kwNote = keywords?.trim() ? ` The survey specifically covers the following areas: ${keywords.split(',').map(k => k.trim()).filter(Boolean).join(', ')}.` : ''

  return `Dear ${audience},

Koenig Solutions HR Department hereby invites you to participate in an official survey pertaining to "${topic}".${kwNote}

Your participation is essential to enable the organisation to gather comprehensive insights and make evidence-based decisions. Please ensure your response is submitted no later than ${deadlineDate}.

This survey is strictly confidential and your responses will be handled in accordance with company policy.

Yours sincerely,
Human Resources Department
Koenig Solutions`
}

function buildEmailBodyUrgent(topic: string, department: string, deadlineDate: string, keywords?: string): string {
  const audience = department === 'All Departments' ? 'all team members' : `the ${department} team`
  const kwNote = keywords?.trim() ? ` Key focus areas: ${keywords.split(',').map(k => k.trim()).filter(Boolean).join(', ')}.` : ''

  return `Dear ${audience},

⚡ Action Required: Your response is needed urgently.

We are conducting a time-sensitive poll on "${topic}" and require your input before ${deadlineDate}.${kwNote} Please prioritise completing this poll as your feedback is critical to our decision-making process.

The poll takes less than 2 minutes. Do not delay — responses submitted after the deadline cannot be accepted.

HR Team, Koenig Solutions`
}

function buildEmailBody(topic: string, department: string, deadlineDate: string, tone: string = 'professional', keywords?: string): string {
  switch (tone) {
    case 'friendly': return buildEmailBodyFriendly(topic, department, deadlineDate, keywords)
    case 'formal': return buildEmailBodyFormal(topic, department, deadlineDate, keywords)
    case 'urgent': return buildEmailBodyUrgent(topic, department, deadlineDate, keywords)
    default: return buildEmailBodyProfessional(topic, department, deadlineDate, keywords)
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function generatePollDraft(
  topic: string,
  department: string,
  _requestedBy: string,
  deadlineDate: string,
  providedQuestions?: string[],
  keywords?: string,
  tone: 'professional' | 'friendly' | 'formal' | 'urgent' = 'professional'
): DraftPollContent {
  const emailBody = buildEmailBody(topic, department, deadlineDate, tone, keywords)
  const subject = generateSubject(topic)

  if (providedQuestions && providedQuestions.length > 0) {
    // Requester provided questions — use them as-is, never modify
    return { emailBody, questions: providedQuestions.slice(0, 4), subject }
  }

  // Auto-generate questions based on topic (and optional keywords)
  const category = detectCategory(topic, keywords)
  const pool = category ? QUESTION_BANK[category] : GENERIC_QUESTIONS

  // Pick 3 most relevant questions (first 3 from the matched pool)
  const questions = pool.slice(0, 3)

  return { emailBody, questions, subject }
}
