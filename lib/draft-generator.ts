/**
 * Smart rule-based poll draft generator.
 * Generates topic-aware, keyword-driven email bodies and typed questions.
 */

export interface PollQuestion {
  text: string
  type: 'rating' | 'open_ended'
}

export interface DraftPollContent {
  subject: string
  emailBody: string
  questions: PollQuestion[]
}

// ─── Category detection ───────────────────────────────────────────────────────

type Category =
  | 'satisfaction' | 'engagement' | 'training' | 'feedback'
  | 'policy' | 'wellbeing' | 'remote' | 'onboarding' | 'culture'
  | 'communication' | 'compensation' | 'leadership' | 'event' | 'exit'

const KEYWORD_MAP: Array<{ keywords: string[]; category: Category }> = [
  { keywords: ['satisfaction', 'satisfied', 'happiness', 'happy', 'morale', 'sentiment'], category: 'satisfaction' },
  { keywords: ['engagement', 'engaged', 'motivation', 'motivated', 'connect', 'utilization', 'utilisation'], category: 'engagement' },
  { keywords: ['training', 'learning', 'workshop', 'session', 'course', 'upskill', 'l&d', 'development', 'skill'], category: 'training' },
  { keywords: ['feedback', 'review', 'performance', 'appraisal', 'assessment', 'evaluation'], category: 'feedback' },
  { keywords: ['policy', 'guideline', 'rule', 'procedure', 'compliance', 'regulation', 'process'], category: 'policy' },
  { keywords: ['wellbeing', 'wellness', 'health', 'stress', 'burnout', 'mental', 'work life', 'balance'], category: 'wellbeing' },
  { keywords: ['remote', 'hybrid', 'work from home', 'wfh', 'flexible', 'flexi', 'work model'], category: 'remote' },
  { keywords: ['onboard', 'induction', 'joining', 'new hire', 'orientation', 'buddy'], category: 'onboarding' },
  { keywords: ['culture', 'values', 'diversity', 'inclusion', 'd&i', 'belonging', 'dei'], category: 'culture' },
  { keywords: ['communication', 'collaboration', 'meeting', 'update', 'announcement', 'transparency'], category: 'communication' },
  { keywords: ['compensation', 'salary', 'benefit', 'perk', 'pay', 'incentive', 'bonus', 'appraisal', 'hike'], category: 'compensation' },
  { keywords: ['leadership', 'management', 'manager', 'director', 'head', 'lead', 'reporting'], category: 'leadership' },
  { keywords: ['event', 'offsite', 'outing', 'celebration', 'party', 'townhall', 'town hall', 'annual'], category: 'event' },
  { keywords: ['exit', 'resign', 'leaving', 'attrition', 'turnover', 'farewell', 'separation'], category: 'exit' },
]

function detectCategory(topic: string, keywords?: string): Category | null {
  const combined = `${topic} ${keywords ?? ''}`.toLowerCase()
  for (const { keywords: kws, category } of KEYWORD_MAP) {
    if (kws.some((kw) => combined.includes(kw))) return category
  }
  return null
}

// ─── Category-specific context lines ─────────────────────────────────────────

const CATEGORY_CONTEXT: Record<Category, string> = {
  satisfaction:   'understanding your overall job satisfaction and workplace experience',
  engagement:     'gauging employee engagement and identifying what drives motivation at work',
  training:       'evaluating the effectiveness of our training programs and identifying skill development needs',
  feedback:       'collecting feedback on performance management, communication, and growth opportunities',
  policy:         'understanding employee awareness and comfort with our current policies and procedures',
  wellbeing:      'assessing employee wellbeing and ensuring we are providing adequate support',
  remote:         'evaluating our remote and hybrid work setup and understanding what works best for our teams',
  onboarding:     'improving the onboarding experience for new joiners at Koenig Solutions',
  culture:        'understanding how our workplace culture, values, and inclusion initiatives are being experienced',
  communication:  'improving internal communication, collaboration, and information-sharing practices',
  compensation:   'gathering feedback on compensation, benefits, and recognition at Koenig Solutions',
  leadership:     'assessing leadership effectiveness and management practices across the organisation',
  event:          'collecting feedback on our recent event to help us plan even better experiences in the future',
  exit:           'understanding your experience at Koenig Solutions and gathering insights to improve for others',
}

// ─── Typed question generation ────────────────────────────────────────────────

function buildTypedQuestions(topic: string, keywords: string, category: Category | null): PollQuestion[] {
  const kws = keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : []
  const kwPhrase = kws.length > 0 ? kws.join(' & ') : topic

  // Topic-specific rating question (always relevant)
  const topicRating: PollQuestion = {
    text: `How would you rate your overall experience with "${topic}" at Koenig Solutions? (1 = Very Poor, 5 = Excellent)`,
    type: 'rating',
  }

  // Category-specific question sets
  const categoryQuestions: Record<Category, PollQuestion[]> = {
    satisfaction: [
      { text: `How satisfied are you with how "${kwPhrase}" is being handled at Koenig Solutions? (1 = Very Dissatisfied, 5 = Very Satisfied)`, type: 'rating' },
      { text: `Do you feel your contributions towards "${topic}" are recognised and valued by the organisation?`, type: 'open_ended' },
      { text: `What one change would most improve your satisfaction related to "${kwPhrase}"?`, type: 'open_ended' },
    ],
    engagement: [
      { text: `How engaged and motivated do you feel in the context of "${kwPhrase}"? (1 = Not at All, 5 = Highly Engaged)`, type: 'rating' },
      { text: `What would help you feel more engaged and connected to "${topic}" initiatives?`, type: 'open_ended' },
      { text: `How clearly do you understand how your role contributes to "${topic}" goals?`, type: 'open_ended' },
    ],
    training: [
      { text: `How would you rate the relevance and quality of the training on "${kwPhrase}"? (1 = Very Poor, 5 = Excellent)`, type: 'rating' },
      { text: `Did the training on "${topic}" meet your learning objectives and expectations?`, type: 'open_ended' },
      { text: `What additional topics or skills related to "${kwPhrase}" would you like covered in future sessions?`, type: 'open_ended' },
    ],
    feedback: [
      { text: `How effectively does your manager communicate expectations related to "${kwPhrase}"? (1 = Not Effective, 5 = Very Effective)`, type: 'rating' },
      { text: `Do you feel the current "${topic}" process is fair, transparent, and helpful for your growth?`, type: 'open_ended' },
      { text: `What improvements to the "${kwPhrase}" process would most benefit you?`, type: 'open_ended' },
    ],
    policy: [
      { text: `How clearly have the changes related to "${kwPhrase}" been communicated to you? (1 = Very Unclear, 5 = Very Clear)`, type: 'rating' },
      { text: `Do you have any concerns or suggestions regarding "${topic}" that you would like the HR team to address?`, type: 'open_ended' },
      { text: `How supportive is the "${topic}" policy in helping you perform your role effectively?`, type: 'open_ended' },
    ],
    wellbeing: [
      { text: `How would you rate your current wellbeing and work-life balance in relation to "${kwPhrase}"? (1 = Very Poor, 5 = Excellent)`, type: 'rating' },
      { text: `Do you feel Koenig Solutions provides adequate support for "${topic}"?`, type: 'open_ended' },
      { text: `What initiatives or resources would most help improve "${kwPhrase}" for you?`, type: 'open_ended' },
    ],
    remote: [
      { text: `How productive and effective do you feel working under the current "${kwPhrase}" model? (1 = Not Effective, 5 = Very Effective)`, type: 'rating' },
      { text: `What challenges, if any, are you facing with "${topic}" at Koenig Solutions?`, type: 'open_ended' },
      { text: `What improvements to our "${kwPhrase}" setup would make the biggest positive impact for you?`, type: 'open_ended' },
    ],
    onboarding: [
      { text: `How would you rate your overall "${kwPhrase}" experience at Koenig Solutions? (1 = Very Poor, 5 = Excellent)`, type: 'rating' },
      { text: `What aspects of the "${topic}" process did you find most helpful and what was missing?`, type: 'open_ended' },
      { text: `What one change would have made your "${topic}" experience significantly better?`, type: 'open_ended' },
    ],
    culture: [
      { text: `How would you rate Koenig Solutions on "${kwPhrase}" and creating an inclusive workplace? (1 = Very Poor, 5 = Excellent)`, type: 'rating' },
      { text: `Do you feel comfortable being yourself at work in the context of "${topic}"?`, type: 'open_ended' },
      { text: `What specific actions should Koenig Solutions take to strengthen "${kwPhrase}"?`, type: 'open_ended' },
    ],
    communication: [
      { text: `How satisfied are you with the current level of "${kwPhrase}" at Koenig Solutions? (1 = Very Dissatisfied, 5 = Very Satisfied)`, type: 'rating' },
      { text: `What information or updates related to "${topic}" do you feel are not being communicated effectively?`, type: 'open_ended' },
      { text: `What changes to "${kwPhrase}" practices would most improve your day-to-day work?`, type: 'open_ended' },
    ],
    compensation: [
      { text: `How fairly do you feel your current "${kwPhrase}" reflects your role, skills, and contributions? (1 = Not Fair at All, 5 = Very Fair)`, type: 'rating' },
      { text: `Are there specific aspects of "${topic}" at Koenig Solutions that you feel need to be reviewed or improved?`, type: 'open_ended' },
      { text: `What additional benefits or changes to "${kwPhrase}" would you value most?`, type: 'open_ended' },
    ],
    leadership: [
      { text: `How would you rate the effectiveness of leadership in the context of "${kwPhrase}"? (1 = Very Poor, 5 = Excellent)`, type: 'rating' },
      { text: `Do you feel leadership at Koenig Solutions is approachable and acts on feedback related to "${topic}"?`, type: 'open_ended' },
      { text: `What specific leadership behaviours or actions would help improve "${kwPhrase}" at Koenig Solutions?`, type: 'open_ended' },
    ],
    event: [
      { text: `How would you rate the overall quality and organisation of "${kwPhrase}"? (1 = Very Poor, 5 = Excellent)`, type: 'rating' },
      { text: `What aspects of "${topic}" did you find most valuable and why?`, type: 'open_ended' },
      { text: `What changes or additions would make future events like "${topic}" more impactful for you?`, type: 'open_ended' },
    ],
    exit: [
      { text: `How would you rate your overall experience working at Koenig Solutions? (1 = Very Poor, 5 = Excellent)`, type: 'rating' },
      { text: `What was the primary factor influencing your decision related to "${topic}"?`, type: 'open_ended' },
      { text: `What suggestions do you have for Koenig Solutions to improve the employee experience?`, type: 'open_ended' },
    ],
  }

  const pool = category ? categoryQuestions[category] : [
    { text: `How would you rate the effectiveness of "${kwPhrase}" at Koenig Solutions? (1 = Very Poor, 5 = Excellent)`, type: 'rating' as const },
    { text: `What is working well regarding "${topic}" and what could be improved?`, type: 'open_ended' as const },
    { text: `What suggestions do you have for the HR team related to "${kwPhrase}"?`, type: 'open_ended' as const },
  ]

  return [topicRating, ...pool.slice(0, 2)]
}

// ─── Email body builder ───────────────────────────────────────────────────────

export function generateSubject(topic: string): string {
  return `Poll: ${topic}`
}

function buildEmailBody(
  topic: string,
  department: string,
  deadline: string,
  tone: string,
  keywords: string,
  category: Category | null
): string {
  const audience = department === 'All Departments' ? 'all team members' : `the ${department} team`
  const context = category ? CATEGORY_CONTEXT[category] : `gathering your valuable feedback on "${topic}"`
  const kws = keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : []
  const kwSentence = kws.length > 0
    ? ` We are particularly keen to understand your views on: **${kws.join(', ')}**.`
    : ''

  switch (tone) {
    case 'friendly':
      return `Hi ${audience}! 👋

We would love to hear from you! As part of our ongoing efforts focused on ${context}, we have put together a short poll on "${topic}".${kwSentence}

It will only take 2–3 minutes and every response makes a real difference. Please share your honest thoughts before ${deadline}.

Thanks so much — your feedback truly matters to us!
HR Team, Koenig Solutions`

    case 'formal':
      return `Dear ${audience},

Koenig Solutions HR Department is conducting an official survey with the objective of ${context}. You are requested to participate in the poll on "${topic}".${kwSentence}

Your participation is mandatory to ensure the organisation receives comprehensive insights necessary for evidence-based decision-making. Kindly ensure your response is submitted no later than ${deadline}.

All responses are strictly confidential and will be used solely for organisational improvement purposes.

Yours sincerely,
Human Resources Department, Koenig Solutions`

    case 'urgent':
      return `Dear ${audience},

⚡ Action Required — Please respond by ${deadline}.

We are conducting a time-sensitive poll on "${topic}" aimed at ${context}.${kwSentence} Your input is critical and we need responses from all team members urgently.

The poll takes less than 2 minutes. Please do not delay — responses received after ${deadline} may not be considered in our analysis.

HR Team, Koenig Solutions`

    default: // professional
      return `Dear ${audience},

As part of our commitment to ${context}, we are conducting a short poll on "${topic}".${kwSentence}

Your honest feedback is invaluable and will directly inform decisions that benefit the entire team at Koenig Solutions. Please take 2–3 minutes to share your thoughts before ${deadline}.

We appreciate your time and participation.

Regards,
HR Team, Koenig Solutions`
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
  const subject = generateSubject(topic)
  const category = detectCategory(topic, keywords)
  const emailBody = buildEmailBody(topic, department, deadlineDate, tone, keywords ?? '', category)

  if (providedQuestions && providedQuestions.length > 0) {
    const questions: PollQuestion[] = providedQuestions.slice(0, 4).map((q) => ({
      text: q,
      type: /rate|rating|scale|satisfied|satisfaction|recommend|\(1\s*[=-]/i.test(q) ? 'rating' : 'open_ended',
    }))
    return { subject, emailBody, questions }
  }

  const questions = buildTypedQuestions(topic, keywords ?? '', category)
  return { subject, emailBody, questions }
}
