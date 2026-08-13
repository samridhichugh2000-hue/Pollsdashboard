'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { BarChart3, X, Loader2, RefreshCw, Clock, User, Mail, ChevronDown, ChevronUp, Save, ExternalLink, Send, Upload, Zap, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/polls/status-badge'
import { formatDateTime, formatRelative, getErrorMessage } from '@/lib/utils'
import type { Poll, PollResponse } from '@/types'

const RELEASED_STATUSES = ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED', 'CLOSED', 'RESULTS_UPLOADED', 'RESULTS_SHARED']

interface ResponseEntry {
  respondent?: string
  email?: string
  submitted_at: string
  answers: { question: string; answer: string }[]
  actionable?: boolean | null
  remarks?: string
  classification?: 'rms' | 'non_rms' | 'partial' | null
  status?: 'wip' | 'completed' | null
  reply_message?: string
  reply_sent_at?: string
}

type Classification = 'rms' | 'non_rms' | 'partial'

const CLS_CONFIG: Record<Classification, { label: string; active: string; inactive: string }> = {
  rms:     { label: 'RMS',     active: 'bg-blue-500 text-white border-blue-500',     inactive: 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600' },
  non_rms: { label: 'Non-RMS', active: 'bg-purple-500 text-white border-purple-500', inactive: 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-purple-400 hover:text-purple-600' },
  partial: { label: 'Partial', active: 'bg-orange-500 text-white border-orange-500', inactive: 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-orange-400 hover:text-orange-600' },
}

interface MonthBucket { month: string; label: string; count: number }
interface ChartData { monthlyPolls: MonthBucket[]; monthlyResponses: MonthBucket[]; from: string; to: string }

function monthLabel(ym: string) {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

// Generate all YYYY-MM values from 2024-01 to current month
function allMonthOptions() {
  const opts: { value: string; label: string }[] = []
  const now = new Date()
  let y = 2024, m = 1
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    const val = `${y}-${String(m).padStart(2, '0')}`
    opts.push({ value: val, label: monthLabel(val) })
    m++; if (m > 12) { m = 1; y++ }
  }
  return opts
}

function BarChart({ data, color, emptyText }: { data: MonthBucket[]; color: string; emptyText: string }) {
  const max = Math.max(...data.map(d => d.count), 1)
  const W = 700
  const H = 220
  const padL = 36
  const padR = 12
  const padT = 20
  const padB = 40
  const chartW = W - padL - padR
  const chartH = H - padT - padB
  const barW = Math.max(Math.floor(chartW / data.length) - 4, 8)
  const barGap = (chartW - barW * data.length) / (data.length - 1 || 1)

  // Y-axis ticks (4 levels)
  const ticks = [0, Math.round(max / 3), Math.round((2 * max) / 3), max]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {/* grid lines */}
      {ticks.map(t => {
        const y = padT + chartH - (t / max) * chartH
        return (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="currentColor" strokeWidth={0.5} opacity={0.12} />
            <text x={padL - 4} y={y + 4} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.4}>{t}</text>
          </g>
        )
      })}
      {/* bars */}
      {data.map((d, i) => {
        const x = padL + i * (barW + barGap)
        const barH = Math.max((d.count / max) * chartH, d.count > 0 ? 2 : 0)
        const y = padT + chartH - barH
        return (
          <g key={d.month}>
            <rect x={x} y={y} width={barW} height={barH} rx={3} fill={color} opacity={0.85} />
            {d.count > 0 && (
              <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={9} fill={color} fontWeight="600">{d.count}</text>
            )}
            <text x={x + barW / 2} y={H - 2} textAnchor="middle" fontSize={8} fill="currentColor" opacity={0.45}
              transform={data.length > 8 ? `rotate(-35 ${x + barW / 2} ${H - 2})` : undefined}>
              {d.label.split(' ')[0]}
            </text>
          </g>
        )
      })}
      {data.every(d => d.count === 0) && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.3}>{emptyText}</text>
      )}
    </svg>
  )
}

function ManageDialog({ poll, onClose }: { poll: Poll; onClose: () => void }) {
  const [entries, setEntries] = useState<ResponseEntry[]>([])
  const [loadingFetch, setLoadingFetch] = useState(true)
  const [savingIndex, setSavingIndex] = useState<number | null>(null)
  const [savingRemarksIndex, setSavingRemarksIndex] = useState<number | null>(null)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [entryClassifications, setEntryClassifications] = useState<Record<number, Classification | null>>({})
  const [entryRemarks, setEntryRemarks] = useState<Record<number, string>>({})
  const [entryStatuses, setEntryStatuses] = useState<Record<number, 'wip' | 'completed' | null>>({})
  const [entryReplies, setEntryReplies] = useState<Record<number, string>>({})
  const [sendingReplyIndex, setSendingReplyIndex] = useState<number | null>(null)

  useEffect(() => {
    fetch(`/api/polls/${poll.id}`)
      .then(r => r.ok ? r.json() : {})
      .then((data: { response?: PollResponse }) => {
        if (data.response?.response_data) {
          setEntries(JSON.parse(data.response.response_data) as ResponseEntry[])
        }
      })
      .catch(() => toast.error('Failed to load responses'))
      .finally(() => setLoadingFetch(false))
  }, [poll.id])

  const currentCls = (index: number) =>
    entryClassifications[index] !== undefined
      ? entryClassifications[index]
      : (entries[index]?.classification ?? null)

  const currentStatus = (index: number) =>
    entryStatuses[index] !== undefined
      ? entryStatuses[index]
      : (entries[index]?.status ?? null)

  const patchEntry = async (
    index: number,
    actionable: boolean | null,
    classification: Classification | null,
    remarks: string,
    status?: 'wip' | 'completed' | null,
  ) => {
    const res = await fetch(`/api/polls/${poll.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'UPDATE_ENTRY_ACTIONABLE', entryIndex: index, actionable, classification, remarks, ...(status !== undefined ? { status } : {}) }),
    })
    if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to save'))
  }

  const handleActionable = async (index: number, value: boolean | null) => {
    setSavingIndex(index)
    try {
      const cls = currentCls(index)
      const remarks = entryRemarks[index] ?? entries[index]?.remarks ?? ''
      await patchEntry(index, value, cls, remarks)
      setEntries(prev => prev.map((e, i) => i === index ? { ...e, actionable: value } : e))
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save — please try again') }
    finally { setSavingIndex(null) }
  }

  const handleClassification = async (index: number, value: Classification | null) => {
    setSavingIndex(index)
    setEntryClassifications(prev => ({ ...prev, [index]: value }))
    try {
      const remarks = entryRemarks[index] ?? entries[index]?.remarks ?? ''
      await patchEntry(index, entries[index]?.actionable ?? null, value, remarks)
      setEntries(prev => prev.map((e, i) => i === index ? { ...e, classification: value } : e))
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save — please try again') }
    finally { setSavingIndex(null) }
  }

  const handleSaveRemarks = async (index: number) => {
    setSavingRemarksIndex(index)
    try {
      const cls = currentCls(index)
      const remarks = entryRemarks[index] ?? entries[index]?.remarks ?? ''
      await patchEntry(index, entries[index]?.actionable ?? null, cls, remarks)
      setEntries(prev => prev.map((e, i) => i === index ? { ...e, remarks } : e))
      toast.success('Remarks saved')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save remarks') }
    finally { setSavingRemarksIndex(null) }
  }

  const handleStatus = async (index: number, value: 'wip' | 'completed') => {
    const prev = currentStatus(index)
    const next = prev === value ? null : value
    setSavingIndex(index)
    setEntryStatuses(p => ({ ...p, [index]: next }))
    try {
      const cls = currentCls(index)
      const remarks = entryRemarks[index] ?? entries[index]?.remarks ?? ''
      await patchEntry(index, entries[index]?.actionable ?? null, cls, remarks, next)
      setEntries(p => p.map((e, i) => i === index ? { ...e, status: next } : e))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save — please try again')
      setEntryStatuses(p => ({ ...p, [index]: prev }))
    } finally { setSavingIndex(null) }
  }

  const handleSendReply = async (index: number) => {
    const replyMessage = (entryReplies[index] ?? '').trim()
    if (!replyMessage) { toast.error('Reply message cannot be empty.'); return }
    setSendingReplyIndex(index)
    try {
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REPLY_TO_RESPONDENT', entryIndex: index, replyMessage }),
      })
      if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to send reply'))
      const repliedAt = new Date().toISOString()
      setEntries(prev => prev.map((e, i) => i === index ? { ...e, reply_message: replyMessage, reply_sent_at: repliedAt } : e))
      toast.success('Reply sent')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send reply')
    } finally { setSendingReplyIndex(null) }
  }

  const stats = {
    total: entries.length,
    actionable: entries.filter(e => e.actionable === true).length,
    notActionable: entries.filter(e => e.actionable === false).length,
    pending: entries.filter(e => e.actionable == null && e.status !== 'completed').length,
    rms: entries.filter(e => e.classification === 'rms').length,
    nonRms: entries.filter(e => e.classification === 'non_rms').length,
    partial: entries.filter(e => e.classification === 'partial').length,
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 dark:border-slate-700 px-6 py-5">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-slate-100 text-lg leading-tight">{poll.topic}</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{poll.department}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <StatusBadge status={poll.status} />
            <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-600 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {entries.length > 0 && (
          <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-700 space-y-2">
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Total',          value: stats.total,         cls: 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200' },
                { label: poll.request_type === 'KGT' ? 'Finalised' : 'Actionable',     value: stats.actionable,    cls: 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' },
                { label: poll.request_type === 'KGT' ? 'Not Finalised' : 'Not Actionable', value: stats.notActionable, cls: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300' },
                { label: 'Pending Review', value: stats.pending,       cls: 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' },
              ].map(s => (
                <div key={s.label} className={`rounded-xl px-3 py-2 text-center ${s.cls}`}>
                  <p className="text-xl font-bold leading-none">{s.value}</p>
                  <p className="mt-1 text-xs font-medium">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'RMS',     value: stats.rms,    cls: 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' },
                { label: 'Non-RMS', value: stats.nonRms, cls: 'bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400' },
                { label: 'Partial', value: stats.partial, cls: 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400' },
              ].map(s => (
                <div key={s.label} className={`rounded-xl px-3 py-2 text-center ${s.cls}`}>
                  <p className="text-xl font-bold leading-none">{s.value}</p>
                  <p className="mt-1 text-xs font-medium">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {loadingFetch ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <BarChart3 className="h-10 w-10 text-gray-200 dark:text-slate-700 mb-3" />
              <p className="text-sm font-medium text-gray-500">No responses collected yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-slate-700/60">
              {entries.map((entry, i) => {
                const isExpanded = expandedIndex === i
                const isSaving = savingIndex === i
                const cls = currentCls(i)
                return (
                  <div key={i} className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-slate-700 text-xs font-bold text-gray-500 dark:text-slate-300">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {entry.respondent && (
                            <span className="flex items-center gap-1 text-sm font-medium text-gray-800 dark:text-slate-200">
                              <User className="h-3 w-3 text-gray-400 dark:text-slate-500" /> {entry.respondent}
                            </span>
                          )}
                          {entry.email && (
                            <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-slate-400">
                              <Mail className="h-3 w-3" /> {entry.email}
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-slate-500">
                            <Clock className="h-3 w-3" /> {formatRelative(entry.submitted_at)}
                          </span>
                        </div>
                        <div className="flex gap-1.5 mt-1.5 flex-wrap">
                          {entry.actionable === true && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">{poll.request_type === 'KGT' ? 'Finalised' : 'Actionable'}</span>}
                          {entry.actionable === false && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{poll.request_type === 'KGT' ? 'Not Finalised' : 'Not Actionable'}</span>}
                          {cls === 'rms' && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400">RMS</span>}
                          {cls === 'non_rms' && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400">Non-RMS</span>}
                          {cls === 'partial' && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400">Partial</span>}
                          {currentStatus(i) === 'wip' && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">WIP</span>}
                          {currentStatus(i) === 'completed' && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400">Completed</span>}
                          {entry.reply_sent_at && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400">Replied</span>}
                        </div>
                      </div>
                      {isSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400 flex-shrink-0" />
                      ) : (
                        <div className="flex flex-wrap gap-1.5 flex-shrink-0 justify-end">
                          <button onClick={() => void handleActionable(i, entry.actionable === true ? null : true)} disabled={savingIndex !== null}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-colors ${entry.actionable === true ? 'bg-emerald-500 text-white border-emerald-500' : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100'}`}>
                            {poll.request_type === 'KGT' ? 'Finalised' : 'Actionable'}
                          </button>
                          <button onClick={() => void handleActionable(i, entry.actionable === false ? null : false)} disabled={savingIndex !== null}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-colors ${entry.actionable === false ? 'bg-slate-500 text-white border-slate-500' : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100'}`}>
                            {poll.request_type === 'KGT' ? 'Not Finalised' : 'Not Actionable'}
                          </button>
                          <button onClick={() => void handleStatus(i, 'wip')} disabled={savingIndex !== null}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-colors ${currentStatus(i) === 'wip' ? 'bg-amber-500 text-white border-amber-500' : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100'}`}>
                            WIP
                          </button>
                          <button onClick={() => void handleStatus(i, 'completed')} disabled={savingIndex !== null}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-colors ${currentStatus(i) === 'completed' ? 'bg-green-500 text-white border-green-500' : 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100'}`}>
                            Completed
                          </button>
                        </div>
                      )}
                      <button onClick={() => setExpandedIndex(isExpanded ? null : i)}
                        className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-600 transition-colors">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="mt-4 ml-10 space-y-4">
                        {entry.answers.length > 0 && (
                          <div className="space-y-2">
                            {entry.answers.map((a, qi) => (
                              <div key={qi} className="rounded-xl bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 px-4 py-3">
                                <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Q{qi + 1}: {a.question}</p>
                                <p className="text-sm text-gray-800 dark:text-slate-200">{a.answer || <span className="italic text-gray-400 dark:text-slate-500">No answer</span>}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-2">Classify</p>
                          <div className="flex gap-2">
                            {(Object.keys(CLS_CONFIG) as Classification[]).map(key => {
                              const isActive = cls === key
                              return (
                                <button key={key} disabled={savingIndex !== null}
                                  onClick={() => void handleClassification(i, isActive ? null : key)}
                                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${isActive ? CLS_CONFIG[key].active : CLS_CONFIG[key].inactive}`}>
                                  {CLS_CONFIG[key].label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-2">RMS Actions</p>
                          <div className="flex gap-2 flex-wrap">
                            <a href="https://rms.koenig-solutions.com/RMS_Feedback/RMSF.aspx" target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-100 transition-colors">
                              <ExternalLink className="h-3.5 w-3.5" /> Add RMS Task
                            </a>
                            <a href="https://rms.koenig-solutions.com/RMS_Feedback/RMSF.aspx" target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 px-3 py-1.5 text-xs font-semibold text-purple-700 dark:text-purple-400 hover:bg-purple-100 transition-colors">
                              <ExternalLink className="h-3.5 w-3.5" /> Add Non-RMS Task
                            </a>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Remarks</p>
                          <textarea placeholder="Add internal remarks..." value={entryRemarks[i] ?? entry.remarks ?? ''}
                            onChange={e => setEntryRemarks(p => ({ ...p, [i]: e.target.value }))} rows={2}
                            className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-200 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition resize-none" />
                          <button disabled={savingRemarksIndex === i} onClick={() => void handleSaveRemarks(i)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-1.5 text-xs font-semibold text-gray-700 dark:text-slate-300 hover:border-cyan-400 hover:text-cyan-600 transition-colors disabled:opacity-50">
                            {savingRemarksIndex === i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            Save Remarks
                          </button>
                        </div>
                        <div className="space-y-1.5 pt-1 border-t border-gray-100 dark:border-slate-700">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Reply to Respondent</p>
                            {entry.reply_sent_at && (
                              <span className="text-xs text-indigo-600 font-medium">Replied {formatRelative(entry.reply_sent_at)}</span>
                            )}
                          </div>
                          {entry.reply_sent_at && !entryReplies[i] && (
                            <div className="rounded-lg border border-indigo-100 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-2 text-xs text-indigo-800 dark:text-indigo-300 whitespace-pre-wrap">
                              {entry.reply_message}
                            </div>
                          )}
                          <textarea
                            placeholder={`Hi ${entry.respondent ?? 'there'},\n\nThank you for your response.\n\n[Your reply here]\n\nRegards,\nPriya`}
                            value={entryReplies[i] ?? ''} onChange={e => setEntryReplies(p => ({ ...p, [i]: e.target.value }))} rows={4}
                            className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-200 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition resize-none" />
                          <button disabled={sendingReplyIndex === i || !entryReplies[i]?.trim()} onClick={() => void handleSendReply(i)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50">
                            {sendingReplyIndex === i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                            {entry.reply_sent_at ? 'Send Again' : 'Send Reply'}
                          </button>
                        </div>
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

export default function ReportsPage() {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [managePoll, setManagePoll] = useState<Poll | null>(null)
  const [pushingRmsId, setPushingRmsId] = useState<string | null>(null)
  const [uploadingKoenigId, setUploadingKoenigId] = useState<string | null>(null)
  const [chartData, setChartData] = useState<ChartData | null>(null)
  const [chartFrom, setChartFrom] = useState('2026-05')
  const [chartTo, setChartTo] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const monthOpts = allMonthOptions()

  const fetchCharts = useCallback(async (from?: string, to?: string) => {
    const now = new Date()
    const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const resolvedFrom = from ?? '2026-05'
    const resolvedTo = to ?? defaultTo
    const params = new URLSearchParams({ from: resolvedFrom, to: resolvedTo })
    const charts = await fetch(`/api/reports/charts?${params}`).then(r => r.ok ? r.json() : null) as ChartData | null
    if (charts) setChartData(charts)
  }, [])

  const fetchPolls = useCallback(async () => {
    setLoading(true)
    try {
      const [pollsData] = await Promise.all([
        fetch('/api/polls').then(r => r.ok ? r.json() : []) as Promise<Poll[]>,
        fetchCharts(),
      ])
      setPolls(pollsData.filter(p => RELEASED_STATUSES.includes(p.status)))
    } catch { toast.error('Failed to load polls') }
    finally { setLoading(false) }
  }, [fetchCharts])

  useEffect(() => { void fetchPolls() }, [fetchPolls])

  const handleRangeChange = (from: string, to: string) => {
    setChartFrom(from)
    setChartTo(to)
    void fetchCharts(from, to)
  }

  const handleUploadToKoenig = async (poll: Poll) => {
    setUploadingKoenigId(poll.id)
    try {
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UPLOAD_TO_KOENIG' }),
      })
      if (!res.ok) throw new Error(await getErrorMessage(res, 'Upload to Koenig News failed'))
      const data = await res.json() as { entriesCount?: number }
      toast.success(`Results uploaded to Koenig News (${data.entriesCount} responses)`)
      void fetchPolls()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload to Koenig News failed')
    } finally { setUploadingKoenigId(null) }
  }

  const handlePushToRms = async (poll: Poll) => {
    setPushingRmsId(poll.id)
    try {
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'PUSH_TO_RMS' }),
      })
      if (!res.ok) throw new Error(await getErrorMessage(res, 'Push to Koenig News failed'))
      toast.success('Pushed to Koenig News successfully')
      void fetchPolls()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Push to Koenig News failed')
    } finally { setPushingRmsId(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-white">Reports & Follow-up</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{polls.length} released poll{polls.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => void fetchPolls()}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-sm transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Chart date range picker */}
      {chartData && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Date range:</span>
          <div className="flex items-center gap-2">
            <select value={chartFrom} onChange={e => handleRangeChange(e.target.value, chartTo)}
              className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 cursor-pointer">
              {monthOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="text-slate-400 text-sm">to</span>
            <select value={chartTo} onChange={e => handleRangeChange(chartFrom, e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 cursor-pointer">
              {monthOpts.filter(o => o.value >= chartFrom).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button onClick={() => { const now = new Date(); const t = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`; setChartFrom('2026-05'); setChartTo(t); void fetchCharts('2026-05', t) }}
            className="text-xs text-indigo-500 hover:text-indigo-700 underline underline-offset-2 transition-colors">
            Reset
          </button>
        </div>
      )}

      {/* Charts */}
      {chartData && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[
            {
              title: 'Month-wise Polls',
              subtitle: 'Polls released per month',
              data: chartData.monthlyPolls,
              color: '#6366f1',
              total: chartData.monthlyPolls.reduce((s, d) => s + d.count, 0),
            },
            {
              title: 'Month-wise Responses',
              subtitle: 'Responses collected per month',
              data: chartData.monthlyResponses,
              color: '#0891b2',
              total: chartData.monthlyResponses.reduce((s, d) => s + d.count, 0),
            },
          ].map(chart => (
            <div key={chart.title} className="rounded-2xl bg-white dark:bg-[#1a2035] border border-gray-100 dark:border-slate-700/50 shadow-sm p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-slate-100">{chart.title}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{chart.subtitle}</p>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 px-2.5 py-1">
                  <TrendingUp className="h-3 w-3 text-indigo-500" />
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{chart.total}</span>
                </div>
              </div>
              <div className="text-gray-800 dark:text-slate-300">
                <BarChart data={chart.data} color={chart.color} emptyText="No data yet" />
              </div>
              {/* month labels row */}
              <div className="flex justify-between mt-1 px-1">
                {chart.data.filter((_, i) => i === 0 || i === chart.data.length - 1).map(d => (
                  <span key={d.month} className="text-[10px] text-gray-400 dark:text-slate-500">{d.label}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl bg-white dark:bg-[#1e2535] shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : polls.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-gray-400">No released polls yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-slate-700/50">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">
              <span>Poll</span>
              <span className="text-right">Released</span>
              <span className="text-right">Status</span>
              <span className="text-right">Upload Responses</span>
              <span />
            </div>
            {polls.map(poll => (
              <div key={poll.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-slate-100 truncate">{poll.topic}</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{poll.department}</p>
                  </div>
                  <span className="text-sm text-gray-500 dark:text-slate-400 text-right whitespace-nowrap">
                    {poll.sent_at ? formatDateTime(poll.sent_at) : '—'}
                  </span>
                  <div className="flex justify-end">
                    <StatusBadge status={poll.status} />
                  </div>
                  <button onClick={() => void handleUploadToKoenig(poll)} disabled={uploadingKoenigId === poll.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300 hover:border-cyan-400 hover:text-cyan-600 transition-colors disabled:opacity-50 whitespace-nowrap">
                    {uploadingKoenigId === poll.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Upload Results
                  </button>
                  <button onClick={() => setManagePoll(poll)}
                    className="rounded-lg bg-cyan-50 dark:bg-cyan-900/20 px-3 py-1.5 text-xs font-semibold text-cyan-700 dark:text-cyan-400 hover:bg-cyan-100 transition-colors whitespace-nowrap">
                    Manage →
                  </button>
                </div>
                <div className="px-5 pb-3 flex items-center gap-3">
                  <button onClick={() => void handlePushToRms(poll)} disabled={pushingRmsId === poll.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-3 py-1.5 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:bg-teal-100 transition-colors disabled:opacity-50">
                    {pushingRmsId === poll.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    Push to Koenig News
                  </button>
                  {poll.rms_news_id && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      News ID: <span className="font-semibold text-teal-600 dark:text-teal-400">{poll.rms_news_id}</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {managePoll && <ManageDialog poll={managePoll} onClose={() => setManagePoll(null)} />}
    </div>
  )
}
