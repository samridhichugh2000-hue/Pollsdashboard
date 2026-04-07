'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { HuntGroup } from '@/components/settings/hunt-groups-manager'

interface Sender { id: string; name: string; email: string }

interface PollFormProps {
  onSuccess?: () => void
}

const TIMELINE_STEPS = [
  { label: 'Request Created', desc: 'Poll is logged and AI drafts the email & questions' },
  { label: 'Sent for Approval', desc: 'Draft shared with requester for sign-off' },
  { label: 'Poll Released', desc: 'Email + Poll Form sent to target audience' },
  { label: 'Reminder Sent', desc: 'Follow-up reminder on next working day' },
  { label: 'Results Collected', desc: 'Responses fetched and shared with EA' },
]

export function PollForm({ onSuccess }: PollFormProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [questions, setQuestions] = useState<string[]>([''])
  const [huntGroups, setHuntGroups] = useState<HuntGroup[]>([])
  const [senders, setSenders] = useState<Sender[]>([])
  const [form, setForm] = useState({
    topic: '',
    recipient_type: '',
    recipient_email: '',
    recipient_label: '',
    requested_by: '',
    custom_requested_by: '',
    deadline: '',
    remarks: '',
  })

  useEffect(() => {
    Promise.all([
      fetch('/api/hunt-groups').then(r => r.json()),
      fetch('/api/senders').then(r => r.json()),
    ]).then(([groups, snds]) => {
      setHuntGroups(groups as HuntGroup[])
      setSenders(snds as Sender[])
    }).catch(() => {})
  }, [])

  const set = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const handleRecipientSelect = (value: string) => {
    if (value === '__manual__') {
      setForm(prev => ({ ...prev, recipient_type: '__manual__', recipient_email: '', recipient_label: '' }))
    } else {
      const g = huntGroups.find(g => g.id === value)
      if (g) setForm(prev => ({ ...prev, recipient_type: value, recipient_email: g.email, recipient_label: g.name }))
    }
  }

  const addQuestion = () => { if (questions.length < 4) setQuestions(p => [...p, '']) }
  const removeQuestion = (i: number) => setQuestions(p => p.filter((_, idx) => idx !== i))
  const updateQuestion = (i: number, v: string) => setQuestions(p => p.map((q, idx) => idx === i ? v : q))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const requestedBy = form.requested_by === '__custom__' ? form.custom_requested_by : form.requested_by
    const department = form.recipient_type === '__manual__' ? form.recipient_email : form.recipient_label

    if (!form.recipient_email) { setError('Please select a hunt group or enter a recipient email.'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/polls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: form.topic,
          department,
          recipient_email: form.recipient_email,
          requested_by: requestedBy,
          source: 'dashboard',
          questions: questions.filter(q => q.trim()),
          deadline: form.deadline || undefined,
          remarks: form.remarks || undefined,
          single_response: true,
        }),
      })
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? 'Failed') }
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Poll Lifecycle Timeline */}
      <div className="rounded-xl bg-cyan-50 px-4 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-cyan-700">Poll Lifecycle</p>
        <ol className="space-y-2">
          {TIMELINE_STEPS.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-cyan-600 text-xs font-bold text-white">
                  {i + 1}
                </div>
                {i < TIMELINE_STEPS.length - 1 && (
                  <div className="mt-1 h-4 w-px bg-cyan-300" />
                )}
              </div>
              <div className="pb-1">
                <p className="text-xs font-semibold text-cyan-900">{step.label}</p>
                <p className="text-xs text-cyan-600">{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Topic */}
        <div className="space-y-1.5">
          <Label htmlFor="topic">Topic / Subject *</Label>
          <Input id="topic" placeholder="e.g. Employee Satisfaction Q2 2026"
            value={form.topic} onChange={e => set('topic', e.target.value)} required />
        </div>

        {/* Recipient */}
        <div className="space-y-1.5">
          <Label>Target Audience / Recipients *</Label>
          <Select value={form.recipient_type} onValueChange={handleRecipientSelect} required>
            <SelectTrigger><SelectValue placeholder="Select hunt group or enter manually" /></SelectTrigger>
            <SelectContent>
              {huntGroups.map(g => (
                <SelectItem key={g.id} value={g.id}>{g.name} — {g.email}</SelectItem>
              ))}
              <SelectItem value="__manual__">Enter manually (no hunt group)</SelectItem>
            </SelectContent>
          </Select>
          {form.recipient_type === '__manual__' && (
            <Input type="email" placeholder="recipient@koenig-solutions.com"
              value={form.recipient_email} onChange={e => set('recipient_email', e.target.value)} required className="mt-2" />
          )}
          {form.recipient_type && form.recipient_type !== '__manual__' && (
            <p className="text-xs text-gray-500">Sending to: <span className="font-medium text-gray-700">{form.recipient_email}</span></p>
          )}
        </div>

        {/* Requested By — select from authorized senders */}
        <div className="space-y-1.5">
          <Label htmlFor="requested_by">Requested By *</Label>
          <Select value={form.requested_by} onValueChange={v => set('requested_by', v)} required>
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
              onChange={e => set('custom_requested_by', e.target.value)} required className="mt-2" />
          )}
        </div>

        {/* Questions */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Custom Questions <span className="font-normal text-gray-400">(optional, max 4)</span></Label>
            {questions.length < 4 && (
              <Button type="button" variant="ghost" size="sm" onClick={addQuestion}>
                <Plus className="mr-1 h-3 w-3" /> Add
              </Button>
            )}
          </div>
          <p className="text-xs text-gray-400">Leave blank to auto-generate. Provided questions are never modified.</p>
          {questions.map((q, i) => (
            <div key={i} className="flex gap-2">
              <Input placeholder={`Question ${i + 1}`} value={q} onChange={e => updateQuestion(i, e.target.value)} />
              {questions.length > 1 && (
                <Button type="button" variant="ghost" size="icon" onClick={() => removeQuestion(i)}>
                  <Trash2 className="h-4 w-4 text-gray-400" />
                </Button>
              )}
            </div>
          ))}
        </div>

        {/* Deadline */}
        <div className="space-y-1.5">
          <Label htmlFor="deadline">Deadline Override <span className="font-normal text-gray-400">(default: +48 hrs)</span></Label>
          <Input id="deadline" type="datetime-local" value={form.deadline} onChange={e => set('deadline', e.target.value)} />
        </div>

        {/* Remarks */}
        <div className="space-y-1.5">
          <Label htmlFor="remarks">Remarks / Notes</Label>
          <Textarea id="remarks" placeholder="Internal context..." value={form.remarks}
            onChange={e => set('remarks', e.target.value)} rows={3} />
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {loading ? 'Creating Poll...' : 'Create Poll'}
        </Button>
      </form>
    </div>
  )
}
