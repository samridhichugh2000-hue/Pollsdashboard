'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { Plus, RefreshCw, CalendarClock, Edit2, Trash2, Play, Power, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QuestionBuilder, parseQuestions } from '@/components/polls/question-builder'
import type { Question } from '@/components/polls/question-builder'
import { RecipientPicker } from '@/components/polls/recipient-picker'
import type { RegularPoll } from '@/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function isDue(dateStr: string) {
  return new Date(dateStr) <= new Date()
}

function computeNextRunDate(frequency: 'monthly' | 'quarterly', scheduledDay: number): string {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), scheduledDay)
  if (thisMonth >= today) return thisMonth.toISOString().split('T')[0]
  const next = new Date(thisMonth)
  next.setMonth(next.getMonth() + (frequency === 'quarterly' ? 3 : 1))
  return next.toISOString().split('T')[0]
}

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  name: string
  description: string
  frequency: 'monthly' | 'quarterly'
  scheduled_day: string
  department: string
  subject: string
  draft_email_body: string
  questions: Question[]
  recipients: string[]
}

const emptyForm: FormState = {
  name: '', description: '', frequency: 'monthly', scheduled_day: '1',
  department: 'General', subject: '', draft_email_body: '',
  questions: [{ text: '', type: 'open_ended' }],
  recipients: [],
}

function formFromTemplate(t: RegularPoll): FormState {
  return {
    name: t.name,
    description: t.description ?? '',
    frequency: t.frequency,
    scheduled_day: String(t.scheduled_day),
    department: t.department,
    subject: t.subject,
    draft_email_body: t.draft_email_body,
    questions: parseQuestions(t.questions),
    recipients: JSON.parse(t.recipients) as string[],
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FrequencyBadge({ frequency }: { frequency: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
      frequency === 'monthly' ? 'bg-cyan-50 text-cyan-700' : 'bg-violet-50 text-violet-700'
    }`}>
      {frequency === 'monthly' ? 'Monthly' : 'Quarterly'}
    </span>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RegularPollsPage() {
  const [polls, setPolls] = useState<RegularPoll[]>([])
  const [loading, setLoading] = useState(true)

  // Create / edit dialog
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)

  // Release dialog
  const [releaseId, setReleaseId] = useState<string | null>(null)
  const [releaseForm, setReleaseForm] = useState<{ subject: string; draft_email_body: string; questions: Question[] }>({
    subject: '', draft_email_body: '', questions: [],
  })
  const [releasing, setReleasing] = useState(false)

  // Expanded card view
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchPolls = useCallback(async () => {
    try {
      const res = await fetch('/api/regular-polls')
      setPolls(await res.json() as RegularPoll[])
    } catch { toast.error('Failed to load regular polls') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void fetchPolls() }, [fetchPolls])

  // ── Create / Edit ──────────────────────────────────────────────────────────

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setFormOpen(true) }
  const openEdit = (t: RegularPoll) => { setEditingId(t.id); setForm(formFromTemplate(t)); setFormOpen(true) }

  const saveForm = async () => {
    if (!form.name || !form.subject || !form.draft_email_body || !form.questions.length || !form.recipients.length) {
      toast.error('Please fill in all required fields'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        scheduled_day: Number(form.scheduled_day),
        questions: JSON.stringify(form.questions.filter(q => q.text.trim())),
        recipients: JSON.stringify(form.recipients),
        next_run_date: computeNextRunDate(form.frequency, Number(form.scheduled_day)),
      }

      if (editingId) {
        await fetch(`/api/regular-polls/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'UPDATE', ...payload }),
        })
        toast.success('Regular poll updated')
      } else {
        await fetch('/api/regular-polls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        toast.success('Regular poll created')
      }
      setFormOpen(false)
      void fetchPolls()
    } catch { toast.error('Save failed') }
    finally { setSaving(false) }
  }

  // ── Toggle active ─────────────────────────────────────────────────────────

  const toggleActive = async (t: RegularPoll) => {
    await fetch(`/api/regular-polls/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'TOGGLE_ACTIVE' }),
    })
    toast.success(t.is_active ? 'Paused' : 'Activated')
    void fetchPolls()
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  const deletePoll = async (id: string) => {
    await fetch(`/api/regular-polls/${id}`, { method: 'DELETE' })
    toast.success('Deleted')
    void fetchPolls()
  }

  // ── Open release dialog ───────────────────────────────────────────────────

  const openRelease = (t: RegularPoll) => {
    setReleaseId(t.id)
    setReleaseForm({
      subject: t.subject,
      draft_email_body: t.draft_email_body,
      questions: parseQuestions(t.questions),
    })
  }

  // ── Release ───────────────────────────────────────────────────────────────

  const doRelease = async () => {
    if (!releaseId) return
    setReleasing(true)
    try {
      const res = await fetch(`/api/regular-polls/${releaseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'RELEASE',
          subject: releaseForm.subject,
          draft_email_body: releaseForm.draft_email_body,
          questions: JSON.stringify(releaseForm.questions.filter(q => q.text.trim())),
        }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        toast.error(data.error ?? 'Release failed'); return
      }
      toast.success('Poll released successfully!')
      setReleaseId(null)
      void fetchPolls()
    } catch { toast.error('Release failed') }
    finally { setReleasing(false) }
  }

  const duePolls = polls.filter(p => p.is_active && isDue(p.next_run_date))
  const releasingTemplate = polls.find(p => p.id === releaseId)

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Regular Polls</h2>
          <p className="text-sm text-white/50">{polls.length} template{polls.length !== 1 ? 's' : ''} · {duePolls.length} due</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm"
            className="border-white/20 bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
            onClick={fetchPolls}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
          <Button size="sm" className="bg-white text-cyan-700 hover:bg-white/90 font-semibold shadow-lg"
            onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Regular Poll
          </Button>
        </div>
      </div>

      {/* Due alert banner */}
      {duePolls.length > 0 && (
        <div className="rounded-2xl bg-amber-500/20 border border-amber-400/30 px-5 py-4 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock className="h-4 w-4 text-amber-300" />
            <span className="font-semibold text-amber-200">{duePolls.length} poll{duePolls.length > 1 ? 's' : ''} due for release</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {duePolls.map(p => (
              <button key={p.id} onClick={() => openRelease(p)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/30 px-3 py-1.5 text-sm font-medium text-amber-100 transition-colors">
                <Play className="h-3 w-3" /> Release: {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Poll template cards */}
      <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : polls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CalendarClock className="h-10 w-10 text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-500">No regular polls yet</p>
            <p className="text-xs text-gray-400 mt-1">Add a monthly or quarterly poll template to get started</p>
            <Button size="sm" className="mt-4" onClick={openCreate}><Plus className="mr-1.5 h-3.5 w-3.5" /> Add Regular Poll</Button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {polls.map((t) => {
              const due = t.is_active && isDue(t.next_run_date)
              const isExpanded = expanded === t.id
              const recipientList: string[] = JSON.parse(t.recipients)
              const questionList = parseQuestions(t.questions)

              return (
                <div key={t.id} className={`transition-colors ${due ? 'bg-amber-50/50' : ''}`}>
                  {/* Main row */}
                  <div className="flex items-center gap-4 px-5 py-4">
                    {/* Active indicator */}
                    <div className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                      !t.is_active ? 'bg-gray-300' : due ? 'bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.4)]' : 'bg-emerald-400'
                    }`} />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 text-sm">{t.name}</span>
                        <FrequencyBadge frequency={t.frequency} />
                        {!t.is_active && <span className="text-xs text-gray-400">(Paused)</span>}
                        {due && <span className="text-xs font-medium text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">Due</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                        <span>{t.department}</span>
                        <span>·</span>
                        <span>Day {t.scheduled_day} of month</span>
                        <span>·</span>
                        <span className={due ? 'text-amber-600 font-medium' : ''}>
                          Next: {formatDate(t.next_run_date)}
                        </span>
                        <span>·</span>
                        <span>{recipientList.length} recipient{recipientList.length !== 1 ? 's' : ''}</span>
                        {t.last_run_date && <><span>·</span><span>Last sent: {formatDate(t.last_run_date)}</span></>}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {due && (
                        <Button size="sm" className="h-7 bg-amber-500 hover:bg-amber-600 text-white text-xs"
                          onClick={() => openRelease(t)}>
                          <Play className="mr-1 h-3 w-3" /> Release
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit template" onClick={() => openEdit(t)}>
                        <Edit2 className="h-3.5 w-3.5 text-gray-500" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title={t.is_active ? 'Pause' : 'Activate'}
                        onClick={() => void toggleActive(t)}>
                        <Power className={`h-3.5 w-3.5 ${t.is_active ? 'text-emerald-500' : 'text-gray-400'}`} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete"
                        onClick={() => { if (confirm('Delete this regular poll template?')) void deletePoll(t.id) }}>
                        <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-rose-500" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => setExpanded(isExpanded ? null : t.id)}>
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-5 pb-5 grid grid-cols-1 gap-4 md:grid-cols-3 bg-gray-50/60 border-t border-gray-100">
                      <div className="pt-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Recipients</p>
                        <div className="space-y-1">
                          {recipientList.map(r => (
                            <p key={r} className="text-xs text-gray-600 truncate">{r}</p>
                          ))}
                        </div>
                      </div>
                      <div className="pt-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Questions</p>
                        <ol className="space-y-2">
                          {questionList.map((q, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-xs font-bold text-gray-400 flex-shrink-0 mt-0.5">{i+1}.</span>
                              <div className="min-w-0">
                                <p className="text-xs text-gray-700">{q.text}</p>
                                <span className={`inline-block mt-0.5 rounded-full px-1.5 py-px text-[10px] font-medium ${
                                  q.type === 'rating' ? 'bg-amber-100 text-amber-700' :
                                  q.type === 'yes_no' ? 'bg-emerald-100 text-emerald-700' :
                                  q.type === 'multiple_choice' ? 'bg-purple-100 text-purple-700' :
                                  'bg-blue-100 text-blue-700'
                                }`}>
                                  {q.type === 'open_ended' ? 'Open Ended' : q.type === 'rating' ? 'Rating' : q.type === 'yes_no' ? 'Yes/No' : 'Multiple Choice'}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div className="pt-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Email Preview</p>
                        <p className="text-xs font-medium text-gray-700 mb-1">{t.subject}</p>
                        <p className="text-xs text-gray-500 line-clamp-4 whitespace-pre-wrap">{t.draft_email_body}</p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Create / Edit Dialog ─────────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Regular Poll' : 'New Regular Poll'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-700">Poll Name *</label>
                <input className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="e.g. Monthly Employee NPS" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Frequency *</label>
                <select className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value as 'monthly' | 'quarterly' }))}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Day of Month *</label>
                <input type="number" min={1} max={28} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="1–28" value={form.scheduled_day}
                  onChange={e => setForm(f => ({ ...f, scheduled_day: e.target.value }))} />
                <p className="mt-1 text-xs text-gray-400">Alert fires on this day each {form.frequency === 'monthly' ? 'month' : 'quarter'}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Description</label>
                <input className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="Optional description" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700">Email Subject *</label>
              <input className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                placeholder="Monthly Feedback Poll – April 2026" value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700">Email Body *</label>
              <textarea rows={5} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-y"
                placeholder="Dear Team,&#10;&#10;Please take a moment to fill in our monthly feedback poll..." value={form.draft_email_body}
                onChange={e => setForm(f => ({ ...f, draft_email_body: e.target.value }))} />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 mb-2 block">Poll Questions *</label>
              <QuestionBuilder
                questions={form.questions}
                onChange={qs => setForm(f => ({ ...f, questions: qs }))}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 mb-2 block">Recipients *</label>
              <RecipientPicker
                key={editingId ?? 'new-form'}
                value={form.recipients}
                onChange={emails => setForm(f => ({ ...f, recipients: emails }))}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button onClick={saveForm} disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Regular Poll'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Release Dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!releaseId} onOpenChange={(open) => { if (!open) setReleaseId(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Release: {releasingTemplate?.name}</DialogTitle>
          </DialogHeader>
          {releasingTemplate && (
            <div className="space-y-4 pt-2">
              <p className="text-xs text-gray-500">
                Review and optionally edit the draft before releasing to{' '}
                <strong>{(JSON.parse(releasingTemplate.recipients) as string[]).length} recipient(s)</strong>.
              </p>

              <div>
                <label className="text-xs font-medium text-gray-700">Email Subject</label>
                <input className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  value={releaseForm.subject}
                  onChange={e => setReleaseForm(f => ({ ...f, subject: e.target.value }))} />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700">Email Body</label>
                <textarea rows={6} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-y"
                  value={releaseForm.draft_email_body}
                  onChange={e => setReleaseForm(f => ({ ...f, draft_email_body: e.target.value }))} />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 mb-2 block">Poll Questions</label>
                <QuestionBuilder
                  questions={releaseForm.questions}
                  onChange={qs => setReleaseForm(f => ({ ...f, questions: qs }))}
                />
              </div>

              <div className="rounded-lg bg-gray-50 px-4 py-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Recipients</p>
                <div className="flex flex-wrap gap-1">
                  {(JSON.parse(releasingTemplate.recipients) as string[]).map(r => (
                    <span key={r} className="inline-flex rounded-full bg-gray-200 px-2.5 py-0.5 text-xs text-gray-600">{r}</span>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">Edit recipients in the template settings (Edit button).</p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setReleaseId(null)}>Cancel</Button>
                <Button className="bg-amber-500 hover:bg-amber-600" onClick={doRelease} disabled={releasing}>
                  {releasing ? 'Releasing…' : 'Release Now'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
