'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3, X, Loader2, RefreshCw, Clock, User, Mail, ChevronDown, ChevronUp, Save, ExternalLink, Send, Upload, Zap } from 'lucide-react'
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
  remarks?: string
  classification?: 'rms' | 'non_rms' | 'partial' | null
  status?: 'wip' | 'completed' | null
  reply_message?: string
  reply_sent_at?: string
}

type Classification = 'rms' | 'non_rms' | 'partial'

const CLS_CONFIG: Record<Classification, { label: string; active: string; inactive: string }> = {
  rms:     { label: 'RMS',     active: 'bg-blue-500 text-white border-blue-500',     inactive: 'border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600' },
  non_rms: { label: 'Non-RMS', active: 'bg-purple-500 text-white border-purple-500', inactive: 'border-gray-200 text-gray-600 hover:border-purple-400 hover:text-purple-600' },
  partial: { label: 'Partial', active: 'bg-orange-500 text-white border-orange-500', inactive: 'border-gray-200 text-gray-600 hover:border-orange-400 hover:text-orange-600' },
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
    if (!res.ok) throw new Error('Failed to save')
  }

  const handleActionable = async (index: number, value: boolean | null) => {
    setSavingIndex(index)
    try {
      const cls = currentCls(index)
      const remarks = entryRemarks[index] ?? entries[index]?.remarks ?? ''
      await patchEntry(index, value, cls, remarks)
      setEntries(prev => prev.map((e, i) => i === index ? { ...e, actionable: value } : e))
    } catch { toast.error('Failed to save — please try again') }
    finally { setSavingIndex(null) }
  }

  const handleClassification = async (index: number, value: Classification | null) => {
    setSavingIndex(index)
    setEntryClassifications(prev => ({ ...prev, [index]: value }))
    try {
      const remarks = entryRemarks[index] ?? entries[index]?.remarks ?? ''
      await patchEntry(index, entries[index]?.actionable ?? null, value, remarks)
      setEntries(prev => prev.map((e, i) => i === index ? { ...e, classification: value } : e))
    } catch { toast.error('Failed to save — please try again') }
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
    } catch { toast.error('Failed to save remarks') }
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
    } catch {
      toast.error('Failed to save — please try again')
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
      if (!res.ok) {
        const d = await res.json() as { error: string }
        throw new Error(d.error)
      }
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
    pending: entries.filter(e => e.actionable == null).length,
    rms: entries.filter(e => e.classification === 'rms').length,
    nonRms: entries.filter(e => e.classification === 'non_rms').length,
    partial: entries.filter(e => e.classification === 'partial').length,
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl">
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
        {entries.length > 0 && (
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 space-y-2">
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Total',          value: stats.total,         cls: 'bg-gray-100 text-gray-700' },
                { label: 'Actionable',     value: stats.actionable,    cls: 'bg-emerald-100 text-emerald-700' },
                { label: 'Not Actionable', value: stats.notActionable, cls: 'bg-slate-100 text-slate-600' },
                { label: 'Pending Review', value: stats.pending,       cls: 'bg-amber-100 text-amber-700' },
              ].map(s => (
                <div key={s.label} className={`rounded-xl px-3 py-2 text-center ${s.cls}`}>
                  <p className="text-xl font-bold leading-none">{s.value}</p>
                  <p className="mt-1 text-xs font-medium">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'RMS',     value: stats.rms,    cls: 'bg-blue-100 text-blue-700' },
                { label: 'Non-RMS', value: stats.nonRms, cls: 'bg-purple-100 text-purple-700' },
                { label: 'Partial', value: stats.partial, cls: 'bg-orange-100 text-orange-700' },
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
              <BarChart3 className="h-10 w-10 text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500">No responses collected yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {entries.map((entry, i) => {
                const isExpanded = expandedIndex === i
                const isSaving = savingIndex === i
                const cls = currentCls(i)
                return (
                  <div key={i} className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">{i + 1}</div>
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
                        <div className="flex gap-1.5 mt-1.5 flex-wrap">
                          {entry.actionable === true && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Actionable</span>}
                          {entry.actionable === false && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Not Actionable</span>}
                          {cls === 'rms' && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">RMS</span>}
                          {cls === 'non_rms' && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Non-RMS</span>}
                          {cls === 'partial' && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">Partial</span>}
                          {currentStatus(i) === 'wip' && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">WIP</span>}
                          {currentStatus(i) === 'completed' && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Completed</span>}
                          {entry.reply_sent_at && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">Replied</span>}
                        </div>
                      </div>
                      {isSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400 flex-shrink-0" />
                      ) : (
                        <div className="flex flex-wrap gap-1.5 flex-shrink-0 justify-end">
                          <button onClick={() => void handleActionable(i, entry.actionable === true ? null : true)} disabled={savingIndex !== null}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-colors ${entry.actionable === true ? 'bg-emerald-500 text-white border-emerald-500' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                            Actionable
                          </button>
                          <button onClick={() => void handleActionable(i, entry.actionable === false ? null : false)} disabled={savingIndex !== null}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-colors ${entry.actionable === false ? 'bg-slate-500 text-white border-slate-500' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}>
                            Not Actionable
                          </button>
                          <button onClick={() => void handleStatus(i, 'wip')} disabled={savingIndex !== null}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-colors ${currentStatus(i) === 'wip' ? 'bg-amber-500 text-white border-amber-500' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
                            WIP
                          </button>
                          <button onClick={() => void handleStatus(i, 'completed')} disabled={savingIndex !== null}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-colors ${currentStatus(i) === 'completed' ? 'bg-green-500 text-white border-green-500' : 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'}`}>
                            Completed
                          </button>
                        </div>
                      )}
                      <button onClick={() => setExpandedIndex(isExpanded ? null : i)}
                        className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="mt-4 ml-10 space-y-4">
                        {entry.answers.length > 0 && (
                          <div className="space-y-2">
                            {entry.answers.map((a, qi) => (
                              <div key={qi} className="rounded-xl bg-white border border-gray-100 px-4 py-3">
                                <p className="text-xs font-medium text-gray-500 mb-1">Q{qi + 1}: {a.question}</p>
                                <p className="text-sm text-gray-800">{a.answer || <span className="italic text-gray-400">No answer</span>}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Classify</p>
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
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">RMS Actions</p>
                          <div className="flex gap-2 flex-wrap">
                            <a href="https://rms.koenig-solutions.com/RMS_Feedback/RMSF.aspx" target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors">
                              <ExternalLink className="h-3.5 w-3.5" /> Add RMS Task
                            </a>
                            <a href="https://rms.koenig-solutions.com/RMS_Feedback/RMSF.aspx" target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 transition-colors">
                              <ExternalLink className="h-3.5 w-3.5" /> Add Non-RMS Task
                            </a>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Remarks</p>
                          <textarea placeholder="Add internal remarks..." value={entryRemarks[i] ?? entry.remarks ?? ''}
                            onChange={e => setEntryRemarks(p => ({ ...p, [i]: e.target.value }))} rows={2}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition resize-none" />
                          <button disabled={savingRemarksIndex === i} onClick={() => void handleSaveRemarks(i)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-xs font-semibold text-gray-700 hover:border-cyan-400 hover:text-cyan-600 transition-colors disabled:opacity-50">
                            {savingRemarksIndex === i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            Save Remarks
                          </button>
                        </div>
                        <div className="space-y-1.5 pt-1 border-t border-gray-100">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Reply to Respondent</p>
                            {entry.reply_sent_at && (
                              <span className="text-xs text-indigo-600 font-medium">Replied {formatRelative(entry.reply_sent_at)}</span>
                            )}
                          </div>
                          {entry.reply_sent_at && !entryReplies[i] && (
                            <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800 whitespace-pre-wrap">
                              {entry.reply_message}
                            </div>
                          )}
                          <textarea
                            placeholder={`Hi ${entry.respondent ?? 'there'},\n\nThank you for your response.\n\n[Your reply here]\n\nRegards,\nPriya`}
                            value={entryReplies[i] ?? ''} onChange={e => setEntryReplies(p => ({ ...p, [i]: e.target.value }))} rows={4}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition resize-none" />
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
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [pushingRmsId, setPushingRmsId] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetPoll = useRef<Poll | null>(null)

  const fetchPolls = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch('/api/polls').then(r => r.ok ? r.json() : []) as Poll[]
      setPolls(data.filter(p => RELEASED_STATUSES.includes(p.status)))
    } catch { toast.error('Failed to load polls') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void fetchPolls() }, [fetchPolls])

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const handleUploadClick = (poll: Poll) => {
    uploadTargetPoll.current = poll
    uploadInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const poll = uploadTargetPoll.current
    if (!file || !poll) return
    e.target.value = ''
    setUploadingId(poll.id)
    try {
      const base64 = await fileToBase64(file)
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UPLOAD_RESPONSES', fileBase64: base64, fileName: file.name }),
      })
      if (!res.ok) throw new Error((await res.json() as { error: string }).error)
      toast.success('Responses uploaded successfully')
      void fetchPolls()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally { setUploadingId(null) }
  }

  const handlePushToRms = async (poll: Poll) => {
    setPushingRmsId(poll.id)
    try {
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'PUSH_TO_RMS' }),
      })
      if (!res.ok) throw new Error((await res.json() as { error: string }).error)
      toast.success('Pushed to RMS successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Push to RMS failed')
    } finally { setPushingRmsId(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Reports & Follow-up</h1>
          <p className="text-sm text-slate-500">{polls.length} released poll{polls.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => void fetchPolls()}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 shadow-sm transition-colors">
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
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              <span>Poll</span>
              <span className="text-right">Released</span>
              <span className="text-right">Status</span>
              <span className="text-right">Upload Responses</span>
              <span />
            </div>
            {polls.map(poll => (
              <div key={poll.id} className="hover:bg-gray-50 transition-colors">
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-5 py-3">
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
                  <button onClick={() => handleUploadClick(poll)} disabled={uploadingId === poll.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-cyan-400 hover:text-cyan-600 transition-colors disabled:opacity-50 whitespace-nowrap">
                    {uploadingId === poll.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Upload
                  </button>
                  <button onClick={() => setManagePoll(poll)}
                    className="rounded-lg bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-700 hover:bg-cyan-100 transition-colors whitespace-nowrap">
                    Manage →
                  </button>
                </div>
                <div className="px-5 pb-3">
                  <button onClick={() => void handlePushToRms(poll)} disabled={pushingRmsId === poll.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-100 transition-colors disabled:opacity-50">
                    {pushingRmsId === poll.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    Push to RMS
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {managePoll && <ManageDialog poll={managePoll} onClose={() => setManagePoll(null)} />}
      <input ref={uploadInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => void handleFileChange(e)} />
    </div>
  )
}
