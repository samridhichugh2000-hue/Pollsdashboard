'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getErrorMessage } from '@/lib/utils'

interface Sender { id: string; name: string; email: string }

interface KGTFormProps {
  onSuccess?: () => void
}

export function KGTForm({ onSuccess }: KGTFormProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [senders, setSenders] = useState<Sender[]>([])
  const defaultDeadline = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0] })()

  const [form, setForm] = useState({
    topic: '',
    requested_by: '',
    custom_requested_by: '',
    deadline: defaultDeadline,
    issue_details: '',
    remarks: '',
  })

  useEffect(() => {
    // KGT requesters are a distinct list from regular poll senders (Nupur,
    // Rohit Aggarwal, Nabila, Bhargavi, Sakshi, HR) — managed in Settings.
    fetch('/api/kgt-senders').then(r => r.ok ? r.json() : []).then(snds => {
      setSenders(snds as Sender[])
    }).catch(() => {})
  }, [])

  const set = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const requestedBy = form.requested_by === '__custom__' ? form.custom_requested_by : form.requested_by

    setLoading(true)
    try {
      const res = await fetch('/api/kgt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: form.topic,
          requested_by: requestedBy,
          source: 'dashboard',
          deadline: form.deadline || undefined,
          issue_details: form.issue_details || undefined,
          remarks: form.remarks || undefined,
        }),
      })
      if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to create KGT request'))
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</div>
      )}

      {/* Topic */}
      <div className="space-y-1.5">
        <Label htmlFor="topic">KGT Opportunity / Topic *</Label>
        <Input id="topic" placeholder="e.g. Meta WhatsApp Business API Management"
          value={form.topic} onChange={e => set('topic', e.target.value)} required />
      </div>

      {/* Requested By — select from KGT authorized senders */}
      <div className="space-y-1.5">
        <Label htmlFor="requested_by">Requested By</Label>
        <Select value={form.requested_by} onValueChange={v => set('requested_by', v)}>
          <SelectTrigger id="requested_by">
            <SelectValue placeholder="Select requester" />
          </SelectTrigger>
          <SelectContent>
            {senders.map(s => (
              <SelectItem key={s.id} value={s.email}>
                {s.name} — {s.email}
              </SelectItem>
            ))}
            <SelectItem value="__custom__">Other (enter manually)</SelectItem>
          </SelectContent>
        </Select>
        {form.requested_by === '__custom__' && (
          <Input placeholder="Name or email" value={form.custom_requested_by}
            onChange={e => set('custom_requested_by', e.target.value)} className="mt-2" />
        )}
      </div>

      {/* Issue details — dropped into the "Issue Summary" section of the default draft */}
      <div className="space-y-1.5">
        <Label htmlFor="issue_details">Issue Summary <span className="font-normal text-gray-400">(optional)</span></Label>
        <Textarea id="issue_details" placeholder="Describe the issue and actions taken so far..."
          value={form.issue_details} onChange={e => set('issue_details', e.target.value)} rows={4} />
        <p className="text-xs text-gray-400">Leave blank to fill in manually after the draft is created — everything below is fully editable before sending.</p>
      </div>

      {/* Deadline */}
      <div className="space-y-1.5">
        <Label htmlFor="deadline">Response Deadline</Label>
        <Input
          id="deadline"
          type="date"
          min={new Date().toISOString().split('T')[0]}
          value={form.deadline}
          onChange={e => set('deadline', e.target.value || defaultDeadline)}
        />
      </div>

      {/* Remarks */}
      <div className="space-y-1.5">
        <Label htmlFor="remarks">Remarks / Notes</Label>
        <Textarea id="remarks" placeholder="Internal context..." value={form.remarks}
          onChange={e => set('remarks', e.target.value)} rows={3} />
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {loading ? 'Creating KGT Request...' : 'Create KGT Request'}
      </Button>
    </form>
  )
}
