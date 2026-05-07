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

// ─── Category-specific email content ─────────────────────────────────────────

const CATEGORY_OPENERS: Record<Category, (topic: string) => string> = {
  satisfaction:  (t) => `We are conducting a quick poll to gather your feedback on "${t}" and understand your overall satisfaction and experience.`,
  engagement:    (t) => `We would like to understand your current engagement levels and motivation in the context of "${t}" at Koenig Solutions.`,
  training:      (t) => `We are assessing the effectiveness of "${t}" and would like to gather your honest feedback to help improve future sessions.`,
  feedback:      (t) => `We are conducting a poll to gather your inputs on "${t}" and evaluate current processes and practices at Koenig Solutions.`,
  policy:        (t) => `We are conducting a quick poll to understand your awareness, experience, and comfort with "${t}".`,
  wellbeing:     (t) => `As part of our ongoing efforts to support employee wellbeing, we would like to gather your feedback on "${t}".`,
  remote:        (t) => `We are assessing your experience with "${t}" to understand what is working well and where improvements can be made.`,
  onboarding:    (t) => `We would like to gather your feedback on the "${t}" experience to help us improve the process for future joiners.`,
  culture:       (t) => `We would like to understand your experience of "${t}" at Koenig Solutions and gather your honest feedback.`,
  communication: (t) => `We are conducting a poll to assess the effectiveness of "${t}" and understand where we can do better.`,
  compensation:  (t) => `We are conducting a quick poll to gather your feedback on "${t}" and ensure it aligns with your expectations.`,
  leadership:    (t) => `We would like to gather your feedback on "${t}" and understand how leadership can better support you.`,
  event:         (t) => `We are gathering your feedback on "${t}" to understand what worked well and how we can improve future experiences.`,
  exit:          (t) => `As part of our continuous improvement efforts, we would like to gather your honest feedback on your experience related to "${t}".`,
}

const CATEGORY_VALUE: Record<Category, string> = {
  satisfaction:  'Your inputs will help us identify areas for improvement and enhance the overall experience at Koenig Solutions.',
  engagement:    'Your honest responses will directly support our efforts to create a more engaging and fulfilling workplace.',
  training:      'Your inputs will directly help us enhance training quality and ensure better learning outcomes.',
  feedback:      'Your responses will contribute to improving our processes and overall organisational effectiveness.',
  policy:        'Your inputs will directly support evidence-based improvements to our policies and procedures.',
  wellbeing:     'Your responses will help us provide better support and improve the overall work experience at Koenig Solutions.',
  remote:        'Your inputs will directly support decision-making on our work model and flexible arrangements.',
  onboarding:    'Your honest responses will directly contribute to enhancing the onboarding journey at Koenig Solutions.',
  culture:       'Your inputs will help us strengthen our culture, diversity, and inclusion efforts across the organisation.',
  communication: 'Your feedback will directly contribute to improving information sharing and collaboration across teams.',
  compensation:  'Your inputs will directly support decisions on compensation, benefits, and recognition at Koenig Solutions.',
  leadership:    'Your honest inputs will help us strengthen leadership effectiveness and management practices across the organisation.',
  event:         'Your inputs will directly help us plan more impactful and engaging events going forward.',
  exit:          'Your inputs will contribute to improving the overall employee experience at Koenig Solutions.',
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

export function generateSubject(topic: string, department?: string): string {
  if (!department || department === 'All Departments') {
    return `Poll – ${topic}`
  }
  return `Poll of ${department} – ${topic}`
}

function buildEmailBody(
  topic: string,
  department: string,
  deadline: string,
  tone: string,
  keywords: string,
  category: Category | null
): string {
  const audience = department === 'All Departments' ? 'Team' : `${department} Team`
  const kws = keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : []
  const kwSentence = kws.length > 0
    ? ` In particular, we would like to understand your views on: ${kws.join(', ')}.`
    : ''

  const opener = category
    ? CATEGORY_OPENERS[category](topic)
    : `We are conducting a quick poll to gather your inputs on "${topic}".`
  const value = category
    ? CATEGORY_VALUE[category]
    : 'Your honest responses will directly support decision-making and help us implement meaningful improvements.'

  let actionLine: string
  switch (tone) {
    case 'friendly':
      actionLine = `Please take a moment to share your feedback via the below poll by ${deadline}.`
      break
    case 'formal':
      actionLine = `You are requested to submit your response via the below poll by ${deadline}.`
      break
    case 'urgent':
      actionLine = `This is time-sensitive — request you to share your inputs via the below poll by ${deadline} without delay.`
      break
    default:
      actionLine = `Request you to share your inputs via the below poll by ${deadline}.`
  }

  return `Dear ${audience},

${opener}${kwSentence}

${actionLine}

${value}

Warm Regards,
Team HR
Poll Dashboard`
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
  const subject = generateSubject(topic, department)
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
