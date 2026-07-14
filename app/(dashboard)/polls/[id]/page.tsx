'use client'

import { useEffect, useState } from 'react'
import { useParams, notFound } from 'next/navigation'
import { PollDetail } from '@/components/polls/poll-detail'
import type { Poll, PollApproval, AuditLog, PollResponse } from '@/types'

interface PollDetailData {
  poll: Poll
  approvals: PollApproval[]
  auditLogs: AuditLog[]
  response: PollResponse | null
}

export default function PollDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<PollDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound404, setNotFound404] = useState(false)

  useEffect(() => {
    // Guard against navigating poll A -> poll B before A's request resolves;
    // without this, A's slower response can land after B's and overwrite
    // poll B's freshly-loaded detail with poll A's stale data.
    let ignore = false
    setLoading(true)
    fetch(`/api/polls/${id}`)
      .then((r) => {
        if (r.status === 404) { if (!ignore) setNotFound404(true); return null }
        return r.json()
      })
      .then((d) => { if (d && !ignore) setData(d as PollDetailData) })
      .catch(console.error)
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [id])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-100" />
        <div className="h-48 animate-pulse rounded-xl bg-gray-100" />
        <div className="h-48 animate-pulse rounded-xl bg-gray-100" />
      </div>
    )
  }

  if (notFound404 || !data) return notFound()

  return (
    <PollDetail
      poll={data.poll}
      approvals={data.approvals}
      auditLogs={data.auditLogs}
      response={data.response}
    />
  )
}
