'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Plus, RefreshCw, Copy, X } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { PollsTable } from '@/components/polls/polls-table'
import { PollForm } from '@/components/polls/poll-form'
import type { Poll } from '@/types'

function PollsContent() {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  const searchParams = useSearchParams()
  const router = useRouter()
  const searchQuery = searchParams.get('q')?.toLowerCase().trim() ?? ''

  const fetchPolls = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/polls')
      setPolls(await res.json() as Poll[])
    } catch { toast.error('Failed to load polls') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void fetchPolls() }, [fetchPolls])

  const handleMarkClosed = async (pollId: string) => {
    await fetch(`/api/polls/${pollId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'MARK_CLOSED' }),
    })
    toast.success('Poll marked as closed')
    void fetchPolls()
  }

  const handleArchive = async (pollId: string) => {
    const res = await fetch(`/api/polls/${pollId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ARCHIVE' }),
    })
    if (res.ok) {
      toast.success('Poll archived')
    } else {
      const data = await res.json() as { error?: string }
      toast.error(data.error ?? 'Failed to archive poll')
    }
    void fetchPolls()
  }

  const handleReject = async (pollId: string) => {
    const res = await fetch(`/api/polls/${pollId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'REJECT' }),
    })
    if (res.ok) {
      toast.success('Poll request rejected')
    } else {
      const data = await res.json() as { error?: string }
      toast.error(data.error ?? 'Failed to reject poll')
    }
    void fetchPolls()
  }

  const active = (p: Poll) => p.status !== 'ARCHIVED' && p.status !== 'REJECTED'

  // Apply search filter on top of all tab filters
  const applySearch = (list: Poll[]): Poll[] => {
    if (!searchQuery) return list
    return list.filter(p =>
      p.topic.toLowerCase().includes(searchQuery) ||
      (p.department ?? '').toLowerCase().includes(searchQuery) ||
      p.status.toLowerCase().includes(searchQuery) ||
      (p.requested_by ?? '').toLowerCase().includes(searchQuery)
    )
  }

  const filterByTab = (tab: string): Poll[] => {
    let base: Poll[]
    switch (tab) {
      case 'inbox':    base = polls.filter(p => active(p) && p.source === 'email'); break
      case 'manual':   base = polls.filter(p => active(p) && p.source === 'dashboard'); break
      case 'external': base = polls.filter(p => active(p) && p.source === 'external'); break
      case 'pending':  base = polls.filter(p => active(p) && p.status === 'AWAITING_APPROVAL'); break
      case 'active':   base = polls.filter(p => active(p) && ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status)); break
      case 'archived': base = polls.filter(p => p.status === 'ARCHIVED' || p.status === 'REJECTED'); break
      default:         base = polls.filter(p => active(p))
    }
    return applySearch(base)
  }

  const copyRequestLink = () => {
    const url = `${window.location.origin}/request`
    navigator.clipboard.writeText(url)
    toast.success('Request link copied to clipboard')
  }

  const clearSearch = () => router.push('/polls')

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Polls</h2>
          {searchQuery ? (
            <p className="text-sm text-white/50">
              Results for &quot;{searchQuery}&quot; — {filterByTab('all').length} found
            </p>
          ) : (
            <p className="text-sm text-white/50">{polls.filter(p => active(p)).length} total polls</p>
          )}
        </div>
        <div className="flex gap-2">
          {searchQuery && (
            <Button variant="outline" size="sm"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
              onClick={clearSearch}>
              <X className="mr-1.5 h-3.5 w-3.5" /> Clear Search
            </Button>
          )}
          <Button variant="outline" size="sm"
            className="border-white/20 bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
            onClick={copyRequestLink}>
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy Request Link
          </Button>
          <Button variant="outline" size="sm"
            className="border-white/20 bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
            onClick={fetchPolls}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-white text-cyan-700 hover:bg-white/90 font-semibold shadow-lg">
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

      {/* Search active banner */}
      {searchQuery && (
        <div className="flex items-center gap-2 rounded-xl bg-white/10 backdrop-blur-sm px-4 py-2.5 text-sm text-white/80">
          Showing results across all tabs for &quot;{searchQuery}&quot;
          <button onClick={clearSearch} className="ml-auto text-white/50 hover:text-white transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* White card with tabs */}
      <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : (
          <Tabs defaultValue="all">
            <div className="border-b border-gray-100 px-5 pt-4">
              <TabsList className="bg-gray-100 mb-0 flex-wrap h-auto gap-1">
                <TabsTrigger value="all">All ({filterByTab('all').length})</TabsTrigger>
                <TabsTrigger value="inbox">Inbox ({filterByTab('inbox').length})</TabsTrigger>
                <TabsTrigger value="manual">Manual ({filterByTab('manual').length})</TabsTrigger>
                <TabsTrigger value="external" className="relative">
                  External ({filterByTab('external').length})
                  {filterByTab('external').length > 0 && (
                    <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white">
                      {filterByTab('external').length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="pending">Pending ({filterByTab('pending').length})</TabsTrigger>
                <TabsTrigger value="active">Active ({filterByTab('active').length})</TabsTrigger>
                <TabsTrigger value="archived">Archived ({filterByTab('archived').length})</TabsTrigger>
              </TabsList>
            </div>
            {(['all', 'inbox', 'manual', 'external', 'pending', 'active'] as const).map((tab) => (
              <TabsContent key={tab} value={tab} className="mt-0">
                <PollsTable polls={filterByTab(tab)} onMarkClosed={handleMarkClosed} onArchive={handleArchive} onReject={handleReject} />
              </TabsContent>
            ))}
            <TabsContent value="archived" className="mt-0">
              <PollsTable polls={filterByTab('archived')} />
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
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
      </div>
    }>
      <PollsContent />
    </Suspense>
  )
}
