'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2, ClipboardList, ChevronDown, X, Plus, Paperclip } from 'lucide-react'
import { QuestionBuilder, parseQuestions } from '@/components/polls/question-builder'
import type { Question } from '@/components/polls/question-builder'

interface HuntGroup { id: string; name: string; email: string }
interface Sender { id: string; name: string; email: string }

const TIMELINE_STEPS = [
  { label: 'You submit this form', desc: 'HR receives your request instantly' },
  { label: 'HR reviews & drafts', desc: 'Email body and questions are prepared' },
  { label: 'Your approval', desc: 'You receive a draft to approve or edit' },
  { label: 'Poll goes live', desc: 'Sent to your selected audience' },
  { label: 'Results shared', desc: 'Responses collected and sent to you' },
]

const ALLOWED_DOMAIN = 'koenig-solutions.com'
const MAX_FILES = 5
const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB

function parseEmails(text: string): string[] {
  return text.split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(e => e.includes('@'))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function PublicRequestPage() {
  const [huntGroups, setHuntGroups] = useState<HuntGroup[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [knownEmails, setKnownEmails] = useState<{ email: string; label: string }[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showTimeline, setShowTimeline] = useState(false)
  const [questions, setQuestions] = useState<Question[]>(parseQuestions(''))

  // Audience state
  const [audienceGroupId, setAudienceGroupId] = useState('')
  const [individualEmails, setIndividualEmails] = useState<string[]>([])
  const [emailInput, setEmailInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const emailInputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

  // Attachments
  const [attachments, setAttachments] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Deadline (default: 48 hrs = today + 2 days)
  const defaultDeadline = (() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().split('T')[0] })()
  const [deadline, setDeadline] = useState(defaultDeadline)

  // Frequency
  const [isFrequent, setIsFrequent] = useState(false)
  const [frequency, setFrequency] = useState<'monthly' | 'quarterly'>('monthly')
  const [frequencyStartDate, setFrequencyStartDate] = useState('')

  const [form, setForm] = useState({
    requester_name: '',
    requester_email: '',
    custom_email: '',
    topic: '',
    context: '',
  })

  useEffect(() => {
    Promise.all([
      fetch('/api/hunt-groups').then(r => r.ok ? r.json() : []),
      fetch('/api/senders').then(r => r.ok ? r.json() : []),
    ]).then(([groups, snds]: [HuntGroup[], Sender[]]) => {
      setHuntGroups(groups)
      setSenders(snds)
      const known = [
        ...groups.map(g => ({ email: g.email, label: g.name })),
        ...snds.map(s => ({ email: s.email, label: s.name })),
      ]
      const seen = new Set<string>()
      setKnownEmails(known.filter(k => { const key = k.email.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true }))
    }).catch(() => {})
  }, [])

  // Click-outside to close suggestions
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
        emailInputRef.current && !emailInputRef.current.contains(e.target as Node)
      ) setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const set = (field: string, value: string) => setForm(p => ({ ...p, [field]: value } as typeof p))

  const addIndividualEmail = (email: string) => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) return
    if (!individualEmails.some(e => e === trimmed)) {
      setIndividualEmails(prev => [...prev, trimmed])
    }
    setEmailInput('')
    setShowSuggestions(false)
  }

  const removeIndividualEmail = (email: string) => {
    setIndividualEmails(prev => prev.filter(e => e !== email))
  }

  const handleEmailKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const suggestions = knownEmails.filter(k =>
        k.email.toLowerCase().includes(emailInput.toLowerCase()) &&
        !individualEmails.includes(k.email.toLowerCase())
      )
      if (suggestions.length > 0 && emailInput) addIndividualEmail(suggestions[0].email)
      else addIndividualEmail(emailInput)
    }
    if (e.key === 'Backspace' && !emailInput && individualEmails.length > 0) {
      setIndividualEmails(prev => prev.slice(0, -1))
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? [])
    const combined = [...attachments, ...selected]
    const tooBig = selected.filter(f => f.size > MAX_FILE_BYTES)
    if (tooBig.length) {
      setError(`File(s) exceed 5 MB limit: ${tooBig.map(f => f.name).join(', ')}`)
      e.target.value = ''
      return
    }
    if (combined.length > MAX_FILES) {
      setError(`You can attach up to ${MAX_FILES} files.`)
      e.target.value = ''
      return
    }
    setError('')
    setAttachments(combined)
    e.target.value = ''
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  // Derive final audience emails for submit
  const getAudienceEmails = (): string[] => {
    if (audienceGroupId === '__other__') return individualEmails
    if (audienceGroupId) {
      const g = huntGroups.find(g => g.id === audienceGroupId)
      return g ? [g.email] : []
    }
    return []
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const email = form.requester_email === '__other__' ? form.custom_email.trim() : form.requester_email
    if (!email) { setError('Please select or enter your email.'); return }

    const audienceEmails = getAudienceEmails()
    if (!audienceEmails.length) { setError('Please select a target audience or add at least one email.'); return }

    if (isFrequent && !frequencyStartDate) {
      setError('Please select a start date for the recurring poll.')
      return
    }

    const groupByEmail = new Map(huntGroups.map(g => [g.email.toLowerCase(), g.name]))
    const labels = audienceEmails.map(e => groupByEmail.get(e.toLowerCase()) ?? e)
    const department = labels.join(', ')

    const questionTexts = questions.filter(q => q.text.trim()).map(q => q.text)

    // Convert attachments to base64
    let attachmentData: { name: string; contentType: string; contentBytes: string }[] = []
    if (attachments.length > 0) {
      try {
        attachmentData = await Promise.all(
          attachments.map(async (f) => ({
            name: f.name,
            contentType: f.type || 'application/octet-stream',
            contentBytes: await fileToBase64(f),
          }))
        )
      } catch {
        setError('Failed to process attachments. Please try again.')
        return
      }
    }

    setLoading(true)
    try {
      const res = await fetch('/api/public/poll-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_name: form.requester_name,
          requester_email: email,
          topic: form.topic,
          department,
          questions: questionTexts,
          context: form.context,
          deadline,
          audience_emails: audienceEmails,
          single_response: true,
          attachments: attachmentData,
          is_frequent: isFrequent,
          frequency: isFrequent ? frequency : undefined,
          frequency_start_date: isFrequent ? frequencyStartDate : undefined,
        }),
      })
      if (!res.ok) { const d = await res.json() as { error: string }; throw new Error(d.error) }
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setSubmitted(false)
    setForm({ requester_name: '', requester_email: '', custom_email: '', topic: '', context: '' })
    setAudienceGroupId('')
    setIndividualEmails([])
    setEmailInput('')
    setQuestions(parseQuestions(''))
    setAttachments([])
    setDeadline(defaultDeadline)
    setIsFrequent(false)
    setFrequency('monthly')
    setFrequencyStartDate('')
  }

  const emailSuggestions = emailInput.length >= 2
    ? knownEmails.filter(k =>
        k.email.toLowerCase().includes(emailInput.toLowerCase()) &&
        !individualEmails.includes(k.email.toLowerCase())
      ).slice(0, 5)
    : []

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4"
        style={{ background: 'linear-gradient(135deg, #0e7490 0%, #0c6478 50%, #0a5568 100%)' }}>
        <div className="w-full max-w-md rounded-3xl bg-white px-8 py-10 shadow-2xl text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Request Submitted!</h2>
          <p className="mt-3 text-sm text-gray-500 leading-relaxed">
            Your poll request has been received by the HR team at Koenig Solutions. You will be contacted for approval before the poll goes live.
          </p>
          <div className="mt-6 rounded-xl bg-gray-50 px-4 py-4 text-left">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">What happens next</p>
            <ol className="space-y-2">
              {TIMELINE_STEPS.slice(1).map((step, i) => (
                <li key={i} className="flex items-center gap-2.5 text-xs text-gray-600">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-cyan-100 text-cyan-700 font-bold">{i + 2}</span>
                  <span><span className="font-medium text-gray-800">{step.label}</span> — {step.desc}</span>
                </li>
              ))}
            </ol>
          </div>
          <button onClick={resetForm}
            className="mt-6 w-full rounded-xl bg-cyan-600 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700 transition-colors">
            Submit Another Request
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-10"
      style={{ background: 'linear-gradient(135deg, #0e7490 0%, #0c6478 50%, #0a5568 100%)' }}>
      <div className="mx-auto w-full max-w-lg">

        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <ClipboardList className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Request a Poll</h1>
          <p className="mt-1.5 text-sm text-white/60">Submit a poll request to the Koenig Solutions HR team</p>
        </div>

        {/* Collapsible Timeline */}
        <button type="button" onClick={() => setShowTimeline(p => !p)}
          className="mb-4 flex w-full items-center justify-between rounded-2xl bg-white/10 px-5 py-3 text-left backdrop-blur-sm hover:bg-white/15 transition-colors">
          <span className="text-sm font-semibold text-white">How does this work?</span>
          <ChevronDown className={`h-4 w-4 text-white/70 transition-transform ${showTimeline ? 'rotate-180' : ''}`} />
        </button>

        {showTimeline && (
          <div className="mb-4 rounded-2xl bg-white/10 backdrop-blur-sm px-5 py-4">
            <ol className="space-y-3">
              {TIMELINE_STEPS.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/30 text-xs font-bold text-white">{i + 1}</div>
                    {i < TIMELINE_STEPS.length - 1 && <div className="mt-1 h-4 w-px bg-white/20" />}
                  </div>
                  <div className="pb-1">
                    <p className="text-sm font-semibold text-white">{step.label}</p>
                    <p className="text-xs text-white/60">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Form card */}
        <div className="rounded-3xl bg-white shadow-2xl px-7 py-7">
          <form onSubmit={handleSubmit} className="space-y-5">

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
            )}

            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Your Name *</label>
              <input type="text" placeholder="Full name" value={form.requester_name}
                onChange={e => set('requester_name', e.target.value)} required
                className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition" />
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Your Email *</label>
              <select value={form.requester_email} onChange={e => set('requester_email', e.target.value)} required
                className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition bg-white">
                <option value="">Select your email...</option>
                {senders.map(s => (
                  <option key={s.id} value={s.email}>{s.name} — {s.email}</option>
                ))}
                <option value="__other__">Other (enter manually)</option>
              </select>
              {form.requester_email === '__other__' && (
                <input type="email" placeholder={`your@${ALLOWED_DOMAIN}`} value={form.custom_email}
                  onChange={e => set('custom_email', e.target.value)} required
                  className="mt-2 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition" />
              )}
            </div>

            {/* Topic */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Poll Topic / Subject *</label>
              <input type="text" placeholder="e.g. Employee satisfaction survey Q2 2026"
                value={form.topic} onChange={e => set('topic', e.target.value)} required
                className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition" />
            </div>

            {/* Deadline */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Response Deadline
                {deadline === defaultDeadline && (
                  <span className="ml-2 font-normal normal-case text-gray-400">(48 hrs default)</span>
                )}
              </label>
              <input
                type="date"
                value={deadline}
                min={new Date().toISOString().split('T')[0]}
                onChange={e => setDeadline(e.target.value || defaultDeadline)}
                className={`w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition [color-scheme:light] ${
                  deadline === defaultDeadline ? 'border-gray-200 text-gray-400' : 'border-cyan-300 text-gray-800'
                }`}
              />
              <p className="text-xs text-amber-600">Please choose a suitable deadline — the 48-hour default may not apply to your poll.</p>
            </div>

            {/* Target Audience */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Target Audience *</label>
              <select
                value={audienceGroupId}
                onChange={e => { setAudienceGroupId(e.target.value); setIndividualEmails([]); setEmailInput('') }}
                className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition bg-white"
              >
                <option value="">Select target group...</option>
                {huntGroups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
                <option value="__other__">Other (add manually)</option>
              </select>

              {audienceGroupId === '__other__' && (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-gray-600">Add Individual Emails</span>
                    <span className="text-xs text-gray-400">(type, autocomplete, or paste)</span>
                  </div>

                  {individualEmails.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {individualEmails.map(email => (
                        <span key={email}
                          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700">
                          {email}
                          <button type="button" onClick={() => removeIndividualEmail(email)}
                            className="text-gray-400 hover:text-rose-500 transition-colors">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="relative">
                    <input
                      ref={emailInputRef}
                      type="text"
                      value={emailInput}
                      onChange={e => { setEmailInput(e.target.value); setShowSuggestions(true) }}
                      onFocus={() => setShowSuggestions(true)}
                      onKeyDown={handleEmailKeyDown}
                      placeholder={`name@${ALLOWED_DOMAIN} — Enter or comma to add`}
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition"
                    />
                    {showSuggestions && emailSuggestions.length > 0 && (
                      <div ref={suggestionsRef}
                        className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
                        {emailSuggestions.map(s => (
                          <button key={s.email} type="button"
                            onMouseDown={e => { e.preventDefault(); addIndividualEmail(s.email) }}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-cyan-50 transition-colors">
                            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-cyan-100 text-xs font-bold text-cyan-700">
                              {s.label[0]?.toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-800">{s.label}</p>
                              <p className="text-xs text-gray-400">{s.email}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {individualEmails.length === 0 && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      No recipients added yet — type an email above and press Enter.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Poll Questions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Poll Questions <span className="normal-case font-normal text-gray-400">(optional, max 4)</span>
                </label>
              </div>
              {questions.length === 0 && (
                <p className="rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-400">
                  Leave empty — HR will generate relevant questions automatically.
                </p>
              )}
              <QuestionBuilder
                questions={questions}
                onChange={setQuestions}
                maxQuestions={4}
              />
              {questions.length < 4 && (
                <button type="button"
                  onClick={() => setQuestions(prev => [...prev, { id: crypto.randomUUID(), type: 'open_ended', text: '', options: [] }])}
                  className="flex items-center gap-1.5 text-xs font-medium text-cyan-600 hover:text-cyan-700 transition-colors mt-1">
                  <Plus className="h-3.5 w-3.5" /> Add Question
                </button>
              )}
            </div>

            {/* Recurring Poll */}
            <div className="rounded-xl border border-gray-200 px-4 py-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isFrequent}
                  onChange={e => setIsFrequent(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
                />
                <div>
                  <p className="text-sm font-semibold text-gray-800">Recurring Poll</p>
                  <p className="text-xs text-gray-400">This poll should be run on a regular schedule</p>
                </div>
              </label>

              {isFrequent && (
                <div className="ml-7 space-y-3 border-t border-gray-100 pt-3">
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Frequency</p>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="frequency"
                          value="monthly"
                          checked={frequency === 'monthly'}
                          onChange={() => setFrequency('monthly')}
                          className="h-4 w-4 border-gray-300 text-cyan-600 focus:ring-cyan-500"
                        />
                        <span className="text-sm text-gray-700">Monthly</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="frequency"
                          value="quarterly"
                          checked={frequency === 'quarterly'}
                          onChange={() => setFrequency('quarterly')}
                          className="h-4 w-4 border-gray-300 text-cyan-600 focus:ring-cyan-500"
                        />
                        <span className="text-sm text-gray-700">Quarterly</span>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Starting From *</p>
                    <input
                      type="date"
                      value={frequencyStartDate}
                      onChange={e => setFrequencyStartDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition"
                    />
                    <p className="text-xs text-gray-400">HR will set up the recurring schedule from this date.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Attachments */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Attachments <span className="normal-case font-normal text-gray-400">(optional, max {MAX_FILES} files · 5 MB each)</span>
              </label>

              {/* Attached file chips */}
              {attachments.length > 0 && (
                <div className="space-y-1.5">
                  {attachments.map((file, i) => (
                    <div key={i}
                      className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Paperclip className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                        <span className="text-sm text-gray-700 truncate">{file.name}</span>
                        <span className="text-xs text-gray-400 flex-shrink-0">{formatBytes(file.size)}</span>
                      </div>
                      <button type="button" onClick={() => removeAttachment(i)}
                        className="ml-2 flex-shrink-0 text-gray-400 hover:text-rose-500 transition-colors">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {attachments.length < MAX_FILES && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500 hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50 transition-colors"
                  >
                    <Paperclip className="h-4 w-4" />
                    {attachments.length === 0 ? 'Attach files' : 'Attach more files'}
                  </button>
                </>
              )}
            </div>

            {/* Context */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Additional Context <span className="normal-case font-normal text-gray-400">(optional)</span>
              </label>
              <textarea placeholder="Any background or specific objectives for this poll..."
                value={form.context} onChange={e => set('context', e.target.value)} rows={3}
                className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition resize-none" />
            </div>

            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-cyan-600 py-3 text-sm font-semibold text-white shadow-lg hover:bg-cyan-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Submitting...' : 'Submit Poll Request'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-white/40">Koenig Solutions HR · Poll Management System</p>
      </div>
    </div>
  )
}
