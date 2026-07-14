'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { PollsTable } from '@/components/polls/polls-table'
import type { Poll } from '@/types'

export default function ArchivedPage() {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPolls = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch('/api/polls').then(r => r.ok ? r.json() : []) as Poll[]
      setPolls(data.filter((p: Poll) => p.status === 'ARCHIVED'))
    } catch {
      toast.error('Failed to load archived polls')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchPolls() }, [fetchPolls])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Archived / Closed</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{polls.length} archived polls</p>
        </div>
        <button onClick={() => void fetchPolls()}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-sm transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>
      <div className="rounded-2xl bg-white dark:bg-[#1e2535] shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : (
          <PollsTable
            polls={polls}
            onDeleted={() => void fetchPolls()}
            onUnarchived={() => void fetchPolls()}
          />
        )}
      </div>
    </div>
  )
}
