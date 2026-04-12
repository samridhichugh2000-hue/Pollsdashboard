'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { CheckCircle2, ClipboardCheck, Loader2, Pencil } from 'lucide-react'
import type { Poll } from '@/types'

type PageStatus = 'loading' | 'error' | 'ready' | 'submitting' | 'done'

interface PollQuestion { text: string; type: 'rating' | 'open_ended' }

function parseQuestions(raw: string | null | undefined): PollQuestion[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Array<string | PollQuestion>
    return parsed.map((q) =>
      typeof q === 'string' ? { text: q, type: 'open_ended' as const } : q
    )
  } catch { return [] }
}

const gradient = 'linear-gradient(135deg, #0e7490 0%, #0c6478 50%, #0a5568 100%)'

export default function ApprovePage() {
  const { token } = useParams<{ token: string }>()
  const searchParams = useSearchParams()
  const initialMode = searchParams.get('mode') === 'edit' ? 'edit' : 'view'

  const [status, setStatus] = useState<PageStatus>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [poll, setPoll] = useState<Poll | null>(null)
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode)

  // Editable fields
  const [editSubject, setEditSubject] = useState('')
  const [editEmailBody, setEditEmailBody] = useState('')
  const [editQuestions, setEditQuestions] = useState<PollQuestion[]>([])

  useEffect(() => {
    fetch(`/api/approve/${token}`)
      .then(async (r) => {
        const data = await r.json() as Poll & { error?: string }
        if (!r.ok) { setErrorMsg(data.error ?? 'Invalid link.'); setStatus('error'); return }
        setPoll(data)
        setEditSubject(data.subject ?? `Poll: ${data.topic}`)
        setEditEmailBody(data.draft_email_body ?? '')
        setEditQuestions(parseQuestions(data.questions))
        setStatus('ready')
      })
      .catch(() => { setErrorMsg('Could not load the approval page.'); setStatus('error') })
  }, [token])

  const submit = async (action: 'approve' | 'save_and_approve') => {
    setStatus('submitting')
    try {
      const res = await fetch(`/api/approve/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          subject: editSubject,
          draft_email_body: editEmailBody,
          questions: JSON.stringify(editQuestions),
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Action failed.')
      setStatus('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.')
      setStatus('ready')
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: gradient }}>
        <Loader2 className="h-8 w-8 animate-spin text-white/60" />
      </div>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (status === 'error' || !poll) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4" style={{ background: gradient }}>
        <div className="w-full max-w-md rounded-3xl bg-white px-8 py-10 shadow-2xl text-center">
          <p className="text-gray-700 font-medium">{errorMsg}</p>
          <p className="mt-3 text-sm text-gray-400">
            This link may have expired or already been used.
            <br />Please contact the HR team for a new link.
          </p>
          <p className="mt-8 text-xs text-gray-300">Koenig Solutions HR · Poll Management System</p>
        </div>
      </div>
    )
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  if (status === 'done') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4" style={{ background: gradient }}>
        <div className="w-full max-w-md rounded-3xl bg-white px-8 py-10 shadow-2xl text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Poll Approved!</h2>
          <p className="mt-3 text-sm text-gray-500 leading-relaxed">
            Thank you. The poll has been approved and the HR team has been notified.
          </p>
          <p className="mt-8 text-xs text-gray-300">Koenig Solutions HR · Poll Management System</p>
        </div>
      </div>
    )
  }

  const questions = parseQuestions(poll.questions)

  // ── Ready ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen px-4 py-10" style={{ background: gradient }}>
      <div className="mx-auto w-full max-w-2xl">

        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <ClipboardCheck className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Poll Approval Request</h1>
          <p className="mt-1 text-sm text-white/60">{poll.department}</p>
        </div>

        <div className="rounded-3xl bg-white shadow-2xl px-7 py-7 space-y-6">

          {errorMsg && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{errorMsg}</div>
          )}

          {/* Poll metadata */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Topic</p>
              <p className="mt-0.5 font-medium text-gray-900">{poll.topic}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Department</p>
              <p className="mt-0.5 font-medium text-gray-900">{poll.department}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Requested By</p>
              <p className="mt-0.5 font-medium text-gray-900">{poll.requested_by}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Deadline</p>
              <p className="mt-0.5 font-medium text-gray-900">
                {poll.deadline ? new Date(poll.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
              </p>
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* VIEW mode: read-only preview */}
          {mode === 'view' && (
            <>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Subject Line</p>
                <p className="rounded-lg bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-800">
                  {poll.subject ?? `Poll: ${poll.topic}`}
                </p>
              </div>

              {poll.draft_email_body && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Draft Email Body</p>
                  <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {poll.draft_email_body}
                  </div>
                </div>
              )}

              {questions.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Poll Questions</p>
                  <ol className="space-y-2 text-sm">
                    {questions.map((q, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="font-bold text-cyan-600">{i + 1}.</span>
                        <span className="text-gray-800">{q.text}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {poll.ms_form_link && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Poll Form Link</p>
                  <a href={poll.ms_form_link} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline break-all">
                    {poll.ms_form_link}
                  </a>
                </div>
              )}
            </>
          )}

          {/* EDIT mode: editable fields */}
          {mode === 'edit' && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Subject Line
                </label>
                <input
                  type="text"
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Email Body
                </label>
                <textarea
                  value={editEmailBody}
                  onChange={(e) => setEditEmailBody(e.target.value)}
                  rows={8}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm font-mono outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition resize-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Poll Questions
                </label>
                <div className="space-y-2">
                  {editQuestions.map((q, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="mt-2.5 text-xs font-bold text-cyan-600 w-5 shrink-0">{i + 1}.</span>
                      <textarea
                        value={q.text}
                        onChange={(e) => {
                          const updated = [...editQuestions]
                          updated[i] = { ...updated[i], text: e.target.value }
                          setEditQuestions(updated)
                        }}
                        rows={2}
                        className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition resize-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <hr className="border-gray-100" />

          {/* Action buttons */}
          <div className="flex flex-col gap-3 sm:flex-row">
            {mode === 'view' ? (
              <>
                <button
                  onClick={() => submit('approve')}
                  disabled={status === 'submitting'}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                >
                  {status === 'submitting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Approve as-is
                </button>
                <button
                  onClick={() => setMode('edit')}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-cyan-600 py-3 text-sm font-semibold text-cyan-700 hover:bg-cyan-50 transition-colors"
                >
                  <Pencil className="h-4 w-4" />
                  Edit &amp; Approve
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => submit('save_and_approve')}
                  disabled={status === 'submitting'}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                >
                  {status === 'submitting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save Changes &amp; Approve
                </button>
                <button
                  onClick={() => setMode('view')}
                  className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Back to Preview
                </button>
              </>
            )}
          </div>

          <p className="text-center text-xs text-gray-300">
            Koenig Solutions HR · Poll Management System
          </p>
        </div>
      </div>
    </div>
  )
}
