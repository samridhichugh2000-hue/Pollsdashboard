'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { MessageSquare, RefreshCw, CheckCircle2, XCircle, Clock, X, Send, ChevronDown, Search, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { formatRelative, getErrorMessage } from '@/lib/utils'
import { useQuarter, inQuarter } from '@/lib/use-quarter'
import { toast } from 'sonner'
import type { Poll, PollResponse } from '@/types'

type CardKey = 'total' | 'actionable' | 'pending' | 'process-improved' | 'non-actionable' | 'closed'

interface Entry {
  email?: string
  respondent?: string
  submitted_at: string
  answers: { question: string; answer: string }[]
  actionable?: boolean | null
  remarks?: string
  classification?: string | null
  status?: string | null
  reply_message?: string
  reply_sent_at?: string
}

interface PollWithEntries extends Poll {
  entries: Entry[] | null
  loading: boolean
  totalCount: number | null
  pendingCount: number | null
  actionableCount: number | null
  completedCount: number | null
  nonActionableCount: number | null
  rmsCount: number | null
  nonRmsCount: number | null
}

function parseEntries(response: PollResponse | null): Entry[] {
  if (!response?.response_data) return []
  try { return JSON.parse(response.response_data) as Entry[] } catch { return [] }
}

interface PopupEntry extends Entry {
  pollId: string
  pollTopic: string
  pollCreatedAt: string
}

const POPUP_TITLES: Record<'nonActionable' | 'rms' | 'nonRms', string> = {
  nonActionable: 'Non-Actionable Suggestions',
  rms: 'RMS Improvement Suggestions',
  nonRms: 'Non-RMS Improvement Suggestions',
}

function CrossPollEntriesModal({ title, entries, onClose }: { title: string; entries: PopupEntry[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 dark:border-slate-700 px-6 py-5">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-slate-100 text-lg leading-tight">{title}</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{entries.length} response{entries.length === 1 ? '' : 's'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5 space-y-3">
          {entries.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-500 py-6 text-center">No matching responses.</p>
          ) : (
            entries.map((e, i) => (
              <div key={i} className="rounded-xl border border-gray-100 dark:border-slate-700 p-4">
                <p className="font-semibold text-gray-900 dark:text-slate-100">{e.respondent ?? e.email ?? 'Anonymous'}</p>
                {e.email && <p className="text-xs text-gray-400 dark:text-slate-500">{e.email}</p>}
                <p className="text-xs text-purple-600 dark:text-purple-400 font-medium mt-1">{e.pollTopic}</p>
                {e.answers.map((a, qi) => (
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

const SENT_STATUSES = ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED', 'CLOSED', 'RESULTS_UPLOADED', 'RESULTS_SHARED']

function EntryRow({ pollId, entryIndex, entry, isKGT, onUpdated }: {
  pollId: string
  entryIndex: number
  entry: Entry
  isKGT?: boolean
  onUpdated: (idx: number, patch: Partial<Entry>) => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showReply, setShowReply] = useState(false)
  const [replyText, setReplyText] = useState('')

  const name = entry.respondent
    || entry.email?.split('@')[0]?.split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    || `Respondent ${entryIndex + 1}`

  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()

  const update = async (patch: Partial<Entry>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/polls/${pollId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UPDATE_ENTRY_ACTIONABLE',
          entryIndex,
          actionable: patch.actionable !== undefined ? patch.actionable : (entry.actionable ?? null),
          remarks: patch.remarks ?? entry.remarks ?? '',
          classification: patch.classification !== undefined ? patch.classification : (entry.classification ?? null),
          status: patch.status !== undefined ? patch.status : (entry.status ?? null),
        }),
      })
      if (res.ok) { onUpdated(entryIndex, patch); toast.success('Updated') }
      else toast.error(await getErrorMessage(res, 'Failed to update'))
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to update') }
    finally { setSaving(false) }
  }

  const sendReply = async () => {
    if (!replyText.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/polls/${pollId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REPLY_TO_RESPONDENT', entryIndex, replyMessage: replyText }),
      })
      if (res.ok) {
        onUpdated(entryIndex, { reply_message: replyText, reply_sent_at: new Date().toISOString() })
        setReplyText('')
        setShowReply(false)
        toast.success('Reply sent')
      } else {
        toast.error(await getErrorMessage(res, 'Failed to send reply'))
      }
    } catch { toast.error('Failed to send reply') }
    finally { setSaving(false) }
  }

  return (
    <div className={`border-b border-slate-100 dark:border-slate-700/60 last:border-0 ${open ? 'bg-slate-50/60 dark:bg-slate-800/30' : ''}`}>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/40 text-xs font-bold text-purple-600 dark:text-purple-300">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{name}</p>
          {entry.email && <p className="text-[11px] text-slate-400 truncate">{entry.email}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-slate-400">{formatRelative(entry.submitted_at)}</span>
          <span className="text-[10px] text-slate-400">{entry.answers.length}q</span>
          {entry.status === 'completed'
            ? <span className="text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">Completed</span>
            : entry.actionable === true
            ? <span className="text-[10px] font-semibold bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded-full">{isKGT ? 'Finalised' : 'Actionable'}</span>
            : entry.actionable === false
            ? <span className="text-[10px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-500 px-1.5 py-0.5 rounded-full">{isKGT ? 'Not Finalised' : 'Non-Act.'}</span>
            : <span className="text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full">Pending</span>
          }
          {entry.reply_sent_at && <span className="text-[10px] font-semibold bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400 px-1.5 py-0.5 rounded-full">Replied</span>}
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* Q&A */}
          <div className="rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            {entry.answers.map((a, i) => (
              <div key={i} className={`px-3 py-2.5 ${i > 0 ? 'border-t border-slate-100 dark:border-slate-700/60' : ''}`}>
                <p className="text-[10px] font-semibold text-slate-400 mb-1">Q{i + 1}. {a.question}</p>
                <p className="text-xs text-gray-700 dark:text-slate-200 whitespace-pre-wrap">{a.answer || '—'}</p>
              </div>
            ))}
          </div>

          {/* Our reply, if one was sent — kept visible so it's obvious which responses were actually actioned with a reply, not just marked */}
          {entry.reply_message && (
            <div className="rounded-xl border border-teal-100 dark:border-teal-800/60 bg-teal-50/60 dark:bg-teal-900/20 px-3 py-2.5">
              <p className="text-[10px] font-semibold text-teal-500 dark:text-teal-400 mb-1 flex items-center gap-1">
                <Send className="h-3 w-3" /> Our Reply{entry.reply_sent_at ? ` · ${formatRelative(entry.reply_sent_at)}` : ''}
              </p>
              <p className="text-xs text-teal-800 dark:text-teal-200 whitespace-pre-wrap">{entry.reply_message}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-1.5">
            {entry.actionable !== true && (
              <button disabled={saving} onClick={() => void update({ actionable: true })}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800 hover:bg-orange-100 disabled:opacity-50 transition-colors">
                {isKGT ? 'Mark Finalised' : 'Mark Actionable'}
              </button>
            )}
            {entry.actionable !== false && (
              <button disabled={saving} onClick={() => void update({ actionable: false })}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors">
                {isKGT ? 'Not Finalised' : 'Non-Actionable'}
              </button>
            )}
            {entry.actionable != null && (
              <button disabled={saving} onClick={() => void update({ actionable: null })}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 disabled:opacity-50 transition-colors">
                Reset Pending
              </button>
            )}
            <select disabled={saving} value={entry.status ?? ''}
              onChange={e => void update({ status: e.target.value || null })}
              className="text-[11px] font-medium px-2 py-1 rounded-lg bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-50">
              <option value="">Status…</option>
              <option value="wip">WIP</option>
              <option value="completed">Completed</option>
              <option value="process-improved">Process Improved</option>
            </select>
            {entry.email && (
              <button onClick={() => setShowReply(v => !v)}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 flex items-center gap-1 transition-colors">
                <Send className="h-3 w-3" />{entry.reply_sent_at ? 'Re-reply' : 'Reply'}
              </button>
            )}
          </div>

          {showReply && (
            <div className="flex gap-2 items-start">
              <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                placeholder="Type your reply…" rows={2}
                className="flex-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-gray-800 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-purple-400" />
              <button disabled={saving || !replyText.trim()} onClick={() => void sendReply()}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
                {saving ? '…' : 'Send'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FeedbackPageInner() {
  const [polls, setPolls] = useState<PollWithEntries[]>([])
  const [loadingPolls, setLoadingPolls] = useState(true)
  const quarter = useQuarter()
  const searchParams = useSearchParams()
  const [selectedPoll, setSelectedPoll] = useState<string | null>(searchParams.get('poll'))
  const [panelOpen, setPanelOpen] = useState(true)
  const [activeCard, setActiveCard] = useState<CardKey | null>((searchParams.get('card') as CardKey) ?? null)
  const [search, setSearch] = useState('')
  const [crossPollEntries, setCrossPollEntries] = useState<{ nonActionable: PopupEntry[]; rms: PopupEntry[]; nonRms: PopupEntry[] }>({ nonActionable: [], rms: [], nonRms: [] })
  const [openPopup, setOpenPopup] = useState<'nonActionable' | 'rms' | 'nonRms' | null>(null)
  const [closingPendingFor, setClosingPendingFor] = useState<string | null>(null)

  const fetchPolls = useCallback(async () => {
    setLoadingPolls(true)
    try {
      const data = await fetch('/api/polls').then(r => r.ok ? r.json() : []) as Poll[]
      const filtered = data.filter(p => SENT_STATUSES.includes(p.status))
      setPolls(filtered.map(p => ({ ...p, entries: null, loading: false, totalCount: null, pendingCount: null, actionableCount: null, completedCount: null, nonActionableCount: null, rmsCount: null, nonRmsCount: null })))
      setLoadingPolls(false)
      // fetch counts for all polls in parallel (background)
      const counts = await Promise.all(
        filtered.map(p =>
          fetch(`/api/polls/${p.id}`)
            .then(r => r.ok ? r.json() : {})
            .then((d: { response?: PollResponse | null }) => {
              const es = parseEntries(d.response ?? null)
              const tag = (e: Entry): PopupEntry => ({ ...e, pollId: p.id, pollTopic: p.topic, pollCreatedAt: p.created_at })
              return {
                id: p.id,
                total: es.length,
                pending: es.filter(e => e.actionable == null && e.status !== 'completed').length,
                actionable: es.filter(e => e.actionable === true).length,
                completed: es.filter(e => e.status === 'completed').length,
                nonActionable: es.filter(e => e.actionable === false).length,
                rms: es.filter(e => e.classification === 'rms').length,
                nonRms: es.filter(e => e.classification === 'non_rms').length,
                nonActionableEntries: es.filter(e => e.actionable === false).map(tag),
                rmsEntries: es.filter(e => e.classification === 'rms').map(tag),
                nonRmsEntries: es.filter(e => e.classification === 'non_rms').map(tag),
              }
            })
            .catch(() => ({ id: p.id, total: 0, pending: 0, actionable: 0, completed: 0, nonActionable: 0, rms: 0, nonRms: 0, nonActionableEntries: [] as PopupEntry[], rmsEntries: [] as PopupEntry[], nonRmsEntries: [] as PopupEntry[] }))
        )
      )
      setPolls(prev => prev.map(p => {
        const c = counts.find(x => x.id === p.id)
        return c ? { ...p, totalCount: c.total, pendingCount: c.pending, actionableCount: c.actionable, completedCount: c.completed, nonActionableCount: c.nonActionable, rmsCount: c.rms, nonRmsCount: c.nonRms } : p
      }))
      setCrossPollEntries({
        nonActionable: counts.flatMap(c => c.nonActionableEntries),
        rms: counts.flatMap(c => c.rmsEntries),
        nonRms: counts.flatMap(c => c.nonRmsEntries),
      })
    } catch { /**/ }
    finally { setLoadingPolls(false) }
  }, [])

  useEffect(() => { void fetchPolls() }, [fetchPolls])

  const loadEntries = useCallback(async (pollId: string) => {
    setPolls(prev => prev.map(p => p.id === pollId ? { ...p, loading: true } : p))
    try {
      const data = await fetch(`/api/polls/${pollId}`).then(r => r.ok ? r.json() : {}) as { response: PollResponse | null }
      const entries = parseEntries(data.response)
      setPolls(prev => prev.map(p => p.id === pollId ? { ...p, entries, loading: false, totalCount: entries.length, pendingCount: entries.filter(e => e.actionable == null && e.status !== 'completed').length, actionableCount: entries.filter(e => e.actionable === true).length, completedCount: entries.filter(e => e.status === 'completed').length, nonActionableCount: entries.filter(e => e.actionable === false).length, rmsCount: entries.filter(e => e.classification === 'rms').length, nonRmsCount: entries.filter(e => e.classification === 'non_rms').length } : p))
    } catch {
      setPolls(prev => prev.map(p => p.id === pollId ? { ...p, entries: [], loading: false } : p))
    }
  }, [])

  const closePendingResponses = useCallback(async (pollId: string) => {
    if (!confirm('Close pending responses? Anyone whose response was never marked actionable or not-actionable will get an automatic "no action taken" email, and those entries will be marked resolved. Do this only after you\'ve finished acting on individual responses.')) return
    setClosingPendingFor(pollId)
    try {
      const res = await fetch(`/api/polls/${pollId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CLOSE_PENDING_RESPONSES' }),
      })
      if (res.ok) {
        toast.success('Pending responses closed')
        await loadEntries(pollId)
      } else {
        toast.error(await getErrorMessage(res, 'Failed to close pending responses'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close pending responses')
    } finally {
      setClosingPendingFor(null)
    }
  }, [loadEntries])

  // Auto-load entries when arriving via ?poll= URL param
  useEffect(() => {
    if (!selectedPoll || polls.length === 0) return
    const poll = polls.find(p => p.id === selectedPoll)
    if (poll && poll.entries === null) void loadEntries(selectedPoll)
  }, [selectedPoll, polls.length, loadEntries])

  const selectPoll = (pollId: string) => {
    setSelectedPoll(pollId)
    setActiveCard(null)
    setSearch('')
    const poll = polls.find(p => p.id === pollId)
    if (poll?.entries === null) void loadEntries(pollId)
  }

  const patchEntry = (pollId: string, idx: number, patch: Partial<Entry>) => {
    setPolls(prev => prev.map(p => {
      if (p.id !== pollId || !p.entries) return p
      const updated = p.entries.map((e, i) => i === idx ? { ...e, ...patch } : e)
      return {
        ...p,
        entries: updated,
        totalCount: updated.length,
        pendingCount: updated.filter(e => e.actionable == null && e.status !== 'completed').length,
        actionableCount: updated.filter(e => e.actionable === true).length,
        completedCount: updated.filter(e => e.status === 'completed').length,
        nonActionableCount: updated.filter(e => e.actionable === false).length,
        rmsCount: updated.filter(e => e.classification === 'rms').length,
        nonRmsCount: updated.filter(e => e.classification === 'non_rms').length,
      }
    }))
  }

  const activePoll = polls.find(p => p.id === selectedPoll)
  const entries = activePoll?.entries ?? []

  // Poll list synced to the quarter selected in the header, same as Poll
  // Requests and Overview. A poll opened via a direct ?poll= link still loads
  // (activePoll is looked up against the full list above), even if it falls
  // outside the currently selected quarter.
  const visiblePolls = polls.filter(p => inQuarter(quarter, p.created_at))

  const counts: Record<CardKey, number> = {
    total:              entries.length,
    actionable:         entries.filter(e => e.actionable === true).length,
    pending:            entries.filter(e => e.actionable == null && e.status !== 'completed').length,
    'process-improved': entries.filter(e => e.status === 'process-improved').length,
    'non-actionable':   entries.filter(e => e.actionable === false).length,
    closed:             entries.filter(e => e.status === 'completed').length,
  }

  const statCards: { key: CardKey; label: string; color: string; bg: string; border: string; ring: string }[] = [
    { key: 'total',            label: 'Total Suggestions',  color: 'text-purple-700 dark:text-purple-300',   bg: 'bg-purple-50 dark:bg-purple-950/40',   border: 'border-purple-200 dark:border-purple-800',   ring: 'ring-purple-400' },
    { key: 'actionable',       label: 'Actionable',         color: 'text-orange-700 dark:text-orange-300',   bg: 'bg-orange-50 dark:bg-orange-950/40',   border: 'border-orange-200 dark:border-orange-800',   ring: 'ring-orange-400' },
    { key: 'pending',          label: 'Pending for Action', color: 'text-amber-700 dark:text-amber-300',     bg: 'bg-amber-50 dark:bg-amber-950/40',     border: 'border-amber-200 dark:border-amber-800',     ring: 'ring-amber-400' },
    { key: 'process-improved', label: 'Process Improved',   color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-200 dark:border-emerald-800', ring: 'ring-emerald-400' },
    { key: 'non-actionable',   label: 'Non-Actionable',     color: 'text-slate-600 dark:text-slate-300',     bg: 'bg-slate-50 dark:bg-slate-800/40',     border: 'border-slate-200 dark:border-slate-700',     ring: 'ring-slate-400' },
    { key: 'closed',           label: 'Closed',             color: 'text-teal-700 dark:text-teal-300',       bg: 'bg-teal-50 dark:bg-teal-950/40',       border: 'border-teal-200 dark:border-teal-800',       ring: 'ring-teal-400' },
  ]

  const filterEntry = (e: Entry): boolean => {
    const matchesCard = !activeCard
      || (activeCard === 'total')
      || (activeCard === 'actionable' && e.actionable === true)
      || (activeCard === 'pending' && e.actionable == null && e.status !== 'completed')
      || (activeCard === 'process-improved' && e.status === 'process-improved')
      || (activeCard === 'non-actionable' && e.actionable === false)
      || (activeCard === 'closed' && e.status === 'completed')
    const matchesSearch = !search || (e.respondent ?? e.email ?? '').toLowerCase().includes(search.toLowerCase())
      || e.answers.some(a => a.answer.toLowerCase().includes(search.toLowerCase()))
    return matchesCard && matchesSearch
  }

  const totalPolls = visiblePolls.length
  const sum = (key: keyof PollWithEntries) => visiblePolls.reduce((acc, p) => acc + ((p[key] as number | null) ?? 0), 0)
  const visibleIds = new Set(visiblePolls.map(p => p.id))
  const popupEntriesFor = (key: 'nonActionable' | 'rms' | 'nonRms') => crossPollEntries[key].filter(e => visibleIds.has(e.pollId))
  const globalCards: { label: string; sub: string | null; value: number; color: string; bg: string; border: string; popupKey?: 'nonActionable' | 'rms' | 'nonRms' }[] = [
    { label: 'Total Suggestions', sub: `out of ${totalPolls} polls`, value: sum('totalCount'), color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-50 dark:bg-purple-950/40', border: 'border-purple-200 dark:border-purple-800' },
    { label: 'Pending for Action', sub: null, value: sum('pendingCount'), color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-800' },
    { label: 'Suggestions Actioned', sub: null, value: sum('completedCount'), color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-200 dark:border-emerald-800' },
    { label: 'Non-Actionable', sub: null, value: sum('nonActionableCount'), color: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-50 dark:bg-slate-800/40', border: 'border-slate-200 dark:border-slate-700', popupKey: 'nonActionable' },
    { label: 'RMS Improvement', sub: null, value: sum('rmsCount'), color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-950/40', border: 'border-blue-200 dark:border-blue-800', popupKey: 'rms' },
    { label: 'Non-RMS Improvement', sub: null, value: sum('nonRmsCount'), color: 'text-teal-700 dark:text-teal-300', bg: 'bg-teal-50 dark:bg-teal-950/40', border: 'border-teal-200 dark:border-teal-800', popupKey: 'nonRms' },
  ]

  return (
    <div className="flex flex-col h-full gap-4 overflow-hidden">
      {/* Global stat cards */}
      <div className="grid grid-cols-6 gap-3 flex-shrink-0">
        {globalCards.map(({ label, sub, value, color, bg, border, popupKey }) => (
          <div key={label}
            onClick={popupKey ? () => setOpenPopup(popupKey) : undefined}
            className={`rounded-xl ${bg} border ${border} px-3 py-3 text-center ${popupKey ? 'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-current transition-shadow' : ''}`}
          >
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className={`text-[11px] font-medium mt-0.5 ${color} opacity-90 leading-tight`}>{label}</p>
            {sub && <p className={`text-[10px] mt-0.5 ${color} opacity-50 leading-tight`}>{sub}</p>}
          </div>
        ))}
      </div>

      {openPopup && (
        <CrossPollEntriesModal
          title={POPUP_TITLES[openPopup]}
          entries={popupEntriesFor(openPopup)}
          onClose={() => setOpenPopup(null)}
        />
      )}

      <div className="flex flex-1 gap-4 overflow-hidden min-h-0">
      {/* Left: Poll list */}
      <div className={`flex-shrink-0 flex flex-col gap-2 overflow-hidden transition-all duration-200 ${panelOpen ? 'w-64' : 'w-9'}`}>
        <div className="flex items-center justify-between flex-shrink-0">
          {panelOpen && (
            <div>
              <h1 className="text-base font-bold text-slate-800 dark:text-white">Poll Responses</h1>
              <p className="text-xs text-slate-400">{visiblePolls.length} polls</p>
            </div>
          )}
          <div className={`flex items-center gap-1 ${panelOpen ? '' : 'flex-col w-full'}`}>
            {panelOpen && (
              <button onClick={() => void fetchPolls()}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={() => setPanelOpen(v => !v)}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title={panelOpen ? 'Hide poll list' : 'Show poll list'}>
              {panelOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className={`flex-1 overflow-y-auto space-y-1 pr-0.5 ${panelOpen ? '' : 'hidden'}`}>
          {loadingPolls ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
            </div>
          ) : visiblePolls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <MessageSquare className="h-7 w-7 text-gray-200 dark:text-slate-700" />
              <p className="text-xs text-gray-400">No polls found</p>
            </div>
          ) : (
            visiblePolls.map(poll => {
              const isActive = selectedPoll === poll.id
              const respCount = poll.totalCount
              const pendingCount = poll.pendingCount
              return (
                <button key={poll.id} onClick={() => selectPoll(poll.id)}
                  className={`w-full flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all duration-150 ${
                    isActive
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'bg-white dark:bg-[#1e2535] hover:bg-slate-50 dark:hover:bg-slate-700/30 shadow-[0_1px_4px_rgba(0,0,0,0.05)]'
                  }`}>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold leading-snug truncate ${isActive ? 'text-white' : 'text-slate-800 dark:text-slate-100'}`}>{poll.topic}</p>
                    <p className={`text-[10px] mt-0.5 truncate ${isActive ? 'text-white/60' : 'text-slate-400'}`}>{poll.department}</p>
                    {respCount !== null && (
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className={`text-[10px] font-medium ${isActive ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>
                          {respCount} {respCount === 1 ? 'response' : 'responses'}
                        </span>
                        {pendingCount !== null && pendingCount > 0 && (
                          <>
                            <span className={`text-[10px] ${isActive ? 'text-white/40' : 'text-slate-300 dark:text-slate-600'}`}>·</span>
                            <span className={`text-[10px] font-medium ${isActive ? 'text-amber-200' : 'text-amber-600 dark:text-amber-400'}`}>
                              {pendingCount} pending
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Right: Responses panel */}
      <div className="flex-1 flex flex-col gap-3 overflow-hidden min-w-0">
        {!activePoll ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="h-10 w-10 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-400">Select a poll to view responses</p>
            </div>
          </div>
        ) : (
          <>
            {/* Poll title */}
            <div className="flex-shrink-0 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-800 dark:text-white truncate">{activePoll.topic}</h2>
                <p className="text-xs text-slate-400">{activePoll.department} · {activePoll.requested_by}</p>
              </div>
              {['CLOSED', 'RESULTS_SHARED', 'RESULTS_UPLOADED'].includes(activePoll.status) && (
                <button
                  onClick={() => void closePendingResponses(activePoll.id)}
                  disabled={closingPendingFor === activePoll.id}
                  className="flex-shrink-0 flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2535] px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  {closingPendingFor === activePoll.id
                    ? <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                    : <XCircle className="h-3.5 w-3.5" />}
                  Close Pending Responses
                </button>
              )}
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-6 gap-2 flex-shrink-0">
              {statCards.map(({ key, label, color, bg, border, ring }) => (
                <button key={key}
                  onClick={() => setActiveCard(prev => prev === key ? null : key)}
                  className={`rounded-xl ${bg} border ${border} px-2 py-2.5 text-center transition-all hover:scale-[1.02] ${activeCard === key ? `ring-2 ${ring} scale-[1.02]` : ''}`}>
                  <p className={`text-xl font-bold ${color}`}>{counts[key]}</p>
                  <p className={`text-[9px] font-medium mt-0.5 ${color} opacity-80 leading-tight`}>{label}</p>
                </button>
              ))}
            </div>

            {/* Search + filter bar */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search responses…"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2535] pl-9 pr-3 py-2 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
              {activeCard && (
                <button onClick={() => setActiveCard(null)}
                  className="flex items-center gap-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 px-3 py-2 text-xs text-purple-700 dark:text-purple-300 font-medium">
                  {statCards.find(c => c.key === activeCard)?.label}
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Responses list */}
            <div className="flex-1 overflow-y-auto rounded-2xl bg-white dark:bg-[#1e2535] shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.3)]">
              {activePoll.loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
                </div>
              ) : entries.filter(filterEntry).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-2">
                  <MessageSquare className="h-7 w-7 text-gray-200 dark:text-slate-700" />
                  <p className="text-sm text-gray-400">
                    {entries.length === 0 ? 'No responses yet' : 'No responses match this filter'}
                  </p>
                </div>
              ) : (
                entries.map((entry, idx) => filterEntry(entry) ? (
                  <EntryRow key={idx}
                    pollId={activePoll.id}
                    entryIndex={idx}
                    entry={entry}
                    isKGT={activePoll.request_type === 'KGT'}
                    onUpdated={(i, patch) => patchEntry(activePoll.id, i, patch)}
                  />
                ) : null)
              )}
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  )
}

export default function FeedbackPage() {
  return <Suspense><FeedbackPageInner /></Suspense>
}

