'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Plus, RefreshCw, Copy, X, CalendarRange } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { PollsTable } from '@/components/polls/polls-table'
import { PollForm } from '@/components/polls/poll-form'
import { useQuarter, inQuarter } from '@/lib/use-quarter'
import type { Poll } from '@/types'

type CardKey = 'not-sent' | 'approval-pending' | 'active' | 'closed' | 'result-sir' | 'total' | 'pending'
const VALID_CARD_KEYS: CardKey[] = ['not-sent', 'approval-pending', 'active', 'closed', 'result-sir', 'total', 'pending']

// Same status set as the dashboard's "Total Pending Polls" KPI (app/api/overview/route.ts
// PENDING_STATUSES) — that card's onClick used to route here with no matching
// filter at all, so clicking it landed on the fully unfiltered list instead
// of reproducing the count it showed.
const PENDING_STATUSES = ['DETECTED', 'DRAFT', 'FORM_CREATED', 'AWAITING_APPROVAL', 'APPROVED', 'RMS_TASK_CREATED', 'REJECTED', 'RMS_TASK_FAILED', 'RMS_PUBLISH_FAILED', 'SEND_FAILED']

function filterByCard(polls: Poll[], key: CardKey): Poll[] {
  switch (key) {
    case 'not-sent':         return polls.filter(p => ['DETECTED', 'DRAFT', 'FORM_CREATED'].includes(p.status))
    case 'approval-pending': return polls.filter(p => p.status === 'AWAITING_APPROVAL')
    case 'active':           return polls.filter(p => ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status))
    case 'closed':           return polls.filter(p => ['CLOSED', 'RESULTS_UPLOADED', 'RESULTS_SHARED'].includes(p.status))
    case 'result-sir':       return polls.filter(p => p.status === 'CLOSED')
    case 'total':            return polls.filter(p => p.status !== 'ARCHIVED')
    case 'pending':          return polls.filter(p => PENDING_STATUSES.includes(p.status))
  }
}

function PollsContent() {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [activeCard, setActiveCard] = useState<CardKey | null>(null)

  const quarter = useQuarter()
  const searchParams = useSearchParams()
  const router = useRouter()
  const searchQuery = searchParams.get('q')?.toLowerCase().trim() ?? ''
  const cardParam = searchParams.get('card') as CardKey | null

  useEffect(() => {
    // Previously only ever SET activeCard when a card param was present, and
    // never cleared it — navigating from a filtered dashboard link back to
    // plain /polls (e.g. via the sidebar) left the old filter stuck active.
    setActiveCard(cardParam && VALID_CARD_KEYS.includes(cardParam) ? cardParam : null)
  }, [cardParam])

  const fetchPolls = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/polls')
      setPolls(await res.json() as Poll[])
    } catch { toast.error('Failed to load polls') }
    finally { setLoading(false) }
  }, [])

  const handleRefresh = useCallback(async () => {
    try {
      const sync = await fetch('/api/inbox/sync', { method: 'POST' })
      const data = await sync.json() as { processed?: number; error?: string }
      if (sync.ok && data.processed && data.processed > 0) {
        toast.success(`${data.processed} new poll${data.processed > 1 ? 's' : ''} detected from inbox`)
      }
    } catch { /* silent */ }
    void fetchPolls()
  }, [fetchPolls])

  useEffect(() => { void fetchPolls() }, [fetchPolls])

  const handleMarkClosed = async (pollId: string) => {
    await fetch(`/api/polls/${pollId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'MARK_CLOSED' }) })
    toast.success('Poll marked as closed')
    void fetchPolls()
  }
  const handleCloseExternal = async (pollId: string) => {
    const res = await fetch(`/api/polls/${pollId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'CLOSE_EXTERNAL_REQUEST' }) })
    if (res.ok) toast.success('Poll closed and requester notified')
    else { const d = await res.json() as { error?: string }; toast.error(d.error ?? 'Failed to close poll') }
    void fetchPolls()
  }
  const handleArchive = async (pollId: string) => {
    const res = await fetch(`/api/polls/${pollId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ARCHIVE' }) })
    if (res.ok) toast.success('Poll archived')
    else { const d = await res.json() as { error?: string }; toast.error(d.error ?? 'Failed to archive poll') }
    void fetchPolls()
  }
  const handleReject = async (pollId: string) => {
    const res = await fetch(`/api/polls/${pollId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'REJECT' }) })
    if (res.ok) toast.success('Poll request rejected')
    else { const d = await res.json() as { error?: string }; toast.error(d.error ?? 'Failed to reject poll') }
    void fetchPolls()
  }
  const handleRejectExternal = async (pollId: string, reason: string) => {
    const res = await fetch(`/api/polls/${pollId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'REJECT_EXTERNAL_REQUEST', reason }) })
    if (res.ok) toast.success('Poll request rejected and requester notified')
    else { const d = await res.json() as { error?: string }; toast.error(d.error ?? 'Failed to reject poll') }
    void fetchPolls()
  }

  // Restrict everything on this page to the quarter chosen in the header.
  // Archived polls have their own dedicated page and must never show up here.
  const quarterPolls = polls.filter(p => inQuarter(quarter, p.created_at) && p.status !== 'ARCHIVED')
  const nonArchived = quarterPolls

  const applySearch = (list: Poll[]): Poll[] => {
    let result = list
    if (searchQuery) {
      result = result.filter(p =>
        p.topic.toLowerCase().includes(searchQuery) ||
        (p.department ?? '').toLowerCase().includes(searchQuery) ||
        p.status.toLowerCase().includes(searchQuery) ||
        (p.requested_by ?? '').toLowerCase().includes(searchQuery)
      )
    }
    if (dateFrom) {
      const from = new Date(dateFrom); from.setHours(0, 0, 0, 0)
      result = result.filter(p => new Date(p.created_at) >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo); to.setHours(23, 59, 59, 999)
      result = result.filter(p => new Date(p.created_at) <= to)
    }
    return result
  }

  const filterByTab = (tab: string): Poll[] => {
    let base: Poll[]
    switch (tab) {
      case 'inbox':    base = quarterPolls.filter(p => p.source === 'email'); break
      case 'via-form': base = quarterPolls.filter(p => p.source === 'dashboard'); break
      case 'active':   base = quarterPolls.filter(p => ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status)); break
      case 'not-sent': base = quarterPolls.filter(p => p.status === 'DRAFT'); break
      case 'closed':   base = quarterPolls.filter(p => ['CLOSED', 'REJECTED', 'RESULTS_UPLOADED', 'RESULTS_SHARED'].includes(p.status)); break
      default:         base = [...quarterPolls]
    }
    return applySearch(base)
  }

  const hasDateFilter = dateFrom || dateTo
  const clearDateFilter = () => { setDateFrom(''); setDateTo('') }
  const copyRequestLink = () => { navigator.clipboard.writeText(`${window.location.origin}/request`); toast.success('Request link copied') }
  const clearSearch = () => router.push('/polls')

  // Every count below is run through applySearch, same as cardPolls further
  // down — otherwise the printed number disagrees with what actually shows
  // once the user has a search term or date filter active and then clicks
  // a card (the card used to show the unfiltered count, but clicking it
  // opened the search/date-narrowed table).
  const statCards: { key: CardKey; label: string; value: number; color: string; bg: string; border: string; ring: string }[] = [
    { key: 'not-sent',         label: 'Not Sent for Approval',  value: applySearch(filterByCard(nonArchived, 'not-sent')).length,         color: 'text-cyan-700',    bg: 'bg-cyan-50',    border: 'border-cyan-200',    ring: 'ring-cyan-400' },
    { key: 'approval-pending', label: 'Approval Pending',        value: applySearch(filterByCard(nonArchived, 'approval-pending')).length, color: 'text-violet-700',  bg: 'bg-violet-50',  border: 'border-violet-200',  ring: 'ring-violet-400' },
    { key: 'active',           label: 'Active Polls',            value: applySearch(filterByCard(nonArchived, 'active')).length,           color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', ring: 'ring-emerald-400' },
    { key: 'closed',           label: 'Polls Closed',            value: applySearch(filterByCard(nonArchived, 'closed')).length,           color: 'text-slate-700',   bg: 'bg-slate-50',   border: 'border-slate-200',   ring: 'ring-slate-400' },
    { key: 'result-sir',       label: 'Result Not Sent (Sir/Poll Requester)',   value: applySearch(filterByCard(nonArchived, 'result-sir')).length,       color: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-200',  ring: 'ring-orange-400' },
    { key: 'total',            label: 'Total Polls',             value: applySearch(nonArchived).length,                                   color: 'text-purple-700',  bg: 'bg-purple-50',  border: 'border-purple-200',  ring: 'ring-purple-400' },
  ]

  const tableActions = {
    onMarkClosed: handleMarkClosed,
    onCloseExternal: handleCloseExternal,
    onArchive: handleArchive,
    onReject: handleReject,
    onRejectExternal: handleRejectExternal,
    onDeleted: () => void fetchPolls(),
  }

  const cardPolls = activeCard ? applySearch(filterByCard(nonArchived, activeCard)) : null
  const activeCardLabel = activeCard ? statCards.find(c => c.key === activeCard)?.label : null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Poll Requests</h2>
          {searchQuery ? (
            <p className="text-sm text-slate-500">Results for &quot;{searchQuery}&quot; — {filterByTab('all').length} found</p>
          ) : (
            <p className="text-sm text-slate-500">{nonArchived.length} total polls</p>
          )}
        </div>
        <div className="flex gap-2">
          {searchQuery && (
            <Button variant="outline" size="sm" className="border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm" onClick={clearSearch}>
              <X className="mr-1.5 h-3.5 w-3.5" /> Clear Search
            </Button>
          )}
          <Button variant="outline" size="sm" className="border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm" onClick={copyRequestLink}>
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy Request Link
          </Button>
          <Button variant="outline" size="sm" className="border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm" onClick={() => void handleRefresh()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-teal-600 text-white hover:bg-teal-700 font-semibold shadow-sm">
                <Plus className="mr-1.5 h-3.5 w-3.5" /> New Poll
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create New Poll</DialogTitle></DialogHeader>
              <PollForm onSuccess={() => { setOpen(false); toast.success('Poll created!'); void fetchPolls() }} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {statCards.map(({ key, label, value, color, bg, border, ring }) => (
          <button
            key={key}
            onClick={() => setActiveCard(prev => prev === key ? null : key)}
            className={`rounded-2xl ${bg} dark:bg-[#1e2535] border ${border} dark:border-slate-700 px-4 py-4 text-center cursor-pointer transition-all hover:shadow-md hover:scale-[1.02] ${activeCard === key ? `ring-2 ${ring} shadow-md scale-[1.02]` : ''}`}
          >
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
            <p className={`text-xs font-medium mt-1 ${color} opacity-80`}>{label}</p>
          </button>
        ))}
      </div>

      {/* Date range filter */}
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2535] shadow-sm px-4 py-2.5">
        <CalendarRange className="h-4 w-4 text-slate-400 flex-shrink-0" />
        <span className="text-xs text-slate-400 flex-shrink-0">From</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="bg-transparent text-sm text-slate-700 dark:text-slate-300 [color-scheme:light] dark:[color-scheme:dark] outline-none cursor-pointer" />
        <span className="text-xs text-slate-400 flex-shrink-0">To</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined}
          className="bg-transparent text-sm text-slate-700 dark:text-slate-300 [color-scheme:light] dark:[color-scheme:dark] outline-none cursor-pointer" />
        {hasDateFilter && (
          <button onClick={clearDateFilter} className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Search active banner */}
      {searchQuery && (
        <div className="flex items-center gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300">
          Showing results across all tabs for &quot;{searchQuery}&quot;
          <button onClick={clearSearch} className="ml-auto text-slate-400 hover:text-slate-600 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl bg-white dark:bg-[#1e2535] shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : activeCard ? (
          <>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-slate-700">
              <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">
                Showing: <span className="text-cyan-600">{activeCardLabel}</span>
                <span className="ml-2 text-gray-400 dark:text-slate-500 font-normal">({cardPolls!.length} polls)</span>
              </p>
              <button onClick={() => setActiveCard(null)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors">
                <X className="h-3.5 w-3.5" /> Clear filter
              </button>
            </div>
            <PollsTable polls={cardPolls!} {...tableActions} />
          </>
        ) : (
          <Tabs defaultValue="all">
            <div className="border-b border-gray-100 dark:border-slate-700 px-5 pt-4">
              <TabsList className="bg-gray-100 dark:bg-slate-800 mb-0 flex-wrap h-auto gap-1">
                <TabsTrigger value="all">All ({filterByTab('all').length})</TabsTrigger>
                <TabsTrigger value="inbox">Inbox ({filterByTab('inbox').length})</TabsTrigger>
                <TabsTrigger value="via-form">Via Form ({filterByTab('via-form').length})</TabsTrigger>
                <TabsTrigger value="active">Active Polls ({filterByTab('active').length})</TabsTrigger>
                <TabsTrigger value="not-sent">Not Sent for Approval ({filterByTab('not-sent').length})</TabsTrigger>
                <TabsTrigger value="closed">Closed ({filterByTab('closed').length})</TabsTrigger>
              </TabsList>
            </div>
            {(['all', 'inbox', 'via-form', 'active', 'not-sent'] as const).map(tab => (
              <TabsContent key={tab} value={tab} className="mt-0">
                <PollsTable polls={filterByTab(tab)} {...tableActions} />
              </TabsContent>
            ))}
            <TabsContent value="closed" className="mt-0">
              <PollsTable polls={filterByTab('closed')} onDeleted={() => void fetchPolls()} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}

export default function PollsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
      </div>
    }>
      <PollsContent />
    </Suspense>
  )
}
