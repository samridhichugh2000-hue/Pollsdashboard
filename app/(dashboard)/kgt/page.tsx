'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Plus, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { PollsTable } from '@/components/polls/polls-table'
import { KGTForm } from '@/components/polls/kgt-form'
import { getErrorMessage } from '@/lib/utils'
import type { Poll } from '@/types'

type CardKey = 'not-sent' | 'approval-pending' | 'active' | 'closed' | 'total'
const VALID_CARD_KEYS: CardKey[] = ['not-sent', 'approval-pending', 'active', 'closed', 'total']

function filterByCard(requests: Poll[], key: CardKey): Poll[] {
  switch (key) {
    case 'not-sent':         return requests.filter(p => ['DETECTED', 'DRAFT', 'FORM_CREATED'].includes(p.status))
    case 'approval-pending': return requests.filter(p => p.status === 'AWAITING_APPROVAL')
    case 'active':           return requests.filter(p => ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status))
    case 'closed':           return requests.filter(p => ['CLOSED', 'RESULTS_UPLOADED', 'RESULTS_SHARED'].includes(p.status))
    case 'total':            return requests
  }
}

function KGTContent() {
  const [requests, setRequests] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [activeCard, setActiveCard] = useState<CardKey | null>(null)

  const searchParams = useSearchParams()
  const router = useRouter()
  const searchQuery = searchParams.get('q')?.toLowerCase().trim() ?? ''
  const cardParam = searchParams.get('card') as CardKey | null

  useEffect(() => {
    setActiveCard(cardParam && VALID_CARD_KEYS.includes(cardParam) ? cardParam : null)
  }, [cardParam])

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/kgt')
      setRequests(await res.json() as Poll[])
    } catch { toast.error('Failed to load KGT requests') }
    finally { setLoading(false) }
  }, [])

  const handleRefresh = useCallback(async () => {
    try {
      const sync = await fetch('/api/kgt/inbox/sync', { method: 'POST' })
      const data = await sync.json() as { processed?: number; error?: string }
      if (sync.ok && data.processed && data.processed > 0) {
        toast.success(`${data.processed} new KGT request${data.processed > 1 ? 's' : ''} detected from inbox`)
      }
    } catch { /* silent */ }
    void fetchRequests()
  }, [fetchRequests])

  useEffect(() => { void fetchRequests() }, [fetchRequests])

  const handleMarkClosed = async (id: string) => {
    const res = await fetch(`/api/polls/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'MARK_CLOSED' }) })
    if (res.ok) toast.success('KGT request marked as closed')
    else toast.error(await getErrorMessage(res, 'Failed to mark closed'))
    void fetchRequests()
  }
  const handleArchive = async (id: string) => {
    const res = await fetch(`/api/polls/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ARCHIVE' }) })
    if (res.ok) toast.success('KGT request archived')
    else toast.error(await getErrorMessage(res, 'Failed to archive'))
    void fetchRequests()
  }
  const handleReject = async (id: string) => {
    const res = await fetch(`/api/polls/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'REJECT' }) })
    if (res.ok) toast.success('KGT request rejected')
    else toast.error(await getErrorMessage(res, 'Failed to reject'))
    void fetchRequests()
  }

  const nonArchived = requests.filter(p => p.status !== 'ARCHIVED')

  const applySearch = (list: Poll[]): Poll[] => {
    if (!searchQuery) return list
    return list.filter(p =>
      p.topic.toLowerCase().includes(searchQuery) ||
      p.status.toLowerCase().includes(searchQuery) ||
      (p.requested_by ?? '').toLowerCase().includes(searchQuery)
    )
  }

  const filterByTab = (tab: string): Poll[] => {
    let base: Poll[]
    switch (tab) {
      case 'inbox':    base = nonArchived.filter(p => p.source === 'email'); break
      case 'manual':   base = nonArchived.filter(p => p.source === 'dashboard'); break
      case 'active':   base = nonArchived.filter(p => ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status)); break
      case 'not-sent': base = nonArchived.filter(p => p.status === 'DRAFT'); break
      case 'closed':   base = nonArchived.filter(p => ['CLOSED', 'REJECTED', 'RESULTS_UPLOADED', 'RESULTS_SHARED'].includes(p.status)); break
      default:         base = [...nonArchived]
    }
    return applySearch(base)
  }

  const clearSearch = () => router.push('/kgt')

  const statCards: { key: CardKey; label: string; value: number; color: string; bg: string; border: string; ring: string }[] = [
    { key: 'not-sent',         label: 'Not Sent for Approval', value: applySearch(filterByCard(nonArchived, 'not-sent')).length,         color: 'text-cyan-700',    bg: 'bg-cyan-50',    border: 'border-cyan-200',    ring: 'ring-cyan-400' },
    { key: 'approval-pending', label: 'Approval Pending',       value: applySearch(filterByCard(nonArchived, 'approval-pending')).length, color: 'text-violet-700',  bg: 'bg-violet-50',  border: 'border-violet-200',  ring: 'ring-violet-400' },
    { key: 'active',           label: 'Active',                 value: applySearch(filterByCard(nonArchived, 'active')).length,           color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', ring: 'ring-emerald-400' },
    { key: 'closed',           label: 'Closed',                 value: applySearch(filterByCard(nonArchived, 'closed')).length,           color: 'text-slate-700',   bg: 'bg-slate-50',   border: 'border-slate-200',   ring: 'ring-slate-400' },
    { key: 'total',            label: 'Total KGT Requests',     value: applySearch(nonArchived).length,                                   color: 'text-purple-700',  bg: 'bg-purple-50',  border: 'border-purple-200',  ring: 'ring-purple-400' },
  ]

  const tableActions = {
    onMarkClosed: handleMarkClosed,
    onArchive: handleArchive,
    onReject: handleReject,
    onDeleted: () => void fetchRequests(),
    linkBase: '/kgt',
  }

  const cardRequests = activeCard ? applySearch(filterByCard(nonArchived, activeCard)) : null
  const activeCardLabel = activeCard ? statCards.find(c => c.key === activeCard)?.label : null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">KGT Requests</h2>
          <p className="text-sm text-slate-500">{nonArchived.length} total KGT opportunities</p>
        </div>
        <div className="flex gap-2">
          {searchQuery && (
            <Button variant="outline" size="sm" className="border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm" onClick={clearSearch}>
              <X className="mr-1.5 h-3.5 w-3.5" /> Clear Search
            </Button>
          )}
          <Button variant="outline" size="sm" className="border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm" onClick={() => void handleRefresh()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-teal-600 text-white hover:bg-teal-700 font-semibold shadow-sm">
                <Plus className="mr-1.5 h-3.5 w-3.5" /> New KGT
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create New KGT Request</DialogTitle></DialogHeader>
              <KGTForm onSuccess={() => { setOpen(false); toast.success('KGT request created!'); void fetchRequests() }} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
                <span className="ml-2 text-gray-400 dark:text-slate-500 font-normal">({cardRequests!.length})</span>
              </p>
              <button onClick={() => setActiveCard(null)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors">
                <X className="h-3.5 w-3.5" /> Clear filter
              </button>
            </div>
            <PollsTable polls={cardRequests!} {...tableActions} />
          </>
        ) : (
          <Tabs defaultValue="all">
            <div className="border-b border-gray-100 dark:border-slate-700 px-5 pt-4">
              <TabsList className="bg-gray-100 dark:bg-slate-800 mb-0 flex-wrap h-auto gap-1">
                <TabsTrigger value="all">All ({filterByTab('all').length})</TabsTrigger>
                <TabsTrigger value="inbox">Inbox ({filterByTab('inbox').length})</TabsTrigger>
                <TabsTrigger value="manual">Manual ({filterByTab('manual').length})</TabsTrigger>
                <TabsTrigger value="active">Active ({filterByTab('active').length})</TabsTrigger>
                <TabsTrigger value="not-sent">Not Sent ({filterByTab('not-sent').length})</TabsTrigger>
                <TabsTrigger value="closed">Closed ({filterByTab('closed').length})</TabsTrigger>
              </TabsList>
            </div>
            {(['all', 'inbox', 'manual', 'active', 'not-sent', 'closed'] as const).map(tab => (
              <TabsContent key={tab} value={tab} className="mt-0">
                <PollsTable polls={filterByTab(tab)} {...tableActions} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  )
}

export default function KGTPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
      </div>
    }>
      <KGTContent />
    </Suspense>
  )
}
