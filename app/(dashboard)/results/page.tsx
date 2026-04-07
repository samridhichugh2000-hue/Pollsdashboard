export const dynamic = 'force-dynamic'

import { getAllPolls } from '@/lib/db/queries'
import { StatusBadge } from '@/components/polls/status-badge'
import { formatDateTime } from '@/lib/utils'
import Link from 'next/link'
import { ExternalLink, BarChart3 } from 'lucide-react'

export default async function ResultsPage() {
  const polls = await getAllPolls()
  const closedPolls = polls.filter(p => ['CLOSED', 'RESULTS_UPLOADED', 'ARCHIVED'].includes(p.status))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">Results & Follow-up</h2>
        <p className="text-sm text-white/50">{closedPolls.length} closed polls</p>
      </div>

      {closedPolls.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] flex items-center justify-center py-20">
          <p className="text-sm text-gray-400">No closed polls yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {closedPolls.map((poll) => (
            <div key={poll.id} className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] hover:-translate-y-0.5 transition-transform">
              <div className="p-5 border-b border-gray-100">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-50">
                    <BarChart3 className="h-4 w-4 text-cyan-600" />
                  </div>
                  <StatusBadge status={poll.status} />
                </div>
                <h3 className="mt-3 font-semibold text-gray-900 line-clamp-2">{poll.topic}</h3>
              </div>
              <div className="p-5 space-y-2 text-sm">
                <div className="flex justify-between text-gray-500">
                  <span>Department</span>
                  <span className="font-medium text-gray-800">{poll.department}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Closed</span>
                  <span className="font-medium text-gray-800">{formatDateTime(poll.closed_at)}</span>
                </div>
                {poll.results_uploaded_at && (
                  <div className="flex justify-between text-gray-500">
                    <span>Results</span>
                    <span className="font-medium text-emerald-600">Uploaded ✓</span>
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  {poll.ms_form_link && (
                    <a href={poll.ms_form_link} target="_blank" rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-gray-200 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                      Form <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <Link href={`/polls/${poll.id}`}
                    className="flex-1 flex items-center justify-center rounded-lg bg-cyan-50 py-1.5 text-xs font-semibold text-cyan-700 hover:bg-cyan-100">
                    Manage →
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
