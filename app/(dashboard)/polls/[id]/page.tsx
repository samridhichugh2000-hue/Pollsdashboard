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
    fetch(`/api/polls/${id}`)
      .then((r) => {
        if (r.status === 404) { setNotFound404(true); return null }
        return r.json()
      })
      .then((d) => { if (d) setData(d as PollDetailData) })
      .catch(console.error)
      .finally(() => setLoading(false))
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
