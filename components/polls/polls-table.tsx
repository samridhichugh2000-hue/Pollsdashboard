'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Trash2, ArchiveRestore, Award, X, Loader2 } from 'lucide-react'
import { StatusBadge } from './status-badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatRelative, isApprovalOverdue, getErrorMessage, deriveAudienceLabel, buildHuntGroupEmailMap } from '@/lib/utils'
import { toast } from 'sonner'
import type { Poll, PollResponse } from '@/types'

interface FinalisedEntry {
  respondent?: string
  email?: string
  submitted_at: string
  answers: { question: string; answer: string }[]
}

function FinalisedKiteModal({ poll, onClose }: { poll: Poll; onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [candidates, setCandidates] = useState<FinalisedEntry[]>([])

  useEffect(() => {
    fetch(`/api/polls/${poll.id}`)
      .then(r => r.ok ? r.json() : {})
      .then((data: { response?: PollResponse | null }) => {
        if (!data.response?.response_data) return
        try {
          const entries = JSON.parse(data.response.response_data) as (FinalisedEntry & { actionable?: boolean | null })[]
          setCandidates(entries.filter(e => e.actionable === true))
        } catch { /* leave empty */ }
      })
      .catch(() => toast.error('Failed to load finalised candidates'))
      .finally(() => setLoading(false))
  }, [poll.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 dark:border-slate-700 px-6 py-5">
          <div>
            <h2 className="flex items-center gap-2 font-bold text-gray-900 dark:text-slate-100 text-lg leading-tight">
              <Award className="h-5 w-5 text-emerald-500" /> Finalised Kite
            </h2>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{poll.topic}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5 space-y-3">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-500 py-6 text-center">No candidate has been marked Finalised for this KGT yet.</p>
          ) : (
            candidates.map((c, i) => (
              <div key={i} className="rounded-xl border border-emerald-100 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-900/20 p-4">
                <p className="font-semibold text-gray-900 dark:text-slate-100">{c.respondent ?? c.email ?? 'Anonymous'}</p>
                {c.email && <p className="text-xs text-gray-400 dark:text-slate-500 mb-2">{c.email}</p>}
                {c.answers.map((a, qi) => (
                  <div key={qi} className="mt-2">
                    <p className="text-[11px] font-semibold text-gray-400 dark:text-slate-500">Q{qi + 1}. {a.question}</p>
                    <p className="text-sm text-gray-700 dark:text-slate-200 whitespace-pre-wrap">{a.answer || '—'}</p>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function isPastDeadline(poll: Poll): boolean {
  return !!poll.deadline && new Date(poll.deadline).getTime() < Date.now()
}

interface PollsTableProps {
  polls: Poll[]
  onMarkClosed?: (pollId: string) => void
  onCloseExternal?: (pollId: string) => void
  onArchive?: (pollId: string) => void
  onReject?: (pollId: string) => void
  onRejectExternal?: (pollId: string, reason: string) => void
  onDeleted?: () => void
  onUnarchived?: () => void
  linkBase?: string
}

export function PollsTable({ polls, onMarkClosed, onCloseExternal, onArchive, onReject, onRejectExternal, onDeleted, onUnarchived, linkBase = '/polls' }: PollsTableProps) {
  const [confirmClose, setConfirmClose] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null)
  const [confirmReject, setConfirmReject] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [finalisedKitePoll, setFinalisedKitePoll] = useState<Poll | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [unarchiving, setUnarchiving] = useState(false)
  const [huntGroupsByEmail, setHuntGroupsByEmail] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    fetch('/api/hunt-groups')
      .then(r => r.ok ? r.json() : [])
      .then((groups: { name: string; email: string }[]) => setHuntGroupsByEmail(buildHuntGroupEmailMap(groups)))
      .catch(() => { /* falls back to raw email/department display */ })
  }, [])

  const allSelected = polls.length > 0 && selected.size === polls.length
  const someSelected = selected.size > 0

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(polls.map(p => p.id)))
  const toggleOne = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handleBulkDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch('/api/polls', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected] }),
      })
      if (res.ok) {
        toast.success(`${selected.size} poll${selected.size > 1 ? 's' : ''} deleted`)
        setSelected(new Set())
        setConfirmBulkDelete(false)
        onDeleted?.()
      } else {
        toast.error(await getErrorMessage(res, 'Failed to delete polls'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete polls')
    } finally {
      setDeleting(false)
    }
  }

  const handleBulkUnarchive = async () => {
    setUnarchiving(true)
    try {
      const res = await fetch('/api/polls', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'BULK_UNARCHIVE', ids: [...selected] }),
      })
      if (res.ok) {
        toast.success(`${selected.size} poll${selected.size > 1 ? 's' : ''} unarchived`)
        setSelected(new Set())
        onUnarchived?.()
      } else {
        toast.error(await getErrorMessage(res, 'Failed to unarchive polls'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unarchive polls')
    } finally {
      setUnarchiving(false)
    }
  }

  if (polls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-gray-400">No polls found.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Bulk action toolbar */}
      {someSelected && (
        <div className="flex items-center justify-between px-5 py-2.5 bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-900/50">
          <span className="text-sm font-medium text-red-700 dark:text-red-400">{selected.size} poll{selected.size > 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-2">
            {confirmBulkDelete ? (
              <>
                <span className="text-xs text-red-600">Delete {selected.size} poll{selected.size > 1 ? 's' : ''}? This cannot be undone.</span>
                <Button variant="destructive" size="sm" className="h-7 text-xs" disabled={deleting}
                  onClick={handleBulkDelete}>
                  {deleting ? 'Deleting…' : 'Yes, Delete'}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => setConfirmBulkDelete(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <button onClick={() => setSelected(new Set())}
                  className="text-xs text-red-400 hover:text-red-600 transition-colors">
                  Clear selection
                </button>
                {onUnarchived && (
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    disabled={unarchiving}
                    onClick={() => void handleBulkUnarchive()}>
                    <ArchiveRestore className="h-3.5 w-3.5" />
                    {unarchiving ? 'Unarchiving…' : 'Unarchive selected'}
                  </Button>
                )}
                <Button variant="destructive" size="sm" className="h-7 text-xs gap-1.5"
                  onClick={() => setConfirmBulkDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete selected
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 dark:border-slate-700">
            <th className="px-5 py-3 text-left">
              <input type="checkbox" checked={allSelected} onChange={toggleAll}
                className="h-4 w-4 rounded border-gray-300 text-cyan-600 cursor-pointer" />
            </th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Topic</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Audience</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Requested By</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Source</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Status</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Created</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Poll Deadline</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Form</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
          {polls.map((poll) => {
            const overdue = poll.status === 'AWAITING_APPROVAL' && isApprovalOverdue(poll.updated_at)

            return (
              <tr key={poll.id} className={`transition-colors ${selected.has(poll.id) ? 'bg-red-50/50 dark:bg-red-900/20' : 'hover:bg-gray-50 dark:hover:bg-slate-700/30'}`}>
                <td className="px-5 py-3.5">
                  <input type="checkbox" checked={selected.has(poll.id)} onChange={() => toggleOne(poll.id)}
                    className="h-4 w-4 rounded border-gray-300 text-cyan-600 cursor-pointer" />
                </td>
                <td className="max-w-[280px] px-5 py-3.5">
                  <p className="break-words font-medium text-gray-900 dark:text-slate-100" title={poll.topic}>{poll.topic}</p>
                  {overdue && <span className="text-xs font-medium text-rose-500">Overdue</span>}
                </td>
                <td className="px-5 py-3.5 text-gray-500 dark:text-slate-400">{deriveAudienceLabel(poll, huntGroupsByEmail)}</td>
                <td className="px-5 py-3.5 text-gray-500 dark:text-slate-400 max-w-[140px] truncate">{poll.requested_by}</td>
                <td className="px-5 py-3.5">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    poll.source === 'email' ? 'bg-cyan-50 text-cyan-700' :
                    poll.source === 'external' ? 'bg-purple-50 text-purple-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {poll.source === 'email' ? 'Inbox' : poll.source === 'external' ? 'External' : 'Manual'}
                  </span>
                </td>
                <td className="px-5 py-3.5"><StatusBadge status={poll.status} /></td>
                <td className="px-5 py-3.5 text-gray-400 dark:text-slate-500 text-xs">
                  <span title={formatDateTime(poll.created_at)}>{formatRelative(poll.created_at)}</span>
                </td>
                <td className="px-5 py-3.5 text-xs">
                  {poll.status === 'DRAFT' ? (
                    <span className="text-gray-300 dark:text-slate-600">—</span>
                  ) : ['CLOSED', 'ARCHIVED', 'RESULTS_UPLOADED', 'RESULTS_SHARED'].includes(poll.status) && poll.closed_at ? (
                    <span className="text-gray-500 dark:text-slate-400" title={formatDateTime(poll.closed_at)}>
                      Closed on {new Date(poll.closed_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}
                    </span>
                  ) : poll.deadline ? (
                    <span className="text-amber-600" title="Scheduled close date">
                      Closes on {new Date(poll.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}
                    </span>
                  ) : (
                    <span className="text-gray-300 dark:text-slate-600">—</span>
                  )}
                </td>
                <td className="px-5 py-3.5">
                  {poll.ms_form_link ? (
                    <a href={poll.ms_form_link} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-cyan-600 hover:underline">
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <Link href={`${linkBase}/${poll.id}`}
                      className="text-xs font-medium text-cyan-600 hover:text-cyan-800 hover:underline">
                      View
                    </Link>
                    {poll.request_type === 'KGT' && isPastDeadline(poll) && (
                      <button onClick={() => setFinalisedKitePoll(poll)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-800 hover:underline">
                        <Award className="h-3 w-3" /> Finalised Kite
                      </button>
                    )}
                    {(onReject || onRejectExternal) && poll.source === 'external' && !['REJECTED', 'ARCHIVED', 'CLOSED', 'RESULTS_UPLOADED'].includes(poll.status) && (
                      confirmReject === poll.id ? (
                        <div className="flex flex-col gap-1.5" style={{ minWidth: 200 }}>
                          <textarea
                            autoFocus
                            rows={2}
                            placeholder="Reason for rejection (required)"
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            className="w-full rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-gray-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-orange-400 resize-none"
                          />
                          <div className="flex gap-1">
                            <Button variant="destructive" size="sm" className="h-6 text-xs"
                              disabled={!rejectReason.trim()}
                              onClick={() => {
                                if (onRejectExternal) {
                                  onRejectExternal(poll.id, rejectReason.trim())
                                } else {
                                  onReject?.(poll.id)
                                }
                                setConfirmReject(null)
                                setRejectReason('')
                              }}>
                              Confirm
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 text-xs"
                              onClick={() => { setConfirmReject(null); setRejectReason('') }}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button className="text-xs font-medium text-orange-500 hover:text-orange-700 hover:underline"
                          onClick={() => { setConfirmReject(poll.id); setRejectReason('') }}>
                          Reject
                        </button>
                      )
                    )}
                    {(onCloseExternal && poll.source === 'external' || onMarkClosed) && !['CLOSED', 'ARCHIVED', 'REJECTED'].includes(poll.status) && (
                      confirmClose === poll.id ? (
                        <div className="flex items-center gap-1">
                          <Button variant="destructive" size="sm" className="h-6 text-xs"
                            onClick={() => {
                              if (onCloseExternal && poll.source === 'external') {
                                onCloseExternal(poll.id)
                              } else {
                                onMarkClosed?.(poll.id)
                              }
                              setConfirmClose(null)
                            }}>
                            Confirm
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 text-xs"
                            onClick={() => setConfirmClose(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <button className="text-xs font-medium text-rose-500 hover:text-rose-700 hover:underline"
                          onClick={() => setConfirmClose(poll.id)}>
                          {onCloseExternal && poll.source === 'external' ? 'Close & Notify' : 'Close'}
                        </button>
                      )
                    )}
                    {onArchive && poll.status !== 'ARCHIVED' && (
                      confirmArchive === poll.id ? (
                        <div className="flex items-center gap-1">
                          <Button variant="destructive" size="sm" className="h-6 text-xs"
                            onClick={() => { onArchive(poll.id); setConfirmArchive(null) }}>
                            Archive
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 text-xs"
                            onClick={() => setConfirmArchive(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <button className="text-xs font-medium text-gray-400 hover:text-rose-600 hover:underline"
                          onClick={() => setConfirmArchive(poll.id)}>
                          Delete
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    {finalisedKitePoll && (
      <FinalisedKiteModal poll={finalisedKitePoll} onClose={() => setFinalisedKitePoll(null)} />
    )}
    </div>
  )
}
