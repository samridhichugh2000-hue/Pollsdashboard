'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Loader2, CheckCircle2, ClipboardList, ChevronDown } from 'lucide-react'
import { RecipientPicker } from '@/components/polls/recipient-picker'

interface HuntGroup { id: string; name: string; email: string }
interface Sender { id: string; name: string; email: string }

const TIMELINE_STEPS = [
  { label: 'You submit this form', desc: 'HR receives your request instantly' },
  { label: 'HR reviews & drafts', desc: 'Email body and questions are prepared' },
  { label: 'Your approval', desc: 'You receive a draft to approve or edit' },
  { label: 'Poll goes live', desc: 'Sent to your selected audience' },
  { label: 'Results shared', desc: 'Responses collected and sent to you' },
]

export default function PublicRequestPage() {
  const [huntGroups, setHuntGroups] = useState<HuntGroup[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [questions, setQuestions] = useState<string[]>([])
  const [showTimeline, setShowTimeline] = useState(false)
  const [audienceEmails, setAudienceEmails] = useState<string[]>([])

  const [form, setForm] = useState({
    requester_name: '',
    requester_email: '',
    custom_email: '',
    topic: '',
    context: '',
  })

  useEffect(() => {
    Promise.all([
      fetch('/api/hunt-groups').then(r => r.json()),
      fetch('/api/senders').then(r => r.json()),
    ]).then(([groups, snds]) => {
      setHuntGroups(groups as HuntGroup[])
      setSenders(snds as Sender[])
    }).catch(() => {})
  }, [])

  const set = (field: string, value: string) => setForm(p => ({ ...p, [field]: value } as typeof p))

  const addQuestion = () => { if (questions.length < 4) setQuestions(p => [...p, '']) }
  const updateQuestion = (i: number, v: string) => setQuestions(p => p.map((q, idx) => idx === i ? v : q))
  const removeQuestion = (i: number) => setQuestions(p => p.filter((_, idx) => idx !== i))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const email = form.requester_email === '__other__' ? form.custom_email : form.requester_email
    if (!email) { setError('Please select or enter your email.'); return }
    if (!audienceEmails.length) { setError('Please select at least one target audience.'); return }

    // Derive a human-readable department label from selected emails
    const groupByEmail = new Map(huntGroups.map(g => [g.email.toLowerCase(), g.name]))
    const labels = audienceEmails.map(e => groupByEmail.get(e.toLowerCase()) ?? e)
    const department = labels.join(', ')

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
          questions: questions.filter(q => q.trim()),
          context: form.context,
          single_response: true,
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
    setAudienceEmails([])
    setQuestions([])
  }

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
                <input type="email" placeholder="your@email.com" value={form.custom_email}
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

            {/* Target Audience — RecipientPicker */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Target Audience *</label>
              <RecipientPicker
                key="request-audience"
                value={audienceEmails}
                onChange={setAudienceEmails}
              />
            </div>

            {/* Questions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Poll Questions <span className="normal-case font-normal text-gray-400">(optional, max 4)</span>
                </label>
                {questions.length < 4 && (
                  <button type="button" onClick={addQuestion}
                    className="flex items-center gap-1 text-xs font-medium text-cyan-600 hover:text-cyan-700">
                    <Plus className="h-3.5 w-3.5" /> Add
                  </button>
                )}
              </div>
              {questions.length === 0 && (
                <p className="rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-400">
                  Leave empty — HR will generate relevant questions automatically.
                </p>
              )}
              {questions.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <input type="text" placeholder={`Question ${i + 1}`} value={q}
                    onChange={e => updateQuestion(i, e.target.value)}
                    className="flex-1 rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition" />
                  <button type="button" onClick={() => removeQuestion(i)}
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-400 hover:border-red-200 hover:text-red-400 transition">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
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
