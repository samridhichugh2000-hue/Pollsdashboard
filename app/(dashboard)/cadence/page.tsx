'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, RefreshCw, CalendarClock, Edit2, Trash2, Play, Power, ChevronDown, ChevronUp, Paperclip, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QuestionBuilder, parseQuestions } from '@/components/polls/question-builder'
import type { Question } from '@/components/polls/question-builder'
import { RecipientPicker } from '@/components/polls/recipient-picker'
import { getErrorMessage } from '@/lib/utils'
import type { RegularPoll, RegularPollFrequency } from '@/types'

interface AttachmentMeta { name: string; size: number }
interface NewAttachment { name: string; contentType: string; contentBytes: string }

// Attachments are base64-encoded (~33% larger) and sent as JSON. Vercel
// serverless functions hard-cap the request body at 4.5 MB regardless of app
// config, so these limits keep the encoded payload safely under that ceiling.
const MAX_ATTACHMENT_FILE_MB = 3
const MAX_ATTACHMENT_FILE_BYTES = MAX_ATTACHMENT_FILE_MB * 1024 * 1024
const MAX_ATTACHMENT_TOTAL_MB = 3
const MAX_ATTACHMENT_TOTAL_BYTES = MAX_ATTACHMENT_TOTAL_MB * 1024 * 1024

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function filesToAttachments(files: File[]): Promise<NewAttachment[]> {
  return Promise.all(files.map(async f => ({
    name: f.name,
    contentType: f.type || 'application/octet-stream',
    contentBytes: await fileToBase64(f),
  })))
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Shared attachment picker — used both by the create/edit dialog (sets the
// default attachment for every future release) and the "Update Attachment"
// dialog opened from the upcoming-release banner (overrides it going forward).
function AttachmentPicker({
  existing, removedNames, onRemoveExisting, newFiles, onAddFiles, onRemoveNew,
}: {
  existing: AttachmentMeta[]
  removedNames: string[]
  onRemoveExisting: (name: string) => void
  newFiles: File[]
  onAddFiles: (files: File[]) => void
  onRemoveNew: (index: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const visibleExisting = existing.filter(a => !removedNames.includes(a.name))
  const total = visibleExisting.length + newFiles.length

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? [])
    const tooBig = selected.filter(f => f.size > MAX_ATTACHMENT_FILE_BYTES)
    if (tooBig.length) {
      toast.error(`File(s) exceed ${MAX_ATTACHMENT_FILE_MB} MB: ${tooBig.map(f => f.name).join(', ')}`)
      e.target.value = ''
      return
    }
    if (total + selected.length > 5) {
      toast.error('Maximum 5 attachments allowed.')
      e.target.value = ''
      return
    }
    const existingBytes = visibleExisting.reduce((sum, a) => sum + a.size, 0)
    const newBytes = newFiles.reduce((sum, f) => sum + f.size, 0)
    const selectedBytes = selected.reduce((sum, f) => sum + f.size, 0)
    if (existingBytes + newBytes + selectedBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      toast.error(`Attachments must total ${MAX_ATTACHMENT_TOTAL_MB} MB or less — the request will be rejected otherwise.`)
      e.target.value = ''
      return
    }
    onAddFiles(selected)
    e.target.value = ''
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-gray-700 dark:text-slate-300">
        Attachments <span className="font-normal text-gray-400">(optional &middot; max 5 files &middot; {MAX_ATTACHMENT_TOTAL_MB} MB total)</span>
      </label>
      {visibleExisting.length > 0 && (
        <div className="space-y-1.5">
          {visibleExisting.map(file => (
            <div key={file.name} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-3 py-2 overflow-hidden">
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                <span className="text-sm text-gray-700 dark:text-slate-300 truncate">{file.name}</span>
                <span className="text-xs text-gray-400 flex-shrink-0">{formatSize(file.size)}</span>
              </div>
              <button type="button" onClick={() => onRemoveExisting(file.name)}
                className="ml-2 flex-shrink-0 text-gray-400 hover:text-rose-500 transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {newFiles.length > 0 && (
        <div className="space-y-1.5">
          {newFiles.map((file, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-3 py-2 overflow-hidden">
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                <span className="text-sm text-gray-700 dark:text-slate-300 truncate">{file.name}</span>
                <span className="text-xs text-gray-400 flex-shrink-0">{formatSize(file.size)}</span>
              </div>
              <button type="button" onClick={() => onRemoveNew(i)}
                className="ml-2 flex-shrink-0 text-gray-400 hover:text-rose-500 transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {total < 5 && (
        <>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={handleChange} />
          <button type="button" onClick={() => inputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 dark:border-slate-600 px-4 py-2.5 text-sm text-gray-500 dark:text-slate-400 hover:border-cyan-400 hover:text-cyan-600 transition-colors">
            <Paperclip className="h-4 w-4" />
            {total === 0 ? 'Attach files' : 'Attach more files'}
          </button>
        </>
      )}
    </div>
  )
}

// next_run_date/last_run_date are bare "YYYY-MM-DD" strings. `new Date(str)`
// parses a date-only string as UTC midnight, but the old code then mutated
// it with setHours() in the browser's LOCAL timezone — for any viewer west
// of UTC that silently shifts the date back a day. Parsing the components
// directly into a local Date sidesteps the UTC round-trip entirely.
function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDate(dateStr: string) {
  return parseDateOnly(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function isDueToday(dateStr: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = parseDateOnly(dateStr)
  return d <= today
}

function isDueTomorrow(dateStr: string) {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0, 0, 0, 0)
  const d = parseDateOnly(dateStr)
  return d.getTime() === tomorrow.getTime()
}

interface FormState {
  name: string
  description: string
  frequency: RegularPollFrequency
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

function FrequencyBadge({ frequency }: { frequency: string }) {
  const colorMap: Record<string, string> = {
    monthly: 'bg-cyan-50 text-cyan-700',
    quarterly: 'bg-violet-50 text-violet-700',
    'bi-annual': 'bg-emerald-50 text-emerald-700',
    annual: 'bg-amber-50 text-amber-700',
  }
  const labelMap: Record<string, string> = {
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    'bi-annual': 'Bi-Annual',
    annual: 'Annual',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colorMap[frequency] ?? 'bg-gray-100 text-gray-600'}`}>
      {labelMap[frequency] ?? frequency}
    </span>
  )
}

function StatCard({ label, value, colour, active, onClick }: {
  label: string; value: number; colour: string; active?: boolean; onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col gap-1 rounded-2xl px-5 py-4 shadow-sm border text-left transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer ${active ? 'bg-slate-900 border-slate-700' : 'bg-white dark:bg-[#1e2535] border-gray-100 dark:border-slate-700'}`}
    >
      <span className={`text-2xl font-bold ${active ? 'text-white' : colour}`}>{value}</span>
      <span className={`text-xs font-medium ${active ? 'text-slate-300' : 'text-gray-500 dark:text-slate-400'}`}>{label}</span>
    </button>
  )
}

type FilterKey = 'all' | 'upcoming' | 'overdue' | 'released'

function CadencePageInner() {
  const [polls, setPolls] = useState<RegularPoll[]>([])
  const [loading, setLoading] = useState(true)
  const searchParams = useSearchParams()
  const [activeFilter, setActiveFilter] = useState<FilterKey>((searchParams.get('card') as FilterKey) ?? 'all')

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formExistingAttachments, setFormExistingAttachments] = useState<AttachmentMeta[]>([])
  const [formNewAttachments, setFormNewAttachments] = useState<File[]>([])
  const [formRemovedAttachmentNames, setFormRemovedAttachmentNames] = useState<string[]>([])

  const [attachPoll, setAttachPoll] = useState<RegularPoll | null>(null)
  const [attachExisting, setAttachExisting] = useState<AttachmentMeta[]>([])
  const [attachNewFiles, setAttachNewFiles] = useState<File[]>([])
  const [attachRemoved, setAttachRemoved] = useState<string[]>([])
  const [attachSaving, setAttachSaving] = useState(false)

  const [releaseId, setReleaseId] = useState<string | null>(null)
  const defaultDeadline = () => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().split('T')[0] }
  const [releaseForm, setReleaseForm] = useState<{ subject: string; draft_email_body: string; questions: Question[]; deadline: string }>({
    subject: '', draft_email_body: '', questions: [], deadline: defaultDeadline(),
  })
  const [releasing, setReleasing] = useState(false)

  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchPolls = useCallback(async () => {
    try {
      const res = await fetch('/api/regular-polls')
      setPolls(await res.json() as RegularPoll[])
    } catch { toast.error('Failed to load cadence polls') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void fetchPolls() }, [fetchPolls])

  const openCreate = () => {
    setEditingId(null); setForm(emptyForm); setFormOpen(true)
    setFormExistingAttachments([]); setFormNewAttachments([]); setFormRemovedAttachmentNames([])
  }

  const openEdit = async (t: RegularPoll) => {
    setEditingId(t.id); setForm(formFromTemplate(t)); setFormOpen(true)
    setFormNewAttachments([]); setFormRemovedAttachmentNames([])
    try {
      const data = await fetch(`/api/regular-polls/${t.id}`).then(r => r.ok ? r.json() : null) as { attachments?: AttachmentMeta[] } | null
      setFormExistingAttachments(data?.attachments ?? [])
    } catch { setFormExistingAttachments([]) }
  }

  const saveForm = async () => {
    if (!form.name || !form.subject || !form.draft_email_body || !form.questions.length || !form.recipients.length) {
      toast.error('Please fill in all required fields'); return
    }
    setSaving(true)
    try {
      const newAttachments = await filesToAttachments(formNewAttachments)
      const payload = {
        ...form,
        scheduled_day: Number(form.scheduled_day),
        questions: JSON.stringify(form.questions.filter(q => q.text.trim())),
        recipients: JSON.stringify(form.recipients),
        // next_run_date is always derived server-side from frequency +
        // scheduled_day (both for create and edit) — the server no longer
        // reads/trusts a client-computed value.
      }
      if (editingId) {
        const res = await fetch(`/api/regular-polls/${editingId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'UPDATE', ...payload, newAttachments, removeAttachmentNames: formRemovedAttachmentNames }),
        })
        if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to update cadence poll'))
        toast.success('Cadence poll updated')
      } else {
        const res = await fetch('/api/regular-polls', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, attachments: newAttachments }),
        })
        if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to create cadence poll'))
        toast.success('Cadence poll created')
      }
      setFormOpen(false)
      void fetchPolls()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Save failed') }
    finally { setSaving(false) }
  }

  const openAttachDialog = async (t: RegularPoll) => {
    setAttachPoll(t); setAttachNewFiles([]); setAttachRemoved([])
    try {
      const data = await fetch(`/api/regular-polls/${t.id}`).then(r => r.ok ? r.json() : null) as { attachments?: AttachmentMeta[] } | null
      setAttachExisting(data?.attachments ?? [])
    } catch { setAttachExisting([]) }
  }

  const saveAttachDialog = async () => {
    if (!attachPoll) return
    setAttachSaving(true)
    try {
      const newAttachments = await filesToAttachments(attachNewFiles)
      const res = await fetch(`/api/regular-polls/${attachPoll.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UPDATE_ATTACHMENTS', newAttachments, removeAttachmentNames: attachRemoved }),
      })
      if (!res.ok) { toast.error(await getErrorMessage(res, 'Failed to update attachment')); return }
      toast.success('Attachment updated — it will be used for this release')
      setAttachPoll(null)
      void fetchPolls()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to update attachment') }
    finally { setAttachSaving(false) }
  }

  const toggleActive = async (t: RegularPoll) => {
    await fetch(`/api/regular-polls/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'TOGGLE_ACTIVE' }),
    })
    toast.success(t.is_active ? 'Paused' : 'Activated')
    void fetchPolls()
  }

  const toggleAutoApprove = async (t: RegularPoll) => {
    await fetch(`/api/regular-polls/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'TOGGLE_AUTO_APPROVE' }),
    })
    toast.success(t.auto_approve ? 'Auto-approve disabled' : 'Auto-approve enabled')
    void fetchPolls()
  }

  const deletePoll = async (id: string) => {
    await fetch(`/api/regular-polls/${id}`, { method: 'DELETE' })
    toast.success('Deleted')
    void fetchPolls()
  }

  const openRelease = (t: RegularPoll) => {
    setReleaseId(t.id)
    setReleaseForm({ subject: t.subject, draft_email_body: t.draft_email_body, questions: parseQuestions(t.questions), deadline: defaultDeadline() })
  }

  const doRelease = async () => {
    if (!releaseId) return
    setReleasing(true)
    try {
      const res = await fetch(`/api/regular-polls/${releaseId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'RELEASE', subject: releaseForm.subject, draft_email_body: releaseForm.draft_email_body,
          questions: JSON.stringify(releaseForm.questions.filter(q => q.text.trim())), deadline: releaseForm.deadline,
        }),
      })
      if (!res.ok) { toast.error(await getErrorMessage(res, 'Release failed')); return }
      toast.success('Poll released successfully!')
      setReleaseId(null)
      void fetchPolls()
    } catch { toast.error('Release failed') }
    finally { setReleasing(false) }
  }

  const releasingTemplate = polls.find(p => p.id === releaseId)

  const todayMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() })()
  const weekMs = todayMs + 7 * 86400000
  const upcomingPolls = polls.filter(p => p.is_active && (isDueTomorrow(p.next_run_date) || isDueToday(p.next_run_date)))

  const total = polls.length
  const upcomingCount = polls.filter(p => {
    if (!p.is_active) return false
    const d = parseDateOnly(p.next_run_date)
    return d.getTime() > todayMs && d.getTime() <= weekMs
  }).length
  const overdueCount = polls.filter(p => p.is_active && isDueToday(p.next_run_date)).length
  const releasedCount = polls.filter(p => p.last_run_date != null).length

  const handleCardClick = (key: FilterKey) => {
    setActiveFilter(f => f === key ? 'all' : key)
    document.getElementById('cadence-table')?.scrollIntoView({ behavior: 'smooth' })
  }

  const filteredPolls = polls.filter(p => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'upcoming') {
      if (!p.is_active) return false
      const d = new Date(p.next_run_date); d.setHours(0, 0, 0, 0)
      return d.getTime() > todayMs && d.getTime() <= weekMs
    }
    if (activeFilter === 'overdue') return p.is_active && isDueToday(p.next_run_date)
    if (activeFilter === 'released') return p.last_run_date != null
    return true
  })

  const byFreq: Record<string, number> = {}
  for (const p of polls) {
    byFreq[p.frequency] = (byFreq[p.frequency] ?? 0) + 1
  }
  const freqOrder = ['monthly', 'quarterly', 'bi-annual', 'annual']
  const freqColors: Record<string, string> = {
    monthly: 'bg-cyan-400',
    quarterly: 'bg-violet-400',
    'bi-annual': 'bg-emerald-400',
    annual: 'bg-amber-400',
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-white">Poll Cadence</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{polls.length} template{polls.length !== 1 ? 's' : ''} &middot; auto-releases daily at 9 AM</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-sm" onClick={fetchPolls}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
          <Button size="sm" className="bg-teal-600 text-white hover:bg-teal-700 font-semibold shadow-sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Cadence Poll
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Cadence Polls" value={total} colour="text-purple-600 dark:text-purple-400" active={activeFilter === 'all'} onClick={() => handleCardClick('all')} />
        <StatCard label="Upcoming (this week)" value={upcomingCount} colour="text-teal-600 dark:text-teal-400" active={activeFilter === 'upcoming'} onClick={() => handleCardClick('upcoming')} />
        <StatCard label="Overdue" value={overdueCount} colour="text-red-600 dark:text-red-400" active={activeFilter === 'overdue'} onClick={() => handleCardClick('overdue')} />
        <StatCard label="Released" value={releasedCount} colour="text-emerald-600 dark:text-emerald-400" active={activeFilter === 'released'} onClick={() => handleCardClick('released')} />
      </div>

      {polls.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-[#1e2535] border border-gray-100 dark:border-slate-700 shadow-sm px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3">Cadence Breakdown by Frequency</h2>
          <div className="space-y-2.5">
            {freqOrder.filter(f => (byFreq[f] ?? 0) > 0).map(f => (
              <div key={f} className="flex items-center gap-3">
                <span className="w-20 text-xs text-gray-500 dark:text-slate-400 capitalize">{f === 'bi-annual' ? 'Bi-Annual' : f.charAt(0).toUpperCase() + f.slice(1)}</span>
                <div className="flex-1 h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-2 rounded-full ${freqColors[f] ?? 'bg-gray-400'}`}
                    style={{ width: `${Math.round(((byFreq[f] ?? 0) / total) * 100)}%` }}
                  />
                </div>
                <span className="w-8 text-right text-xs font-semibold text-gray-700 dark:text-slate-300">{byFreq[f]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {upcomingPolls.length > 0 && (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 px-5 py-4">
          <div className="flex items-center gap-2 mb-1">
            <CalendarClock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="font-semibold text-amber-800 dark:text-amber-300">
              {upcomingPolls.length} poll{upcomingPolls.length > 1 ? 's' : ''} will auto-release {upcomingPolls.some(p => isDueTomorrow(p.next_run_date)) ? 'tomorrow' : 'today'} at 9 AM
            </span>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">Pause a poll now if you want to skip this cycle, or update its attachment before it goes out.</p>
          <div className="flex flex-wrap gap-2">
            {upcomingPolls.map(p => (
              <div key={p.id} className="inline-flex items-center gap-2 rounded-lg bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-900/50 px-3 py-1.5">
                <CalendarClock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium text-amber-800 dark:text-amber-300">{p.name}</span>
                <span className="text-xs text-amber-600 dark:text-amber-400">{isDueTomorrow(p.next_run_date) ? 'tomorrow' : 'today'}</span>
                {(p.attachmentCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-amber-700 dark:text-amber-400">
                    <Paperclip className="h-3 w-3" />{p.attachmentCount}
                  </span>
                )}
                <button onClick={() => void openAttachDialog(p)}
                  className="ml-1 inline-flex items-center gap-1 rounded-md bg-amber-200 dark:bg-amber-900/40 hover:bg-amber-300 dark:hover:bg-amber-900/60 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300 transition-colors">
                  <Paperclip className="h-3 w-3" /> Update Attachment
                </button>
                <button onClick={() => void toggleActive(p)}
                  className="rounded-md bg-amber-200 dark:bg-amber-900/40 hover:bg-amber-300 dark:hover:bg-amber-900/60 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300 transition-colors">
                  Pause
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div id="cadence-table" className="rounded-2xl bg-white dark:bg-[#1e2535] shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)] overflow-x-auto">
        {activeFilter !== 'all' && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
            <span className="text-xs font-semibold text-slate-600">
              Showing: <span className="capitalize text-slate-800 dark:text-slate-200">{activeFilter === 'upcoming' ? 'Upcoming this week' : activeFilter}</span> &middot; {filteredPolls.length} poll{filteredPolls.length !== 1 ? 's' : ''}
            </span>
            <button onClick={() => setActiveFilter('all')} className="text-xs text-slate-400 hover:text-slate-700 underline">Clear filter</button>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : filteredPolls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CalendarClock className="h-10 w-10 text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-500">{polls.length === 0 ? 'No cadence polls yet' : 'No polls match this filter'}</p>
            {polls.length === 0 && <><p className="text-xs text-gray-400 mt-1">Add a monthly or quarterly poll template to get started</p>
            <Button size="sm" className="mt-4" onClick={openCreate}><Plus className="mr-1.5 h-3.5 w-3.5" /> Add Cadence Poll</Button></>}
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-purple-600 text-white">
                <th className="border border-gray-300 dark:border-slate-600 px-5 py-3 text-left font-semibold">Poll Name</th>
                <th className="border border-gray-300 dark:border-slate-600 px-4 py-3 text-center font-semibold w-12">M</th>
                <th className="border border-gray-300 dark:border-slate-600 px-4 py-3 text-center font-semibold w-12">Q</th>
                <th className="border border-gray-300 dark:border-slate-600 px-4 py-3 text-left font-semibold">Last Run</th>
                <th className="border border-gray-300 dark:border-slate-600 px-4 py-3 text-left font-semibold">Next Date</th>
                <th className="border border-gray-300 dark:border-slate-600 px-4 py-3 text-left font-semibold">Status</th>
                <th className="border border-gray-300 dark:border-slate-600 px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPolls
                .slice()
                .sort((a, b) => new Date(a.next_run_date).getTime() - new Date(b.next_run_date).getTime())
                .map((t) => {
                  const dueToday = t.is_active && isDueToday(t.next_run_date)
                  const dueTomorrow = t.is_active && isDueTomorrow(t.next_run_date)
                  const isMonthly = t.frequency === 'monthly'
                  const isQuarterly = t.frequency === 'quarterly'

                  let statusText = '—'
                  if (!t.is_active) statusText = 'Paused'
                  else if (dueToday) statusText = 'Overdue'
                  else if (dueTomorrow) statusText = 'Tomorrow'
                  else if (t.last_run_date) statusText = 'Done'

                  return (
                    <tr key={t.id} className={`border-b border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/30 ${
                      dueToday ? 'bg-red-50 dark:bg-red-900/10' : dueTomorrow ? 'bg-amber-50 dark:bg-amber-900/10' : ''
                    }`}>
                      <td className="border border-gray-200 dark:border-slate-700 px-5 py-3 text-gray-900 dark:text-slate-100 font-medium">{t.name}</td>
                      <td className="border border-gray-200 dark:border-slate-700 px-4 py-3 text-center text-gray-600 dark:text-slate-400">{isMonthly ? <Check className="h-5 w-5 text-emerald-600 inline" /> : '—'}</td>
                      <td className="border border-gray-200 dark:border-slate-700 px-4 py-3 text-center text-gray-600 dark:text-slate-400">{isQuarterly ? <Check className="h-5 w-5 text-emerald-600 inline" /> : '—'}</td>
                      <td className="border border-gray-200 dark:border-slate-700 px-4 py-3 text-gray-600 dark:text-slate-400">{t.last_run_date ? formatDate(t.last_run_date) : '—'}</td>
                      <td className={`border border-gray-200 dark:border-slate-700 px-4 py-3 font-medium ${dueToday ? 'text-red-600' : dueTomorrow ? 'text-amber-600' : 'text-gray-600 dark:text-slate-400'}`}>{formatDate(t.next_run_date)}</td>
                      <td className="border border-gray-200 dark:border-slate-700 px-4 py-3">
                        <span className={`inline-block px-2.5 py-1 rounded text-xs font-medium ${
                          !t.is_active ? 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300' :
                          dueToday ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                          dueTomorrow ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                          t.last_run_date ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
                          'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300'
                        }`}>
                          {statusText}
                        </span>
                      </td>
                      <td className="border border-gray-200 dark:border-slate-700 px-4 py-3 text-right space-x-1">
                        {dueToday && (
                          <Button size="sm" variant="outline" className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/20 mr-1"
                            onClick={() => openRelease(t)}>
                            <Play className="mr-1 h-3 w-3" /> Release Now
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 inline-flex" title="Edit" onClick={() => void openEdit(t)}>
                          <Edit2 className="h-3.5 w-3.5 text-gray-500 dark:text-slate-400" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 inline-flex" title={t.is_active ? 'Pause' : 'Activate'} onClick={() => void toggleActive(t)}>
                          <Power className={`h-3.5 w-3.5 ${t.is_active ? 'text-emerald-500' : 'text-gray-400 dark:text-slate-500'}`} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 inline-flex" title="Delete" onClick={() => { if (confirm('Delete this cadence poll template?')) void deletePoll(t.id) }}>
                          <Trash2 className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500 hover:text-rose-500" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? 'Edit Cadence Poll' : 'New Cadence Poll'}</DialogTitle></DialogHeader>
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
                  value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value as RegularPollFrequency }))}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="bi-annual">Bi-Annual</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Day of Month *</label>
                <input type="number" min={1} max={28} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="1-28" value={form.scheduled_day}
                  onChange={e => setForm(f => ({ ...f, scheduled_day: e.target.value }))} />
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
                placeholder="Monthly Feedback Poll" value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Email Body *</label>
              <textarea rows={5} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-y"
                value={form.draft_email_body}
                onChange={e => setForm(f => ({ ...f, draft_email_body: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 mb-2 block">Poll Questions *</label>
              <QuestionBuilder questions={form.questions} onChange={qs => setForm(f => ({ ...f, questions: qs }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 mb-2 block">Recipients *</label>
              <RecipientPicker key={editingId ?? 'new-form'} value={form.recipients} onChange={emails => setForm(f => ({ ...f, recipients: emails }))} />
            </div>
            <div className="pt-2 border-t border-gray-100 dark:border-slate-700">
              <AttachmentPicker
                existing={formExistingAttachments}
                removedNames={formRemovedAttachmentNames}
                onRemoveExisting={(name) => setFormRemovedAttachmentNames(prev => [...prev, name])}
                newFiles={formNewAttachments}
                onAddFiles={(files) => setFormNewAttachments(prev => [...prev, ...files])}
                onRemoveNew={(i) => setFormNewAttachments(prev => prev.filter((_, j) => j !== i))}
              />
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1.5">
                This becomes the default attachment used on every future release of this poll, until updated.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button onClick={saveForm} disabled={saving}>{saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Cadence Poll'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!releaseId} onOpenChange={(open) => { if (!open) setReleaseId(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Release: {releasingTemplate?.name}</DialogTitle></DialogHeader>
          {releasingTemplate && (
            <div className="space-y-4 pt-2">
              <p className="text-xs text-gray-500">
                Review and optionally edit the draft before releasing to{' '}
                <strong>{(JSON.parse(releasingTemplate.recipients) as string[]).length} recipient(s)</strong>.
              </p>
              <div>
                <label className="text-xs font-medium text-gray-700">Email Subject</label>
                <input className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  value={releaseForm.subject} onChange={e => setReleaseForm(f => ({ ...f, subject: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Email Body</label>
                <textarea rows={6} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-y"
                  value={releaseForm.draft_email_body} onChange={e => setReleaseForm(f => ({ ...f, draft_email_body: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Response Deadline</label>
                <input type="date" min={new Date().toISOString().split('T')[0]} value={releaseForm.deadline}
                  onChange={e => setReleaseForm(f => ({ ...f, deadline: e.target.value || defaultDeadline() }))}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 mb-2 block">Poll Questions</label>
                <QuestionBuilder questions={releaseForm.questions} onChange={qs => setReleaseForm(f => ({ ...f, questions: qs }))} />
              </div>
              <div className="rounded-lg bg-gray-50 px-4 py-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Recipients</p>
                <div className="flex flex-wrap gap-1">
                  {(JSON.parse(releasingTemplate.recipients) as string[]).map(r => (
                    <span key={r} className="inline-flex rounded-full bg-gray-200 px-2.5 py-0.5 text-xs text-gray-600">{r}</span>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setReleaseId(null)}>Cancel</Button>
                <Button className="bg-amber-500 hover:bg-amber-600" onClick={doRelease} disabled={releasing}>
                  {releasing ? 'Releasing...' : 'Release Now'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!attachPoll} onOpenChange={(open) => { if (!open) setAttachPoll(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Update Attachment{attachPoll ? ` — ${attachPoll.name}` : ''}</DialogTitle></DialogHeader>
          {attachPoll && (
            <div className="space-y-4 pt-2">
              <p className="text-xs text-gray-500">
                This poll releases {isDueTomorrow(attachPoll.next_run_date) ? 'tomorrow' : 'today'}. If you don&apos;t change anything here,
                it will go out with the same attachment as when this cadence entry was created.
              </p>
              <AttachmentPicker
                existing={attachExisting}
                removedNames={attachRemoved}
                onRemoveExisting={(name) => setAttachRemoved(prev => [...prev, name])}
                newFiles={attachNewFiles}
                onAddFiles={(files) => setAttachNewFiles(prev => [...prev, ...files])}
                onRemoveNew={(i) => setAttachNewFiles(prev => prev.filter((_, j) => j !== i))}
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setAttachPoll(null)}>Cancel</Button>
                <Button onClick={saveAttachDialog} disabled={attachSaving}>{attachSaving ? 'Saving...' : 'Save Attachment'}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function CadencePage() {
  return <Suspense><CadencePageInner /></Suspense>
}

