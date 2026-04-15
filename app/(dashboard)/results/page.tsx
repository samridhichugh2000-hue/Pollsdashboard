'use client'

import { useCallback, useEffect, useState } from 'react'
import { BarChart3, CheckCircle2, XCircle, X, Loader2, RefreshCw, Clock, User, Mail, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/polls/status-badge'
import { formatDateTime, formatRelative } from '@/lib/utils'
import type { Poll, PollResponse } from '@/types'

const RELEASED_STATUSES = ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED', 'CLOSED', 'RESULTS_UPLOADED']

interface ResponseEntry {
  respondent?: string
  email?: string
  submitted_at: string
  answers: { question: string; answer: string }[]
  actionable?: boolean | null
}

function ActionableButton({
  state,
  onClick,
  loading,
}: {
  state: boolean | null | undefined
  onClick: (val: boolean | null) => void
  loading: boolean
}) {
  return (
    <div className="flex gap-1.5 flex-shrink-0">
      <button
        onClick={() => onClick(state === true ? null : true)}
        disabled={loading}
        className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
          state === true
            ? 'bg-emerald-500 text-white'
            : 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
        }`}
      >
        <CheckCircle2 className="h-3 w-3" /> Actionable
      </button>
      <button
        onClick={() => onClick(state === false ? null : false)}
        disabled={loading}
        className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
          state === false
            ? 'bg-rose-500 text-white'
            : 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
        }`}
      >
        <XCircle className="h-3 w-3" /> Not Actionable
      </button>
    </div>
  )
}

function ManageDialog({
  poll,
  onClose,
}: {
  poll: Poll
  onClose: () => void
}) {
  const [entries, setEntries] = useState<ResponseEntry[]>([])
  const [loadingFetch, setLoadingFetch] = useState(true)
  const [savingIndex, setSavingIndex] = useState<number | null>(null)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  useEffect(() => {
    fetch(`/api/polls/${poll.id}`)
      .then(r => r.json())
      .then((data: { response?: PollResponse }) => {
        if (data.response?.response_data) {
          setEntries(JSON.parse(data.response.response_data) as ResponseEntry[])
        }
      })
      .catch(() => toast.error('Failed to load responses'))
      .finally(() => setLoadingFetch(false))
  }, [poll.id])

  const handleActionable = async (index: number, value: boolean | null) => {
    setSavingIndex(index)
    try {
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UPDATE_ENTRY_ACTIONABLE', entryIndex: index, actionable: value }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setEntries(prev => prev.map((e, i) => i === index ? { ...e, actionable: value } : e))
    } catch {
      toast.error('Failed to save — please try again')
    } finally {
      setSavingIndex(null)
    }
  }

  const actionableCount = entries.filter(e => e.actionable === true).length
  const notActionableCount = entries.filter(e => e.actionable === false).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div>
            <h2 className="font-bold text-gray-900 text-lg leading-tight">{poll.topic}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{poll.department}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <StatusBadge status={poll.status} />
            <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {entries.length > 0 && (
          <div className="flex gap-4 px-6 py-3 bg-gray-50 border-b border-gray-100 text-sm">
            <span className="text-gray-600">{entries.length} response{entries.length !== 1 ? 's' : ''}</span>
            {actionableCount > 0 && (
              <span className="text-emerald-600 font-medium">{actionableCount} actionable</span>
            )}
            {notActionableCount > 0 && (
              <span className="text-rose-600 font-medium">{notActionableCount} not actionable</span>
            )}
            {entries.filter(e => e.actionable == null).length > 0 && (
              <span className="text-gray-400">{entries.filter(e => e.actionable == null).length} not reviewed</span>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loadingFetch ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <BarChart3 className="h-10 w-10 text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500">No responses collected yet</p>
              <p className="text-xs text-gray-400 mt-1">Responses will appear here once submitted</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {entries.map((entry, i) => {
                const isExpanded = expandedIndex === i
                const isSaving = savingIndex === i
                return (
                  <div key={i} className={`px-6 py-4 transition-colors ${
                    entry.actionable === true ? 'bg-emerald-50/40' : entry.actionable === false ? 'bg-rose-50/40' : ''
                  }`}>
                    {/* Row header */}
                    <div className="flex items-center gap-3">
                      {/* Index */}
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">
                        {i + 1}
                      </div>

                      {/* Identity */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {entry.respondent && (
                            <span className="flex items-center gap-1 text-sm font-medium text-gray-800">
                              <User className="h-3 w-3 text-gray-400" /> {entry.respondent}
                            </span>
                          )}
                          {entry.email && (
                            <span className="flex items-center gap-1 text-xs text-gray-500">
                              <Mail className="h-3 w-3" /> {entry.email}
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <Clock className="h-3 w-3" /> {formatRelative(entry.submitted_at)}
                          </span>
                        </div>
                      </div>

                      {/* Actionable buttons */}
                      {isSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400 flex-shrink-0" />
                      ) : (
                        <ActionableButton
                          state={entry.actionable}
                          onClick={(val) => void handleActionable(i, val)}
                          loading={savingIndex !== null}
                        />
                      )}

                      {/* Expand toggle */}
                      <button
                        onClick={() => setExpandedIndex(isExpanded ? null : i)}
                        className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* Expanded answers */}
                    {isExpanded && entry.answers.length > 0 && (
                      <div className="mt-3 ml-10 space-y-2.5">
                        {entry.answers.map((a, qi) => (
                          <div key={qi} className="rounded-xl bg-white border border-gray-100 px-4 py-3">
                            <p className="text-xs font-medium text-gray-500 mb-1">Q{qi + 1}: {a.question}</p>
                            <p className="text-sm text-gray-800">{a.answer || <span className="italic text-gray-400">No answer</span>}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ResultsPage() {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [managePoll, setManagePoll] = useState<Poll | null>(null)

  const fetchPolls = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch('/api/polls').then(r => r.json()) as Poll[]
      setPolls(data.filter(p => RELEASED_STATUSES.includes(p.status)))
    } catch {
      toast.error('Failed to load polls')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchPolls() }, [fetchPolls])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Results & Follow-up</h2>
          <p className="text-sm text-white/50">{polls.length} released poll{polls.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => void fetchPolls()}
          className="flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20 backdrop-blur-sm transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : polls.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-gray-400">No released polls yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              <span>Poll</span>
              <span className="text-right">Released</span>
              <span className="text-right">Status</span>
              <span />
            </div>
            {polls.map(poll => (
              <div key={poll.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{poll.topic}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{poll.department}</p>
                </div>
                <span className="text-sm text-gray-500 text-right whitespace-nowrap">
                  {poll.sent_at ? formatDateTime(poll.sent_at) : '—'}
                </span>
                <div className="flex justify-end">
                  <StatusBadge status={poll.status} />
                </div>
                <button
                  onClick={() => setManagePoll(poll)}
                  className="rounded-lg bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-700 hover:bg-cyan-100 transition-colors whitespace-nowrap"
                >
                  Manage →
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {managePoll && (
        <ManageDialog
          poll={managePoll}
          onClose={() => setManagePoll(null)}
        />
      )}
    </div>
  )
}
