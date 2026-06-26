'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { Mail, Link2, RefreshCw, Copy, Check } from 'lucide-react'
import { StatusBadge } from '@/components/polls/status-badge'
import type { Poll } from '@/types'

function formatPollId(poll: Poll, index: number): string {
  const year = new Date(poll.created_at).getFullYear()
  return `POLL-${year}-${String(index + 1).padStart(3, '0')}`
}

function miniCount(polls: Poll[], statuses: string[]) {
  return polls.filter(p => statuses.includes(p.status)).length
}

function CopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy}
      className="flex-shrink-0 flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-cyan-600 hover:bg-cyan-50 transition-colors">
      {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
    </button>
  )
}

function SourcePanel({
  icon: Icon,
  iconColor,
  title,
  subtitle,
  polls,
  formUrl,
  allPolls,
}: {
  icon: React.ElementType
  iconColor: string
  title: string
  subtitle: string
  polls: Poll[]
  formUrl?: string
  allPolls: Poll[]
}) {
  const active = miniCount(polls, ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'])
  const awaiting = miniCount(polls, ['AWAITING_APPROVAL'])
  const draft = miniCount(polls, ['DETECTED', 'DRAFT', 'FORM_CREATED'])
  const closed = miniCount(polls, ['CLOSED', 'RESULTS_UPLOADED'])

  // Compute sequential IDs relative to the full poll list sorted by created_at
  const sorted = [...allPolls].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  return (
    <div className="flex flex-col rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${iconColor}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-400">{subtitle}</p>
        </div>
      </div>

      {/* Form link (only for shareable panel) */}
      {formUrl && (
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400 mb-1">Form link</p>
          <div className="flex items-center gap-2">
            <p className="text-xs font-mono text-cyan-600 truncate flex-1">{formUrl}</p>
            <CopyButton url={formUrl} />
          </div>
        </div>
      )}

      {/* Mini stat cards */}
      <div className="grid grid-cols-4 gap-px bg-gray-100 border-b border-gray-100">
        {[
          { label: 'Active', value: active },
          { label: 'Awaiting Approval', value: awaiting },
          { label: 'Draft', value: draft },
          { label: 'Closed', value: closed },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white px-3 py-3 text-center">
            <p className="text-xl font-bold text-gray-800">{value}</p>
            <p className="text-xs text-gray-400 mt-0.5 leading-tight">{label}</p>
          </div>
        ))}
      </div>

      {/* Poll list */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {polls.length === 0 ? (
          <p className="text-center py-10 text-sm text-gray-400">No requests</p>
        ) : (
          polls.map(poll => {
            const globalIndex = sorted.findIndex(p => p.id === poll.id)
            const pollId = formatPollId(poll, globalIndex >= 0 ? globalIndex : 0)
            return (
              <div key={poll.id} className="px-5 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-purple-600 mb-0.5">{pollId}</p>
                    <p className="text-sm font-medium text-gray-900 truncate">{poll.topic}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-400">{poll.requested_by}</span>
                    <StatusBadge status={poll.status} />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default function PollRequestsPage() {
  const [polls, setPolls] = useState<Poll[]>([])
  const [formUrl, setFormUrl] = useState('')

  const fetchPolls = useCallback(async () => {
    try {
      const data = await fetch('/api/polls').then(r => r.ok ? r.json() : []) as Poll[]
      setPolls(data.filter(p => p.status !== 'ARCHIVED'))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    void fetchPolls()
    setFormUrl(`${window.location.origin}/request`)
  }, [fetchPolls])

  const mailboxPolls = polls.filter(p => p.source === 'email')
  const formPolls = polls.filter(p => p.source !== 'email')
  const total = polls.length

  const PENDING_STATUSES = ['DETECTED', 'DRAFT', 'FORM_CREATED', 'AWAITING_APPROVAL', 'APPROVED', 'RMS_TASK_CREATED', 'REJECTED', 'RMS_TASK_FAILED', 'RMS_PUBLISH_FAILED', 'SEND_FAILED']
  const totalPending = polls.filter(p => PENDING_STATUSES.includes(p.status)).length
  const totalPendingMailbox = mailboxPolls.filter(p => PENDING_STATUSES.includes(p.status)).length
  const totalPendingForm = formPolls.filter(p => PENDING_STATUSES.includes(p.status)).length

  const notSentForApproval = polls.filter(p => ['DETECTED', 'DRAFT', 'FORM_CREATED'].includes(p.status)).length
  const approvalPending = polls.filter(p => p.status === 'AWAITING_APPROVAL').length
  const activePolls = polls.filter(p => ['SENT', 'REMINDER_SENT', 'RMS_PUBLISHED'].includes(p.status)).length
  const pollsClosed = polls.filter(p => ['CLOSED', 'RESULTS_UPLOADED'].includes(p.status)).length
  const resultNotSentSir = polls.filter(p => ['CLOSED', 'RESULTS_UPLOADED'].includes(p.status) && !p.rms_task_id).length
  const resultNotSentVoter = polls.filter(p => p.status === 'CLOSED').length

  const statCards = [
    { label: 'Not Sent for Approval', value: notSentForApproval, color: 'text-cyan-700', bg: 'bg-cyan-50', border: 'border-cyan-200' },
    { label: 'Approval Pending', value: approvalPending, color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
    { label: 'Active Polls', value: activePolls, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    { label: 'Polls Closed', value: pollsClosed, color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200' },
    { label: 'Result Not Sent (Sir)', value: resultNotSentSir, color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
    { label: 'Result Not Sent (Voter)', value: resultNotSentVoter, color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
    { label: 'Total Polls', value: total, color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Poll Requests</h1>
          <p className="text-sm text-slate-500">{polls.length} total · {mailboxPolls.length} via mailbox · {formPolls.length} via form</p>
        </div>
        <button onClick={() => void fetchPolls()}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 shadow-sm transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* 7 Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {statCards.map(({ label, value, color, bg, border }) => (
          <div key={label} className={`rounded-2xl ${bg} border ${border} px-4 py-4 text-center`}>
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
            <p className={`text-xs font-medium mt-1 ${color} opacity-80`}>{label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SourcePanel
          icon={Mail}
          iconColor="bg-blue-50 text-blue-500"
          title="Mailbox Requests"
          subtitle={`${mailboxPolls.length} request${mailboxPolls.length !== 1 ? 's' : ''} via email / mailbox`}
          polls={mailboxPolls}
          allPolls={polls}
        />
        <SourcePanel
          icon={Link2}
          iconColor="bg-cyan-50 text-cyan-500"
          title="Shareable Form Requests"
          subtitle={`${formPolls.length} request${formPolls.length !== 1 ? 's' : ''} via the generated form link`}
          polls={formPolls}
          formUrl={formUrl}
          allPolls={polls}
        />
      </div>

      {/* Total Pending Polls */}
      <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-sm font-semibold text-gray-700">Total Pending Polls</p>
          <span className="text-xs text-gray-400">Polls not yet active or closed</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-xs text-gray-400 mb-0.5">Mailbox</p>
            <p className="text-xl font-bold text-blue-600">{totalPendingMailbox}</p>
          </div>
          <div className="h-8 w-px bg-gray-100" />
          <div className="text-center">
            <p className="text-xs text-gray-400 mb-0.5">Form</p>
            <p className="text-xl font-bold text-cyan-600">{totalPendingForm}</p>
          </div>
          <div className="h-8 w-px bg-gray-100" />
          <div className="text-center">
            <p className="text-xs text-gray-400 mb-0.5">Total</p>
            <p className="text-xl font-bold text-purple-600">{totalPending}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
