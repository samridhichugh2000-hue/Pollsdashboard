'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Eye, XCircle, Trash2 } from 'lucide-react'
import { StatusBadge } from './status-badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatRelative, isApprovalOverdue } from '@/lib/utils'
import type { Poll } from '@/types'

interface PollsTableProps {
  polls: Poll[]
  onMarkClosed?: (pollId: string) => void
  onArchive?: (pollId: string) => void
}

export function PollsTable({ polls, onMarkClosed, onArchive }: PollsTableProps) {
  const [confirmClose, setConfirmClose] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null)

  if (polls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-gray-400">No polls found.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Topic</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Department</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Requested By</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Source</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Created</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Form</th>
            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {polls.map((poll) => {
            const overdue = poll.status === 'AWAITING_APPROVAL' && isApprovalOverdue(poll.updated_at)

            return (
              <tr key={poll.id} className="group hover:bg-gray-50 transition-colors">
                <td className="max-w-[200px] px-5 py-3.5">
                  <p className="truncate font-medium text-gray-900">{poll.topic}</p>
                  {overdue && <span className="text-xs font-medium text-rose-500">Overdue</span>}
                </td>
                <td className="px-5 py-3.5 text-gray-500">{poll.department}</td>
                <td className="px-5 py-3.5 text-gray-500 max-w-[140px] truncate">{poll.requested_by}</td>
                <td className="px-5 py-3.5">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    poll.source === 'email' ? 'bg-cyan-50 text-cyan-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {poll.source === 'email' ? 'Inbox' : 'Manual'}
                  </span>
                </td>
                <td className="px-5 py-3.5"><StatusBadge status={poll.status} /></td>
                <td className="px-5 py-3.5 text-gray-400 text-xs">
                  <span title={formatDateTime(poll.created_at)}>{formatRelative(poll.created_at)}</span>
                </td>
                <td className="px-5 py-3.5">
                  {poll.ms_form_link ? (
                    <a href={poll.ms_form_link} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-cyan-600 hover:underline">
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" asChild className="h-7 w-7">
                      <Link href={`/polls/${poll.id}`}><Eye className="h-3.5 w-3.5" /></Link>
                    </Button>
                    {onMarkClosed && !['CLOSED', 'RESULTS_UPLOADED', 'ARCHIVED'].includes(poll.status) && (
                      confirmClose === poll.id ? (
                        <div className="flex items-center gap-1">
                          <Button variant="destructive" size="sm" className="h-6 text-xs"
                            onClick={() => { onMarkClosed(poll.id); setConfirmClose(null) }}>
                            Confirm
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 text-xs"
                            onClick={() => setConfirmClose(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => setConfirmClose(poll.id)}>
                          <XCircle className="h-3.5 w-3.5 text-rose-400" />
                        </Button>
                      )
                    )}
                    {onArchive && poll.status !== 'ARCHIVED' && (
                      confirmArchive === poll.id ? (
                        <div className="flex items-center gap-1">
                          <Button variant="destructive" size="sm" className="h-6 text-xs"
                            onClick={() => { onArchive(poll.id); setConfirmArchive(null) }}>
                            Archive
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 text-xs"
                            onClick={() => setConfirmArchive(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => setConfirmArchive(poll.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-rose-500" />
                        </Button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
