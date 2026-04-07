'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, RefreshCw, Link2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { PollsTable } from '@/components/polls/polls-table'
import { PollForm } from '@/components/polls/poll-form'
import type { Poll } from '@/types'

export default function PollsPage() {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

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

  const filterByTab = (tab: string): Poll[] => {
    switch (tab) {
      case 'inbox':    return polls.filter(p => p.source === 'email')
      case 'manual':   return polls.filter(p => p.source === 'dashboard')
      case 'external': return polls.filter(p => p.source === 'external')
      case 'pending':  return polls.filter(p => p.status === 'AWAITING_APPROVAL')
      case 'active':   return polls.filter(p => ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status))
      default:         return polls
    }
  }

  const copyRequestLink = () => {
    const url = `${window.location.origin}/request`
    navigator.clipboard.writeText(url)
    toast.success('Request link copied to clipboard')
  }

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Polls</h2>
          <p className="text-sm text-white/50">{polls.length} total polls</p>
        </div>
        <div className="flex gap-2">
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
                <TabsTrigger value="all">All ({polls.length})</TabsTrigger>
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
              </TabsList>
            </div>
            {(['all', 'inbox', 'manual', 'external', 'pending', 'active'] as const).map((tab) => (
              <TabsContent key={tab} value={tab} className="mt-0">
                <PollsTable polls={filterByTab(tab)} onMarkClosed={handleMarkClosed} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  )
}
