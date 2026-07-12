'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Plus, RefreshCw, Copy, X, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { PollsTable } from '@/components/polls/polls-table'
import { PollForm } from '@/components/polls/poll-form'
import type { Poll } from '@/types'

// ─── Quarter helpers ─────────────────────────────────────────────────────────

interface Quarter { key: string; label: string; short: string; from: Date; to: Date }

function buildQuarters(): Quarter[] {
  const DEFS = [
    { q: 1, months: [0, 1, 2],   label: 'Jan – Mar', short: 'Q1' },
    { q: 2, months: [3, 4, 5],   label: 'Apr – Jun', short: 'Q2' },
    { q: 3, months: [6, 7, 8],   label: 'Jul – Sep', short: 'Q3' },
    { q: 4, months: [9, 10, 11], label: 'Oct – Dec', short: 'Q4' },
  ]
  const now = new Date()
  const quarters: Quarter[] = []
  // App started Q2 2026
  let y = 2026, q = 2
  while (true) {
    const def = DEFS[q - 1]
    const from = new Date(y, def.months[0], 1)
    const to   = new Date(y, def.months[2] + 1, 0, 23, 59, 59, 999)
    quarters.push({ key: `${y}-Q${q}`, label: `${def.label} ${y}`, short: `${def.short} ${y}`, from, to })
    if (y === now.getFullYear() && def.months.includes(now.getMonth())) break
    q++; if (q > 4) { q = 1; y++ }
  }
  return quarters.reverse() // most recent first
}

function currentQuarterKey(): string {
  const now = new Date()
  const m = now.getMonth()
  const q = m < 3 ? 1 : m < 6 ? 2 : m < 9 ? 3 : 4
  return `${now.getFullYear()}-Q${q}`
}

// ─────────────────────────────────────────────────────────────────────────────

type CardKey = 'not-sent' | 'approval-pending' | 'active' | 'closed' | 'result-sir' | 'total'
const VALID_CARD_KEYS: CardKey[] = ['not-sent', 'approval-pending', 'active', 'closed', 'result-sir', 'total']

function filterByCard(polls: Poll[], key: CardKey): Poll[] {
  switch (key) {
    case 'not-sent':         return polls.filter(p => ['DETECTED', 'DRAFT', 'FORM_CREATED'].includes(p.status))
    case 'approval-pending': return polls.filter(p => p.status === 'AWAITING_APPROVAL')
    case 'active':           return polls.filter(p => ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status))
    case 'closed':           return polls.filter(p => ['CLOSED', 'RESULTS_UPLOADED', 'RESULTS_SHARED'].includes(p.status))
    case 'result-sir':       return polls.filter(p => p.status === 'CLOSED')
    case 'total':            return polls.filter(p => p.status !== 'ARCHIVED')
  }
}

function PollsContent() {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [activeCard, setActiveCard] = useState<CardKey | null>(null)
  const [quarters] = useState<Quarter[]>(() => buildQuarters())
  const [selectedQuarter, setSelectedQuarter] = useState<string>(() => currentQuarterKey())
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const searchParams = useSearchParams()
  const router = useRouter()
  const searchQuery = searchParams.get('q')?.toLowerCase().trim() ?? ''
  const cardParam = searchParams.get('card') as CardKey | null

  useEffect(() => {
    if (cardParam && VALID_CARD_KEYS.includes(cardParam)) setActiveCard(cardParam)
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

  const nonArchived = polls.filter(p => p.status !== 'ARCHIVED')

  // Persist selected quarter so the header can reflect it
  useEffect(() => {
    localStorage.setItem('selectedQuarter', selectedQuarter)
    window.dispatchEvent(new Event('quarterchange'))
  }, [selectedQuarter])

  const activeQuarter = selectedQuarter === 'all' ? null : quarters.find(q => q.key === selectedQuarter) ?? null

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
    if (activeQuarter) {
      result = result.filter(p => {
        const d = new Date(p.created_at)
        return d >= activeQuarter.from && d <= activeQuarter.to
      })
    }
    return result
  }

  const filterByTab = (tab: string): Poll[] => {
    let base: Poll[]
    switch (tab) {
      case 'inbox':    base = polls.filter(p => p.source === 'email'); break
      case 'via-form': base = polls.filter(p => p.source === 'dashboard'); break
      case 'active':   base = polls.filter(p => ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status)); break
      case 'not-sent': base = polls.filter(p => p.status === 'DRAFT'); break
      case 'closed':   base = polls.filter(p => ['CLOSED', 'ARCHIVED', 'REJECTED', 'RESULTS_UPLOADED', 'RESULTS_SHARED'].includes(p.status)); break
      default:         base = [...polls]
    }
    return applySearch(base)
  }

  const copyRequestLink = () => { navigator.clipboard.writeText(`${window.location.origin}/request`); toast.success('Request link copied') }
  const clearSearch = () => router.push('/polls')

  const statCards: { key: CardKey; label: string; value: number; color: string; bg: string; border: string; ring: string }[] = [
    { key: 'not-sent',         label: 'Not Sent for Approval',  value: filterByCard(nonArchived, 'not-sent').length,         color: 'text-cyan-700',    bg: 'bg-cyan-50',    border: 'border-cyan-200',    ring: 'ring-cyan-400' },
    { key: 'approval-pending', label: 'Approval Pending',        value: filterByCard(nonArchived, 'approval-pending').length, color: 'text-violet-700',  bg: 'bg-violet-50',  border: 'border-violet-200',  ring: 'ring-violet-400' },
    { key: 'active',           label: 'Active Polls',            value: filterByCard(nonArchived, 'active').length,           color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', ring: 'ring-emerald-400' },
    { key: 'closed',           label: 'Polls Closed',            value: filterByCard(nonArchived, 'closed').length,           color: 'text-slate-700',   bg: 'bg-slate-50',   border: 'border-slate-200',   ring: 'ring-slate-400' },
    { key: 'result-sir',       label: 'Result Not Sent (Sir/Poll Requester)',   value: filterByCard(nonArchived, 'result-sir').length,       color: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-200',  ring: 'ring-orange-400' },
    { key: 'total',            label: 'Total Polls',             value: nonArchived.length,                                   color: 'text-purple-700',  bg: 'bg-purple-50',  border: 'border-purple-200',  ring: 'ring-purple-400' },
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
            <p className="text-sm text-slate-500">
              {applySearch(nonArchived).length} poll{applySearch(nonArchived).length !== 1 ? 's' : ''}
              {activeQuarter ? <span className="text-purple-500"> · {activeQuarter.label}</span> : ''}
            </p>
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

      {/* Quarter filter */}
      <div className="relative">
        <button
          onClick={() => setDropdownOpen(o => !o)}
          className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2535] shadow-sm px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:border-purple-300 dark:hover:border-purple-600 transition-colors min-w-[180px]"
        >
          <span className="text-slate-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
          </span>
          <span className="flex-1 text-left font-medium">
            {selectedQuarter === 'all' ? 'All Time' : (quarters.find(q => q.key === selectedQuarter)?.label ?? 'Select quarter')}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
            <div className="absolute left-0 top-full mt-1 z-20 w-52 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2535] shadow-xl overflow-hidden">
              <div className="py-1">
                <button
                  onClick={() => { setSelectedQuarter('all'); setDropdownOpen(false) }}
                  className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${selectedQuarter === 'all' ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 font-semibold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                  All Time
                </button>
                <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                {quarters.map(q => (
                  <button
                    key={q.key}
                    onClick={() => { setSelectedQuarter(q.key); setDropdownOpen(false) }}
                    className={`w-full px-4 py-2.5 text-left text-sm transition-colors flex items-center justify-between ${selectedQuarter === q.key ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 font-semibold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                  >
                    <span>{q.label}</span>
                    {q.key === currentQuarterKey() && <span className="text-[10px] font-semibold bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 rounded-full">Current</span>}
                  </button>
                ))}
              </div>
            </div>
          </>
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
