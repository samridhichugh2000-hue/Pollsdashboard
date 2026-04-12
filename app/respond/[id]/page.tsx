'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, ClipboardList, Loader2, Star } from 'lucide-react'

interface PollData {
  id: string
  topic: string
  subject?: string | null
  department: string
  deadline: string | null
  questions: Array<string | { text: string; type: string; options?: string[] }>
}

type Answer = { question: string; answer: string }

const ALLOWED_DOMAIN = 'koenig-solutions.com'

function normalizeQuestion(q: string | { text: string; type: string; options?: string[] }): { text: string; type: string; options?: string[] } {
  return typeof q === 'string'
    ? { text: q, type: /rate|rating|scale|satisfied|satisfaction|recommend|\(1\s*[=-]/i.test(q) ? 'rating' : 'open_ended' }
    : q
}

function RatingInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const labels = ['Very Poor', 'Poor', 'Average', 'Good', 'Excellent']
  return (
    <div className="flex gap-2 flex-wrap">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(String(n))}
          className={`flex flex-col items-center gap-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-all
            ${value === String(n)
              ? 'border-cyan-500 bg-cyan-50 text-cyan-700'
              : 'border-gray-200 bg-white text-gray-500 hover:border-cyan-300'
            }`}
        >
          <Star className={`h-4 w-4 ${value === String(n) ? 'fill-cyan-500 text-cyan-500' : 'text-gray-300'}`} />
          <span>{n}</span>
          <span className="text-xs font-normal text-gray-400 hidden sm:block">{labels[n - 1]}</span>
        </button>
      ))}
    </div>
  )
}

function YesNoInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-3">
      {['Yes', 'No'].map(opt => (
        <button key={opt} type="button" onClick={() => onChange(opt)}
          className={`rounded-xl border-2 px-8 py-2.5 text-sm font-semibold transition-all ${
            value === opt
              ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
              : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-300'
          }`}>
          {opt}
        </button>
      ))}
    </div>
  )
}

function MultipleChoiceInput({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      {options.filter(Boolean).map(opt => (
        <label key={opt} className="flex items-center gap-3 cursor-pointer rounded-xl border-2 px-4 py-2.5 transition-all hover:border-purple-300"
          style={{ borderColor: value === opt ? '#9333ea' : '#e5e7eb', backgroundColor: value === opt ? '#faf5ff' : 'white' }}>
          <div className={`h-4 w-4 flex-shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
            value === opt ? 'border-purple-600 bg-purple-600' : 'border-gray-300'
          }`}>
            {value === opt && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
          </div>
          <input type="radio" name="mc" value={opt} checked={value === opt} onChange={() => onChange(opt)} className="sr-only" />
          <span className={`text-sm font-medium ${value === opt ? 'text-purple-700' : 'text-gray-700'}`}>{opt}</span>
        </label>
      ))}
    </div>
  )
}

export default function RespondPage() {
  const { id } = useParams<{ id: string }>()
  const [poll, setPoll] = useState<PollData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [answers, setAnswers] = useState<Answer[]>([])
  const [pollQuestions, setPollQuestions] = useState<{ text: string; type: string; options?: string[] }[]>([])
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem(`poll_responded_${id}`)) {
      setSubmitted(true)
      return
    }

    fetch(`/api/respond/${id}`)
      .then(async (r) => {
        const data = await r.json() as PollData & { error?: string }
        if (!r.ok) { setLoadError(data.error ?? 'Failed to load poll.'); return }
        setPoll(data)
        const normalized = data.questions.map(normalizeQuestion)
        setPollQuestions(normalized)
        setAnswers(normalized.map((q) => ({ question: q.text, answer: '' })))
      })
      .catch(() => setLoadError('Failed to load poll.'))
  }, [id])

  const setAnswer = (i: number, value: string) => {
    setAnswers((prev) => prev.map((a, idx) => idx === i ? { ...a, answer: value } : a))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError('')

    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail) {
      setSubmitError('Please enter your Koenig Solutions email address.')
      return
    }
    if (!trimmedEmail.endsWith(`@${ALLOWED_DOMAIN}`)) {
      setSubmitError(`Only @${ALLOWED_DOMAIN} email addresses are allowed.`)
      return
    }
    if (answers.some((a) => !a.answer.trim())) {
      setSubmitError('Please answer all questions before submitting.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/respond/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, email: trimmedEmail }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Submission failed.')

      localStorage.setItem(`poll_responded_${id}`, '1')
      setSubmitted(true)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  const gradient = 'linear-gradient(135deg, #0e7490 0%, #0c6478 50%, #0a5568 100%)'

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4" style={{ background: gradient }}>
        <div className="w-full max-w-md rounded-3xl bg-white px-8 py-10 shadow-2xl text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Thank You!</h2>
          <p className="mt-3 text-sm text-gray-500 leading-relaxed">
            Your response has been recorded. We appreciate your feedback.
          </p>
          <p className="mt-6 text-xs text-gray-400">Koenig Solutions HR · Poll Management System</p>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4" style={{ background: gradient }}>
        <div className="w-full max-w-md rounded-3xl bg-white px-8 py-10 shadow-2xl text-center">
          <p className="text-gray-500 text-sm">{loadError}</p>
          <p className="mt-4 text-xs text-gray-400">Koenig Solutions HR</p>
        </div>
      </div>
    )
  }

  if (!poll) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: gradient }}>
        <Loader2 className="h-8 w-8 animate-spin text-white/60" />
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-10" style={{ background: gradient }}>
      <div className="mx-auto w-full max-w-lg">

        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <ClipboardList className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">{poll.subject || poll.topic}</h1>
          <p className="mt-1.5 text-sm text-white/60">
            {poll.department} · {poll.deadline
              ? `Due ${new Date(poll.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
              : 'Open poll'}
          </p>
        </div>

        <div className="rounded-3xl bg-white shadow-2xl px-7 py-7">
          <form onSubmit={handleSubmit} className="space-y-6">

            {submitError && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{submitError}</div>
            )}

            {/* Email — required, domain locked */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">
                Your Koenig Solutions Email <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`yourname@${ALLOWED_DOMAIN}`}
                required
                className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition"
              />
              <p className="text-xs text-gray-400">Only @{ALLOWED_DOMAIN} addresses are accepted.</p>
            </div>

            {/* Questions */}
            {answers.map((a, i) => (
              <div key={i} className="space-y-2">
                <label className="block text-sm font-medium text-gray-800">
                  <span className="mr-2 text-cyan-600 font-bold">{i + 1}.</span>
                  {a.question}
                </label>
                {pollQuestions[i]?.type === 'rating' ? (
                  <RatingInput value={a.answer} onChange={(v) => setAnswer(i, v)} />
                ) : pollQuestions[i]?.type === 'yes_no' ? (
                  <YesNoInput value={a.answer} onChange={(v) => setAnswer(i, v)} />
                ) : pollQuestions[i]?.type === 'multiple_choice' && pollQuestions[i]?.options?.length ? (
                  <MultipleChoiceInput options={pollQuestions[i].options!} value={a.answer} onChange={(v) => setAnswer(i, v)} />
                ) : (
                  <textarea
                    value={a.answer}
                    onChange={(e) => setAnswer(i, e.target.value)}
                    rows={3}
                    placeholder="Your answer..."
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition resize-none"
                  />
                )}
              </div>
            ))}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-cyan-600 py-3 text-sm font-semibold text-white shadow-lg hover:bg-cyan-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? 'Submitting...' : 'Submit Response'}
            </button>

          </form>
        </div>

        <p className="mt-6 text-center text-xs text-white/40">Koenig Solutions HR · Poll Management System</p>
      </div>
    </div>
  )
}
