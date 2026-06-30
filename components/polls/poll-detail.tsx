'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink, CheckCircle, XCircle, Edit, Send, AlertCircle, Loader2, Download, RefreshCw, Save, X, ChevronDown, Paperclip, MessageSquare, Bell } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { StatusBadge } from './status-badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { formatDate, formatDateTime, formatRelative, isApprovalOverdue, normalizeBodyForEditor, sanitizeWordHtml } from '@/lib/utils'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import type { Poll, PollApproval, AuditLog, PollResponse } from '@/types'
import { QuestionBuilder, parseQuestions } from './question-builder'
import type { Question } from './question-builder'

interface PollDetailProps {
  poll: Poll
  approvals: PollApproval[]
  auditLogs: AuditLog[]
  response: PollResponse | null
}

function parseEmails(text: string): string[] {
  return text.split(/[\n,;]+/).map(e => e.trim()).filter(e => e.includes('@'))
}

export function PollDetail({ poll: initialPoll, approvals, auditLogs, response: initialResponse }: PollDetailProps) {
  const [poll, setPoll] = useState(initialPoll)
  const [response, setResponse] = useState(initialResponse)
  const [loading, setLoading] = useState<string | null>(null)
  const [notes, setNotes] = useState('')


  // Draft edit state
  const [editSubject, setEditSubject] = useState(initialPoll.subject || `Poll: ${initialPoll.topic}`)
  const [editEmailBody, setEditEmailBody] = useState(() => normalizeBodyForEditor(initialPoll.draft_email_body || ''))
  const [editQuestions, setEditQuestions] = useState<Question[]>(parseQuestions(initialPoll.questions ?? ''))
  const defaultDeadline = (() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().split('T')[0] })()
  const [editDeadline, setEditDeadline] = useState(
    initialPoll.deadline ? initialPoll.deadline.split('T')[0] : defaultDeadline
  )
  const [keywords, setKeywords] = useState('')
  const [tone, setTone] = useState('professional')
  const [useKeywords, setUseKeywords] = useState(true)

  // Approval preview state
  const [showApprovalPreview, setShowApprovalPreview] = useState(false)
  const [approvalRecipients, setApprovalRecipients] = useState<string[]>([])
  const [recipientInput, setRecipientInput] = useState('')

  // Release poll state
  const [showReleaseDialog, setShowReleaseDialog] = useState(false)
  const [huntGroups, setHuntGroups] = useState<{ id: string; name: string; email: string }[]>([])
  const [selectedHuntGroupIds, setSelectedHuntGroupIds] = useState<string[]>([])
  const [huntGroupsLoading, setHuntGroupsLoading] = useState(false)
  const [customReleaseText, setCustomReleaseText] = useState('')
  const [huntGroupDropdownOpen, setHuntGroupDropdownOpen] = useState(false)
  const huntGroupDropdownRef = useRef<HTMLDivElement>(null)
  const [releaseAttachments, setReleaseAttachments] = useState<File[]>([])
  // Attachments already saved server-side (carried over from the approval step).
  const [existingAttachments, setExistingAttachments] = useState<{ name: string; size: number }[]>([])
  const [removedAttachmentNames, setRemovedAttachmentNames] = useState<string[]>([])
  const releaseFileInputRef = useRef<HTMLInputElement>(null)
  const draftFileInputRef = useRef<HTMLInputElement>(null)

  // Share results state
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [shareRecipients, setShareRecipients] = useState<string[]>([])
  const [shareRecipientInput, setShareRecipientInput] = useState('')

  // Extend deadline state
  const [extendDeadlineDate, setExtendDeadlineDate] = useState('')

  // Per-entry review state
  const [entryRemarks, setEntryRemarks] = useState<Record<number, string>>({})
  const [entryClassifications, setEntryClassifications] = useState<Record<number, 'rms' | 'non_rms' | 'partial' | null>>({})
  const [entryStatuses, setEntryStatuses] = useState<Record<number, 'wip' | 'completed' | null>>({})
  const [entryReplies, setEntryReplies] = useState<Record<number, string>>({})
  const [sendingReply, setSendingReply] = useState<number | null>(null)
  const [savingEntry, setSavingEntry] = useState<number | null>(null)

  const [, setTick] = useState(0)
  const router = useRouter()

  // Re-render relative timestamps every minute
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(interval)
  }, [])

  // Sync local edit state when poll changes (after actions)
  useEffect(() => {
    if (poll.status === 'DRAFT') {
      setEditSubject(poll.subject || `Poll: ${poll.topic}`)
      setEditEmailBody(normalizeBodyForEditor(poll.draft_email_body || ''))
      setEditQuestions(parseQuestions(poll.questions ?? ''))
      setEditDeadline(poll.deadline ? poll.deadline.split('T')[0] : defaultDeadline)
    } else if (poll.status === 'APPROVED' || poll.status === 'AWAITING_APPROVAL') {
      // Approved and awaiting-approval polls allow in-place question editing.
      setEditQuestions(parseQuestions(poll.questions ?? ''))
    }
  }, [poll]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close hunt group dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (huntGroupDropdownRef.current && !huntGroupDropdownRef.current.contains(e.target as Node)) {
        setHuntGroupDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Auto-refresh every 30s while awaiting approval so email approvals reflect immediately
  useEffect(() => {
    if (poll.status !== 'AWAITING_APPROVAL') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/polls/${poll.id}`)
        if (!res.ok) return
        const data = await res.json() as { poll: Poll }
        if (data.poll.status !== poll.status) setPoll(data.poll)
      } catch { /* silent */ }
    }, 30_000)
    return () => clearInterval(interval)
  }, [poll.id, poll.status])

  // Fetch / refresh response data from API
  const refreshResponse = async () => {
    try {
      const res = await fetch(`/api/polls/${poll.id}`)
      if (!res.ok) return
      const data = await res.json() as { response: PollResponse | null }
      setResponse(data.response)
    } catch { /* silent */ }
  }

  // Auto-refresh responses every 30s while poll is live
  useEffect(() => {
    const LIVE = ['SENT', 'REMINDER_SENT']
    if (!LIVE.includes(poll.status)) return
    void refreshResponse()                     // load immediately on mount
    const interval = setInterval(refreshResponse, 30_000)
    return () => clearInterval(interval)
  }, [poll.id, poll.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasChanges =
    editSubject !== (poll.subject || `Poll: ${poll.topic}`) ||
    editEmailBody !== (poll.draft_email_body || '') ||
    JSON.stringify(editQuestions) !== JSON.stringify(parseQuestions(poll.questions ?? '')) ||
    editDeadline !== (poll.deadline ? poll.deadline.split('T')[0] : defaultDeadline)

  const runAction = async (action: string, extra?: Record<string, unknown>) => {
    setLoading(action)
    try {
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      if (!res.ok) {
        const data = await res.json() as { error: string }
        throw new Error(data.error)
      }
      const updated = await res.json() as Poll
      setPoll(updated)
      toast.success(`Action completed: ${action.replace(/_/g, ' ')}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setLoading(null)
    }
  }

  const saveEntry = async (index: number, actionable: boolean | null, classification?: 'rms' | 'non_rms' | 'partial' | null) => {
    if (!response?.response_data) return
    setSavingEntry(index)
    type EntryType = { email?: string; respondent?: string; submitted_at: string; answers: { question: string; answer: string }[]; actionable?: boolean | null; remarks?: string; classification?: string | null }
    const entries = JSON.parse(response.response_data) as EntryType[]
    const remarks = entryRemarks[index] ?? entries[index]?.remarks ?? ''
    const cls = classification !== undefined ? classification : (entryClassifications[index] !== undefined ? entryClassifications[index] : (entries[index]?.classification ?? null))
    try {
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UPDATE_ENTRY_ACTIONABLE', entryIndex: index, actionable, remarks, classification: cls }),
      })
      if (!res.ok) {
        const d = await res.json() as { error: string }
        throw new Error(d.error)
      }
      const updated = entries.map((e, i) => i === index ? { ...e, actionable, remarks, classification: cls } : e)
      setResponse(prev => prev ? { ...prev, response_data: JSON.stringify(updated) } : prev)
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingEntry(null)
    }
  }

  const saveStatus = async (index: number, value: 'wip' | 'completed') => {
    if (!response?.response_data) return
    type EntryType = { email?: string; respondent?: string; submitted_at: string; answers: { question: string; answer: string }[]; actionable?: boolean | null; remarks?: string; classification?: string | null; status?: string | null }
    const entries = JSON.parse(response.response_data) as EntryType[]
    const prev: 'wip' | 'completed' | null = entryStatuses[index] !== undefined ? entryStatuses[index] : ((entries[index]?.status as 'wip' | 'completed' | null) ?? null)
    const next = prev === value ? null : value
    setSavingEntry(index)
    setEntryStatuses(p => ({ ...p, [index]: next }))
    try {
      const cls = entryClassifications[index] !== undefined ? entryClassifications[index] : (entries[index]?.classification ?? null)
      const remarks = entryRemarks[index] ?? entries[index]?.remarks ?? ''
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UPDATE_ENTRY_ACTIONABLE', entryIndex: index, actionable: entries[index]?.actionable ?? null, remarks, classification: cls, status: next }),
      })
      if (!res.ok) {
        const d = await res.json() as { error: string }
        throw new Error(d.error)
      }
      const updated = entries.map((e, i) => i === index ? { ...e, status: next } : e)
      setResponse(prev => prev ? { ...prev, response_data: JSON.stringify(updated) } : prev)
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
      setEntryStatuses(p => ({ ...p, [index]: prev }))
    } finally {
      setSavingEntry(null)
    }
  }

  const sendReply = async (index: number) => {
    const replyMessage = (entryReplies[index] ?? '').trim()
    if (!replyMessage) { toast.error('Reply message cannot be empty.'); return }
    if (!response?.response_data) return
    setSendingReply(index)
    try {
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REPLY_TO_RESPONDENT', entryIndex: index, replyMessage }),
      })
      if (!res.ok) {
        const d = await res.json() as { error: string }
        throw new Error(d.error)
      }
      type EntryType = Record<string, unknown>
      const entries = JSON.parse(response.response_data) as EntryType[]
      const updated = entries.map((e, i) => i === index ? { ...e, reply_message: replyMessage, reply_sent_at: new Date().toISOString() } : e)
      setResponse(prev => prev ? { ...prev, response_data: JSON.stringify(updated) } : prev)
      toast.success('Reply sent')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send reply')
    } finally {
      setSendingReply(null)
    }
  }

  const runRegenerate = async (section: string) => {
    const actionKey = `REGENERATE_DRAFT_${section.toUpperCase()}`
    setLoading(actionKey)
    try {
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REGENERATE_DRAFT', section, keywords, tone, useKeywords }),
      })
      if (!res.ok) {
        const data = await res.json() as { error: string }
        throw new Error(data.error)
      }
      const updated = await res.json() as Poll
      setPoll(updated)
      // Local state will be synced via useEffect
      toast.success(`Draft ${section === 'all' ? 'regenerated' : `${section} regenerated`}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Regeneration failed')
    } finally {
      setLoading(null)
    }
  }

  const saveChanges = async () => {
    setLoading('SAVE_CHANGES')
    try {
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UPDATE_DRAFT',
          subject: editSubject,
          draft_email_body: editEmailBody,
          questions: JSON.stringify(editQuestions),
          deadline: editDeadline,
        }),
      })
      if (!res.ok) {
        const data = await res.json() as { error: string }
        throw new Error(data.error)
      }
      const updated = await res.json() as Poll
      setPoll(updated)
      toast.success('Draft saved successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setLoading(null)
    }
  }

  // Save edited questions in place on an approved poll — no status change,
  // no re-approval. Blank questions are dropped so they never reach the form.
  const saveQuestions = async () => {
    setLoading('UPDATE_QUESTIONS')
    try {
      const cleaned = editQuestions
        .map(q => ({ ...q, text: q.text.trim() }))
        .filter(q => q.text.length > 0)
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UPDATE_QUESTIONS', questions: JSON.stringify(cleaned) }),
      })
      if (!res.ok) {
        const data = await res.json() as { error: string }
        throw new Error(data.error)
      }
      const updated = await res.json() as Poll
      setPoll(updated)
      toast.success('Questions updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setLoading(null)
    }
  }

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const handleReleaseFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? [])
    const tooBig = selected.filter(f => f.size > 20 * 1024 * 1024)
    if (tooBig.length) {
      toast.error(`File(s) exceed 20 MB: ${tooBig.map(f => f.name).join(', ')}`)
      e.target.value = ''
      return
    }
    const combined = [...releaseAttachments, ...selected]
    if (combined.length > 5) {
      toast.error('Maximum 5 attachments allowed.')
      e.target.value = ''
      return
    }
    setReleaseAttachments(combined)
    e.target.value = ''
  }

  const openReleaseDialog = async () => {
    setShowReleaseDialog(true)
    setSelectedHuntGroupIds([])
    setCustomReleaseText('')
    setHuntGroupDropdownOpen(false)
    setReleaseAttachments([])
    setRemovedAttachmentNames([])
    setHuntGroupsLoading(true)
    // Load any attachments saved during approval so they carry into the release email.
    try {
      const pollRes = await fetch(`/api/polls/${poll.id}`)
      const pollData = await pollRes.json() as { attachments?: { name: string; size: number }[] }
      setExistingAttachments(pollData.attachments ?? [])
    } catch {
      setExistingAttachments([])
    }
    try {
      const res = await fetch('/api/hunt-groups')
      const data = await res.json() as { id: string; name: string; email: string }[]
      setHuntGroups(data)
    } catch {
      toast.error('Failed to load hunt groups')
    } finally {
      setHuntGroupsLoading(false)
    }
  }

  const releasePoll = async () => {
    const huntGroupSelected = huntGroups.filter(g => selectedHuntGroupIds.includes(g.id))
    const manualEmails = parseEmails(customReleaseText)
    const allEmails = [...new Set([...huntGroupSelected.map(g => g.email), ...manualEmails])]
    if (!allEmails.length) { toast.error('Add at least one recipient.'); return }

    let attachments: { name: string; contentType: string; contentBytes: string }[] = []
    if (releaseAttachments.length > 0) {
      try {
        attachments = await Promise.all(
          releaseAttachments.map(async (f) => ({
            name: f.name,
            contentType: f.type || 'application/octet-stream',
            contentBytes: await fileToBase64(f),
          }))
        )
      } catch {
        toast.error('Failed to process attachments.')
        return
      }
    }

    setShowReleaseDialog(false)
    void runAction('RELEASE_POLL', { allEmails, attachments, removeAttachmentNames: removedAttachmentNames })
  }

  const addShareRecipient = () => {
    const email = shareRecipientInput.trim()
    if (email && !shareRecipients.includes(email)) {
      setShareRecipients(prev => [...prev, email])
    }
    setShareRecipientInput('')
  }

  const overdue = poll.status === 'AWAITING_APPROVAL' && isApprovalOverdue(poll.updated_at)

  const downloadResponses = () => {
    window.open(`/api/polls/${poll.id}/download`, '_blank')
  }

  const questions: Question[] = parseQuestions(poll.questions ?? '')

  return (
    <div className="space-y-5">
      {/* Back + Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{poll.topic}</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">Poll ID: {poll.id.slice(0, 8)}...</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={poll.status} />
          {overdue && (
            <span className="flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
              <AlertCircle className="h-3 w-3" /> Overdue
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main info */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Poll Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-gray-500 dark:text-slate-400">Department</dt>
                  <dd className="font-medium text-gray-900 dark:text-slate-100">{poll.department}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-slate-400">Requested By</dt>
                  <dd className="font-medium text-gray-900 dark:text-slate-100">{poll.requested_by}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-slate-400">Source</dt>
                  <dd className="font-medium capitalize text-gray-900 dark:text-slate-100">{poll.source}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-slate-400">Deadline</dt>
                  <dd className="font-medium text-gray-900 dark:text-slate-100">{formatDateTime(poll.deadline)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-slate-400">Created</dt>
                  <dd className="font-medium text-gray-900 dark:text-slate-100">{formatDateTime(poll.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-slate-400">Sent At</dt>
                  <dd className="font-medium text-gray-900 dark:text-slate-100">{formatDateTime(poll.sent_at)}</dd>
                </div>
                {poll.ms_form_link && (
                  <div className="col-span-2">
                    <dt className="text-gray-500 dark:text-slate-400">Poll Form</dt>
                    <dd>
                      <a href={poll.ms_form_link} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm">
                        Open Form <ExternalLink className="h-3 w-3" />
                      </a>
                    </dd>
                  </div>
                )}
                {poll.rms_task_id && (
                  <div>
                    <dt className="text-gray-500 dark:text-slate-400">RMS Task ID</dt>
                    <dd className="font-medium text-gray-900 dark:text-slate-100">{poll.rms_task_id}</dd>
                  </div>
                )}
                {poll.remarks && (
                  <div className="col-span-2">
                    <dt className="text-gray-500 dark:text-slate-400">Remarks</dt>
                    <dd className="text-gray-700 dark:text-slate-300">{poll.remarks}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* DRAFT status — editable sections */}
          {poll.status === 'DRAFT' && (
            <>
              {/* Rejection banner — shown when poll was rejected and sent back for revision */}
              {(() => {
                const rejection = [...approvals].reverse().find(a => a.action === 'rejected' && a.notes)
                if (!rejection) return null
                return (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 dark:bg-red-900/20 dark:border-red-900/50">
                    <div className="flex items-start gap-3">
                      <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-red-800 dark:text-red-200">Rejected — sent back for revision</p>
                        <p className="mt-1 text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">{rejection.notes}</p>
                        <p className="mt-1.5 text-xs text-red-400 dark:text-red-500">{formatRelative(rejection.actioned_at)}</p>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Feedback banner — shown when poll was sent back with remarks */}
              {(() => {
                const feedback = [...approvals].reverse().find(a => a.action === 'clarification' && a.notes)
                if (!feedback) return null
                return (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:bg-amber-900/20 dark:border-amber-900/50">
                    <div className="flex items-start gap-3">
                      <MessageSquare className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Feedback from approver</p>
                        <p className="mt-1 text-sm text-amber-700 dark:text-amber-300 whitespace-pre-wrap">{feedback.notes}</p>
                        <p className="mt-1.5 text-xs text-amber-500 dark:text-amber-500">{formatRelative(feedback.actioned_at)}</p>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Section A: Subject Line */}
              <Card>
                <CardHeader><CardTitle>Email Subject Line</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <Input
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    className="w-full"
                    placeholder={`Poll: ${poll.topic}`}
                  />
                  <p className="text-xs text-gray-400 dark:text-slate-500">
                    This subject will appear on the poll response form and in all emails.
                  </p>
                </CardContent>
              </Card>

              {/* Section A2: Deadline */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Response Deadline
                    {editDeadline === defaultDeadline && (
                      <span className="text-xs font-normal text-gray-400 dark:text-slate-500">(48 hrs default)</span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={editDeadline}
                    onChange={e => setEditDeadline(e.target.value || defaultDeadline)}
                    className={editDeadline === defaultDeadline ? 'text-gray-400 dark:text-slate-500' : ''}
                  />
                  <p className="mt-1.5 text-xs text-amber-600">
                    Please choose a suitable deadline — the 48-hour default may not apply.
                  </p>
                </CardContent>
              </Card>

              {/* Section B: Draft Email Body */}
              <Card>
                <CardHeader><CardTitle>Draft Email Body</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[160px]">
                      <Label className="text-xs mb-1 block">Keywords</Label>
                      <Input
                        value={keywords}
                        onChange={(e) => setKeywords(e.target.value)}
                        placeholder="e.g. engagement, Q2, performance"
                        disabled={!useKeywords}
                        className={!useKeywords ? 'opacity-40' : ''}
                      />
                    </div>
                    <div className="flex items-end gap-1 pb-0.5">
                      <button
                        type="button"
                        onClick={() => setUseKeywords(u => !u)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${useKeywords ? 'bg-cyan-600' : 'bg-gray-200 dark:bg-slate-700'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${useKeywords ? 'translate-x-4' : 'translate-x-1'}`} />
                      </button>
                      <Label className="text-xs cursor-pointer" onClick={() => setUseKeywords(u => !u)}>
                        Use Keywords
                      </Label>
                    </div>
                    <div className="w-36">
                      <Label className="text-xs mb-1 block">Tone</Label>
                      <select
                        value={tone}
                        onChange={(e) => setTone(e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="professional">Professional</option>
                        <option value="friendly">Friendly</option>
                        <option value="formal">Formal</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => runRegenerate('email')} disabled={!!loading}>
                      {loading?.startsWith('REGENERATE_DRAFT_EMAIL') ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                      Redraft Email
                    </Button>
                  </div>
                  <RichTextEditor
                    value={editEmailBody}
                    onChange={setEditEmailBody}
                    placeholder="Email body will appear here… paste any format including tables"
                    minHeight="200px"
                  />
                </CardContent>
              </Card>

              {/* Section C: Poll Questions */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Poll Questions</CardTitle>
                    <Button size="sm" variant="outline" onClick={() => runRegenerate('questions')} disabled={!!loading}>
                      {loading?.startsWith('REGENERATE_DRAFT_QUESTIONS') ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                      Redraft Questions
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <QuestionBuilder
                    questions={editQuestions}
                    onChange={setEditQuestions}
                    maxQuestions={6}
                  />
                </CardContent>
              </Card>

              {/* Section D: Attachments for release email */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Paperclip className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                    Attachments
                    <span className="text-xs font-normal text-gray-400 dark:text-slate-500">(optional · max 5 files · 20 MB each)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {releaseAttachments.length > 0 && (
                    <div className="space-y-1.5">
                      {releaseAttachments.map((file, i) => (
                        <div key={i} className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 overflow-hidden dark:border-slate-700 dark:bg-slate-800">
                          <div className="flex items-center gap-2 min-w-0">
                            <Paperclip className="h-3.5 w-3.5 flex-shrink-0 text-gray-400 dark:text-slate-500" />
                            <span className="text-sm text-gray-700 truncate dark:text-slate-300">{file.name}</span>
                            <span className="text-xs text-gray-400 flex-shrink-0 dark:text-slate-500">
                              {file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(0)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                            </span>
                          </div>
                          <button type="button" onClick={() => setReleaseAttachments(prev => prev.filter((_, j) => j !== i))}
                            className="ml-2 flex-shrink-0 text-gray-400 hover:text-rose-500 transition-colors dark:text-slate-500">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {releaseAttachments.length < 5 && (
                    <>
                      <input
                        ref={draftFileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handleReleaseFileChange}
                      />
                      <button
                        type="button"
                        onClick={() => draftFileInputRef.current?.click()}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-2.5 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors dark:border-slate-600 dark:text-slate-400 dark:hover:border-blue-500 dark:hover:text-blue-400 dark:hover:bg-blue-900/20"
                      >
                        <Paperclip className="h-4 w-4" />
                        {releaseAttachments.length === 0 ? 'Attach files' : 'Attach more files'}
                      </button>
                    </>
                  )}
                  <p className="text-xs text-gray-400 dark:text-slate-500">These files will be included when the poll email is sent.</p>
                </CardContent>
              </Card>

              {/* Save Changes button */}
              <div className="flex justify-end">
                <Button
                  onClick={saveChanges}
                  disabled={!!loading || !hasChanges}
                  className="gap-2"
                >
                  {loading === 'SAVE_CHANGES' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save Changes
                </Button>
              </div>
            </>
          )}

          {/* Non-DRAFT: read-only email and questions */}
          {poll.status !== 'DRAFT' && (
            <>
              {poll.draft_email_body && (
                <Card>
                  <CardHeader><CardTitle>Draft Email Body</CardTitle></CardHeader>
                  <CardContent>
                    <div
                      className="rounded-md bg-gray-50 p-3 text-sm text-gray-700 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 dark:bg-slate-900 dark:text-slate-200 dark:[&_*]:!bg-transparent dark:[&_*]:!text-slate-200"
                      dangerouslySetInnerHTML={{ __html: sanitizeWordHtml(poll.draft_email_body) }}
                    />
                  </CardContent>
                </Card>
              )}

              {/* APPROVED / AWAITING_APPROVAL: edit questions in place (no re-approval needed) */}
              {(poll.status === 'APPROVED' || poll.status === 'AWAITING_APPROVAL') ? (
                <Card>
                  <CardHeader><CardTitle>Poll Questions</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <QuestionBuilder
                      questions={editQuestions}
                      onChange={setEditQuestions}
                      maxQuestions={6}
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={saveQuestions}
                        disabled={!!loading || JSON.stringify(editQuestions) === JSON.stringify(questions)}
                        className="gap-2"
                      >
                        {loading === 'UPDATE_QUESTIONS' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save Questions
                      </Button>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-slate-500">
                      {poll.status === 'AWAITING_APPROVAL'
                        ? 'Edits apply immediately to the poll form — no need to send back to draft.'
                        : 'Edits apply immediately to the poll form — no re-approval required.'}
                    </p>
                  </CardContent>
                </Card>
              ) : questions.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Poll Questions</CardTitle></CardHeader>
                  <CardContent>
                    <ol className="space-y-2 text-sm">
                      {questions.map((q, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="font-medium text-gray-500 dark:text-slate-400">{i + 1}.</span>
                          <span className="text-gray-900 dark:text-slate-100">{q.text}</span>
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              )}
            </>
          )}

        </div>

        {/* Sidebar: Actions + Timeline */}
        <div className="space-y-4">
          {/* Actions */}
          <Card>
            <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {poll.status === 'DRAFT' && (
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => {
                    if (hasChanges) {
                      if (!confirm('You have unsaved changes. Send for approval anyway?')) return
                    }
                    setApprovalRecipients(poll.requested_by ? [poll.requested_by] : [])
                    setRecipientInput('')
                    setShowApprovalPreview(true)
                  }}
                  disabled={!!loading}
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" /> Send for Approval
                </Button>
              )}

              {poll.status === 'APPROVED' && (
                <Button
                  className="w-full"
                  size="sm"
                  onClick={openReleaseDialog}
                  disabled={!!loading}
                >
                  {loading === 'RELEASE_POLL' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  <Send className="mr-1.5 h-3.5 w-3.5" /> Release Poll
                </Button>
              )}

              {poll.status === 'AWAITING_APPROVAL' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Notes (optional)</Label>
                    <Textarea
                      placeholder="Add notes..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                    />
                  </div>
                  <Button
                    className="w-full"
                    size="sm"
                    onClick={async () => {
                      await runAction('APPROVE', { notes })
                      openReleaseDialog()
                    }}
                    disabled={!!loading}
                  >
                    {loading === 'APPROVE' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    <Send className="mr-1.5 h-3.5 w-3.5" /> Approve & Release
                  </Button>
                  <Button
                    className="w-full"
                    size="sm"
                    variant="outline"
                    onClick={() => runAction('APPROVE', { notes })}
                    disabled={!!loading}
                  >
                    {loading === 'APPROVE' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    <CheckCircle className="mr-1.5 h-3.5 w-3.5" /> Approve Only
                  </Button>
                  <Button
                    className="w-full"
                    size="sm"
                    variant="outline"
                    onClick={() => runAction('REQUEST_EDIT', { notes })}
                    disabled={!!loading}
                  >
                    {loading === 'REQUEST_EDIT' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    <Edit className="mr-1.5 h-3.5 w-3.5" /> Request Edit
                  </Button>
                </>
              )}

              {['CLOSED', 'RESULTS_UPLOADED'].includes(poll.status) && (
                <>
                  <Button
                    className="w-full"
                    size="sm"
                    onClick={downloadResponses}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Download Responses (Excel)
                  </Button>
                  <Button
                    className="w-full"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShareRecipients([])
                      setShareRecipientInput('')
                      setShowShareDialog(true)
                    }}
                    disabled={!!loading}
                  >
                    Share Results via Email
                  </Button>
                  <Button
                    className="w-full"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (confirm('Reopen this poll? Employees will be able to submit responses again.')) {
                        void runAction('REOPEN')
                      }
                    }}
                    disabled={!!loading}
                  >
                    {loading === 'REOPEN' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    Reopen Poll
                  </Button>
                  <Button
                    className="w-full"
                    size="sm"
                    variant="outline"
                    onClick={() => runAction('ARCHIVE')}
                    disabled={!!loading}
                  >
                    Archive Poll
                  </Button>
                </>
              )}

              {['SENT', 'REMINDER_SENT'].includes(poll.status) && (
                <Button
                  className="w-full"
                  size="sm"
                  variant="outline"
                  disabled={!!loading}
                  onClick={() => {
                    if (!confirm('Send a reminder to all poll recipients now?')) return
                    void runAction('SEND_MANUAL_REMINDER')
                  }}
                >
                  {loading === 'SEND_MANUAL_REMINDER' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Bell className="mr-1.5 h-3.5 w-3.5" />}
                  Send Reminder Now
                </Button>
              )}

              {['SENT', 'REMINDER_SENT'].includes(poll.status) && (
                <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-slate-700">
                  <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">Extend Deadline</Label>
                  <Input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={extendDeadlineDate}
                    onChange={e => setExtendDeadlineDate(e.target.value)}
                  />
                  <Button
                    className="w-full"
                    size="sm"
                    variant="outline"
                    disabled={!extendDeadlineDate || !!loading}
                    onClick={() => {
                      if (!confirm(`Extend deadline to ${extendDeadlineDate}? An email will be sent to all poll recipients and the requester.`)) return
                      void runAction('EXTEND_DEADLINE', { new_deadline: extendDeadlineDate }).then(() => setExtendDeadlineDate(''))
                    }}
                  >
                    {loading === 'EXTEND_DEADLINE' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Extend & Notify
                  </Button>
                </div>
              )}

              {['SENT', 'REMINDER_SENT', 'AWAITING_APPROVAL', 'APPROVED'].includes(poll.status) && (
                <Button
                  className="w-full"
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (confirm('Close this poll? Employees will no longer be able to submit responses.')) {
                      void runAction('MARK_CLOSED')
                    }
                  }}
                  disabled={!!loading}
                >
                  {loading === 'MARK_CLOSED' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  <XCircle className="mr-1.5 h-3.5 w-3.5" /> Close Responses
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Audit timeline */}
          <Card>
            <CardHeader><CardTitle>Activity Timeline</CardTitle></CardHeader>
            <CardContent>
              {auditLogs.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-slate-500">No activity yet.</p>
              ) : (
                <ol className="space-y-3">
                  {auditLogs.map((log) => (
                    <li key={log.id} className="flex gap-2 text-sm">
                      <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-400 mt-1.5" />
                      <div>
                        <p className="font-medium text-gray-900 dark:text-slate-100">{log.action.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400">
                          {log.performed_by ?? 'System'} · {formatRelative(log.created_at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Approvals */}
          {approvals.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Approval History</CardTitle></CardHeader>
              <CardContent>
                <ol className="space-y-3">
                  {approvals.map((a) => (
                    <li key={a.id} className="text-sm">
                      <div className="flex items-center justify-between">
                        <span className={`font-medium capitalize ${
                          a.action === 'approved' ? 'text-green-700' :
                          a.action === 'edited' ? 'text-yellow-700' : 'text-blue-700'
                        }`}>{a.action}</span>
                        <span className="text-xs text-gray-400 dark:text-slate-500">{formatRelative(a.actioned_at)}</span>
                      </div>
                      {a.notes && <p className="mt-0.5 text-gray-600 dark:text-slate-400">{a.notes}</p>}
                      {a.actioned_by && <p className="text-xs text-gray-400 dark:text-slate-500">by {a.actioned_by}</p>}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Poll Responses — full width */}
      {['SENT', 'REMINDER_SENT', 'CLOSED', 'RESULTS_UPLOADED', 'ARCHIVED', 'RMS_PUBLISHED'].includes(poll.status) && (() => {
        type EntryType = {
          email?: string
          respondent?: string
          submitted_at: string
          answers: { question: string; answer: string }[]
          actionable?: boolean | null
          remarks?: string
          classification?: 'rms' | 'non_rms' | 'partial' | null
          status?: 'wip' | 'completed' | null
          reply_message?: string
          reply_sent_at?: string
        }
        const entries: EntryType[] = response?.response_data ? JSON.parse(response.response_data) as EntryType[] : []

        const stats = {
          total: entries.length,
          actionable: entries.filter(e => e.actionable === true).length,
          notActionable: entries.filter(e => e.actionable === false).length,
          pending: entries.filter(e => e.actionable === null || e.actionable === undefined).length,
          rms: entries.filter(e => e.classification === 'rms').length,
          nonRms: entries.filter(e => e.classification === 'non_rms').length,
          partial: entries.filter(e => e.classification === 'partial').length,
        }

        return (
          <Card className="mt-6">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>
                  Poll Responses
                  <span className="ml-2 text-sm font-normal text-gray-400 dark:text-slate-500">
                    ({entries.length} {entries.length === 1 ? 'response' : 'responses'})
                  </span>
                </CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void refreshResponse()}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
                  </Button>
                  {entries.length > 0 && (
                    <Button size="sm" variant="outline" onClick={downloadResponses}>
                      <Download className="mr-1.5 h-3.5 w-3.5" /> Download Excel
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              {/* Summary stats */}
              {entries.length > 0 && (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'Total', value: stats.total, cls: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300' },
                      { label: 'Actionable', value: stats.actionable, cls: 'bg-emerald-100 text-emerald-700' },
                      { label: 'Not Actionable', value: stats.notActionable, cls: 'bg-slate-100 text-slate-600' },
                      { label: 'Pending Review', value: stats.pending, cls: 'bg-amber-100 text-amber-700' },
                    ].map(s => (
                      <div key={s.label} className={`rounded-xl px-3 py-2.5 text-center ${s.cls}`}>
                        <p className="text-2xl font-bold leading-none">{s.value}</p>
                        <p className="mt-1 text-xs font-medium">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'RMS', value: stats.rms, cls: 'bg-blue-100 text-blue-700' },
                      { label: 'Non-RMS', value: stats.nonRms, cls: 'bg-purple-100 text-purple-700' },
                      { label: 'Partial', value: stats.partial, cls: 'bg-orange-100 text-orange-700' },
                    ].map(s => (
                      <div key={s.label} className={`rounded-xl px-3 py-2.5 text-center ${s.cls}`}>
                        <p className="text-2xl font-bold leading-none">{s.value}</p>
                        <p className="mt-1 text-xs font-medium">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {entries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-6 py-10 text-center dark:border-slate-700">
                  <p className="text-sm font-medium text-gray-400 dark:text-slate-500">No responses yet</p>
                  <p className="mt-1 text-xs text-gray-300 dark:text-slate-600">Responses will appear here as employees fill out the poll. Auto-refreshes every 30 s.</p>
                </div>
              ) : (() => {
                // Derive question headers from first entry with answers
                const qHeaders = entries[0]?.answers.map((a, qi) => ({ label: `Q${qi + 1}`, question: a.question })) ?? []

                return (
                  <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 dark:bg-slate-800 dark:border-slate-700">
                          <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap dark:text-slate-400">Emp Name</th>
                          {qHeaders.map(q => (
                            <th key={q.label} className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide min-w-[160px] dark:text-slate-400">
                              <span className="text-gray-700 dark:text-slate-300">{q.label}</span>
                              <p className="text-[10px] font-normal normal-case tracking-normal text-gray-400 mt-0.5 whitespace-normal dark:text-slate-500">{q.question}</p>
                            </th>
                          ))}
                          <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap dark:text-slate-400">Classify</th>
                          <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap dark:text-slate-400">RMS Actions</th>
                          <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap dark:text-slate-400">Progress</th>
                          <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap dark:text-slate-400">Reply</th>
                          <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap dark:text-slate-400">Mark As</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                        {entries.map((entry, i) => {
                          const currentCls = entryClassifications[i] !== undefined ? entryClassifications[i] : (entry.classification ?? null)
                          const currentStatus = entryStatuses[i] !== undefined ? entryStatuses[i] : (entry.status ?? null)

                          return (
                            <tr key={i} className="hover:bg-gray-50 transition-colors align-top dark:hover:bg-slate-700/30">
                              {/* Emp Name */}
                              <td className="px-3 py-3 whitespace-nowrap">
                                <p className="font-semibold text-gray-800 dark:text-slate-200">{entry.respondent ?? 'Anonymous'}</p>
                                <p className="text-gray-400 truncate max-w-[140px] dark:text-slate-500" title={entry.email}>{entry.email ?? ''}</p>
                                <p className="text-gray-300 mt-0.5 dark:text-slate-600">{formatRelative(entry.submitted_at)}</p>
                                {entry.reply_sent_at && <span className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600">Replied</span>}
                              </td>

                              {/* Q1…Qn answers */}
                              {entry.answers.map((a, ai) => (
                                <td key={ai} className="px-3 py-3 min-w-[160px]">
                                  <p className="text-gray-700 leading-snug whitespace-pre-wrap dark:text-slate-300">
                                    {a.answer || <span className="italic text-gray-300 dark:text-slate-600">—</span>}
                                  </p>
                                </td>
                              ))}

                              {/* Classify */}
                              <td className="px-3 py-3 whitespace-nowrap">
                                <div className="flex flex-col gap-1">
                                  {(['rms', 'non_rms', 'partial'] as const).map(key => {
                                    const labels = { rms: 'RMS', non_rms: 'Non-RMS', partial: 'Partial' }
                                    const activeStyles = { rms: 'bg-blue-500 text-white', non_rms: 'bg-purple-500 text-white', partial: 'bg-orange-500 text-white' }
                                    const inactiveStyles = { rms: 'border-blue-200 text-blue-600 hover:bg-blue-50', non_rms: 'border-purple-200 text-purple-600 hover:bg-purple-50', partial: 'border-orange-200 text-orange-600 hover:bg-orange-50' }
                                    const isActive = currentCls === key
                                    return (
                                      <button key={key} type="button" disabled={savingEntry === i}
                                        onClick={() => {
                                          const next = isActive ? null : key
                                          setEntryClassifications(p => ({ ...p, [i]: next }))
                                          void saveEntry(i, entry.actionable ?? null, next)
                                        }}
                                        className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border transition-colors ${isActive ? activeStyles[key] + ' border-transparent' : 'bg-white dark:bg-slate-800 ' + inactiveStyles[key]}`}
                                      >
                                        {labels[key]}
                                      </button>
                                    )
                                  })}
                                </div>
                              </td>

                              {/* RMS Actions */}
                              <td className="px-3 py-3 whitespace-nowrap">
                                <div className="flex flex-col gap-1">
                                  <a href="https://rms.koenig-solutions.com/RMS_Feedback/RMSF.aspx" target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 transition-colors dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40">
                                    <ExternalLink className="h-3 w-3" /> RMS Task
                                  </a>
                                  <a href="https://rms.koenig-solutions.com/RMS_Feedback/RMSF.aspx" target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-[10px] font-semibold text-purple-700 hover:bg-purple-100 transition-colors dark:border-purple-900/50 dark:bg-purple-900/20 dark:text-purple-300 dark:hover:bg-purple-900/40">
                                    <ExternalLink className="h-3 w-3" /> Non-RMS
                                  </a>
                                </div>
                              </td>

                              {/* Progress */}
                              <td className="px-3 py-3 whitespace-nowrap">
                                <div className="flex flex-col gap-1">
                                  <button type="button" disabled={savingEntry === i}
                                    onClick={() => void saveStatus(i, 'wip')}
                                    className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border transition-colors ${currentStatus === 'wip' ? 'bg-amber-500 text-white border-transparent' : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'}`}>
                                    WIP
                                  </button>
                                  <button type="button" disabled={savingEntry === i}
                                    onClick={() => void saveStatus(i, 'completed')}
                                    className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border transition-colors ${currentStatus === 'completed' ? 'bg-green-500 text-white border-transparent' : 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'}`}>
                                    Done
                                  </button>
                                </div>
                              </td>

                              {/* Reply */}
                              <td className="px-3 py-3" style={{ minWidth: 180 }}>
                                {entry.reply_sent_at && !entryReplies[i] && (
                                  <p className="text-[10px] text-indigo-600 font-medium mb-1">Sent {formatRelative(entry.reply_sent_at)}</p>
                                )}
                                <textarea
                                  placeholder={`Reply to ${entry.respondent ?? 'respondent'}…`}
                                  value={entryReplies[i] ?? ''}
                                  onChange={e => setEntryReplies(p => ({ ...p, [i]: e.target.value }))}
                                  rows={entryReplies[i] ? 4 : 2}
                                  onFocus={e => { e.currentTarget.rows = 4 }}
                                  onBlur={e => { if (!e.currentTarget.value) e.currentTarget.rows = 2 }}
                                  className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 transition resize-y min-h-[40px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-indigo-500 dark:focus:ring-indigo-900/30"
                                />
                                <button type="button" disabled={sendingReply === i || !entryReplies[i]?.trim()}
                                  onClick={() => void sendReply(i)}
                                  className="mt-1 inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50">
                                  {sendingReply === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                  {entry.reply_sent_at ? 'Re-send' : 'Send'}
                                </button>
                              </td>

                              {/* Mark As */}
                              <td className="px-3 py-3 whitespace-nowrap">
                                <div className="flex flex-col gap-1">
                                  <button type="button" disabled={savingEntry === i}
                                    onClick={() => void saveEntry(i, true, currentCls)}
                                    className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border transition-colors ${entry.actionable === true ? 'bg-emerald-500 text-white border-transparent' : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'}`}>
                                    Actionable
                                  </button>
                                  <button type="button" disabled={savingEntry === i}
                                    onClick={() => void saveEntry(i, false, currentCls)}
                                    className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border transition-colors ${entry.actionable === false ? 'bg-slate-500 text-white border-transparent' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                                    Not Actionable
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        )
      })()}

      {/* Release Poll Dialog */}
      <Dialog open={showReleaseDialog} onOpenChange={setShowReleaseDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Release Poll</DialogTitle>
            <DialogDescription>
              Select the hunt groups to send this poll to.
            </DialogDescription>
          </DialogHeader>

          {/* Hunt group dropdown */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">Hunt Groups</Label>
            <div className="relative" ref={huntGroupDropdownRef}>
              <button
                type="button"
                onClick={() => !huntGroupsLoading && setHuntGroupDropdownOpen(o => !o)}
                className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                disabled={huntGroupsLoading}
              >
                <span className={selectedHuntGroupIds.length === 0 ? 'text-gray-400 dark:text-slate-500' : ''}>
                  {huntGroupsLoading
                    ? 'Loading...'
                    : selectedHuntGroupIds.length === 0
                      ? 'Select hunt groups...'
                      : `${selectedHuntGroupIds.length} group${selectedHuntGroupIds.length > 1 ? 's' : ''} selected`}
                </span>
                {huntGroupsLoading
                  ? <Loader2 className="h-4 w-4 animate-spin text-gray-400 dark:text-slate-500" />
                  : <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform dark:text-slate-500 ${huntGroupDropdownOpen ? 'rotate-180' : ''}`} />}
              </button>

              {huntGroupDropdownOpen && huntGroups.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  {huntGroups.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-gray-400 text-center dark:text-slate-500">No hunt groups configured.</p>
                  ) : (
                    huntGroups.map((group) => (
                      <label key={group.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors dark:hover:bg-slate-700">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600"
                          checked={selectedHuntGroupIds.includes(group.id)}
                          onChange={(e) => {
                            setSelectedHuntGroupIds(prev =>
                              e.target.checked ? [...prev, group.id] : prev.filter(id => id !== group.id)
                            )
                          }}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{group.name}</p>
                          <p className="text-xs text-gray-400 truncate dark:text-slate-500">{group.email}</p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              )}

              {huntGroupDropdownOpen && huntGroups.length === 0 && !huntGroupsLoading && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-gray-200 bg-white shadow-lg px-3 py-3 dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-sm text-gray-400 text-center dark:text-slate-500">No hunt groups configured. Add them in Settings.</p>
                </div>
              )}
            </div>

            {/* Selected group chips */}
            {selectedHuntGroupIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {huntGroups.filter(g => selectedHuntGroupIds.includes(g.id)).map(g => (
                  <span key={g.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900/20 dark:border-blue-900/50 dark:text-blue-300">
                    {g.name}
                    <button type="button" onClick={() => setSelectedHuntGroupIds(prev => prev.filter(id => id !== g.id))} className="hover:text-red-600 ml-0.5 dark:hover:text-red-400">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Manual individual email addresses */}
          <div className="space-y-1.5 pt-1 border-t border-gray-100 dark:border-slate-700">
            <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">
              Add individual emails
            </Label>
            <Textarea
              value={customReleaseText}
              onChange={(e) => setCustomReleaseText(e.target.value)}
              placeholder={'john@koenig-solutions.com\njane@koenig-solutions.com\n\nOne per line, or comma-separated.'}
              rows={3}
              className="resize-none text-sm"
            />
            {customReleaseText.trim() && (
              <p className="text-xs text-gray-400 dark:text-slate-500">
                {parseEmails(customReleaseText).length} email(s) detected
              </p>
            )}
          </div>

          {/* Attachments */}
          <div className="space-y-2 pt-1 border-t border-gray-100 dark:border-slate-700">
            <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">
              Attachments <span className="normal-case font-normal text-gray-400 dark:text-slate-500">(optional · max 5 files · 20 MB each)</span>
            </Label>

            {/* Files carried over from the approval step (saved server-side) */}
            {existingAttachments.filter(a => !removedAttachmentNames.includes(a.name)).length > 0 && (
              <div className="space-y-1.5">
                {existingAttachments
                  .filter(a => !removedAttachmentNames.includes(a.name))
                  .map((file) => (
                    <div key={file.name} className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 overflow-hidden dark:border-slate-700 dark:bg-slate-800">
                      <div className="flex items-center gap-2 min-w-0">
                        <Paperclip className="h-3.5 w-3.5 flex-shrink-0 text-gray-400 dark:text-slate-500" />
                        <span className="text-sm text-gray-700 truncate dark:text-slate-300">{file.name}</span>
                        <span className="text-xs text-gray-400 flex-shrink-0 dark:text-slate-500">
                          {file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(0)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-gray-400 flex-shrink-0 dark:text-slate-500">from approval</span>
                      </div>
                      <button type="button" onClick={() => setRemovedAttachmentNames(prev => [...prev, file.name])}
                        className="ml-2 flex-shrink-0 text-gray-400 hover:text-rose-500 transition-colors dark:text-slate-500">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
              </div>
            )}

            {releaseAttachments.length > 0 && (
              <div className="space-y-1.5">
                {releaseAttachments.map((file, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 overflow-hidden dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex items-center gap-2 min-w-0">
                      <Paperclip className="h-3.5 w-3.5 flex-shrink-0 text-gray-400 dark:text-slate-500" />
                      <span className="text-sm text-gray-700 truncate dark:text-slate-300">{file.name}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0 dark:text-slate-500">
                        {file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(0)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                      </span>
                    </div>
                    <button type="button" onClick={() => setReleaseAttachments(prev => prev.filter((_, j) => j !== i))}
                      className="ml-2 flex-shrink-0 text-gray-400 hover:text-rose-500 transition-colors dark:text-slate-500">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {releaseAttachments.length < 5 && (
              <>
                <input
                  ref={releaseFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleReleaseFileChange}
                />
                <button
                  type="button"
                  onClick={() => releaseFileInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-2.5 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors dark:border-slate-600 dark:text-slate-400 dark:hover:border-blue-500 dark:hover:text-blue-400 dark:hover:bg-blue-900/20"
                >
                  <Paperclip className="h-4 w-4" />
                  {releaseAttachments.length === 0 ? 'Attach files' : 'Attach more files'}
                </button>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReleaseDialog(false)}>
              Cancel
            </Button>
            {(() => {
              const total = selectedHuntGroupIds.length + parseEmails(customReleaseText).length
              return (
                <Button onClick={releasePoll} disabled={huntGroupsLoading}>
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Release to {total > 0 ? `${total} recipient${total > 1 ? 's' : ''}` : 'selected recipients'}
                </Button>
              )
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Results Dialog */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share Poll Results</DialogTitle>
            <DialogDescription>
              Select recipients. The Excel response file will be attached to the email.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="email"
                value={shareRecipientInput}
                onChange={(e) => setShareRecipientInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addShareRecipient() } }}
                placeholder="recipient@koenig-solutions.com"
                className="flex-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-900/30"
              />
              <Button type="button" size="sm" variant="outline" onClick={addShareRecipient}>Add</Button>
            </div>

            {shareRecipients.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {shareRecipients.map((email) => (
                  <span key={email} className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs text-blue-700 dark:bg-blue-900/20 dark:border-blue-900/50 dark:text-blue-300">
                    {email}
                    <button type="button" onClick={() => setShareRecipients(prev => prev.filter(e => e !== email))} className="hover:text-red-600 ml-0.5 dark:hover:text-red-400">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 dark:text-slate-500">Press Enter or comma to add multiple recipients.</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowShareDialog(false)}>Cancel</Button>
            <Button
              disabled={shareRecipients.length === 0 || !!loading}
              onClick={() => {
                setShowShareDialog(false)
                void runAction('SHARE_RESULTS', { recipients: shareRecipients })
              }}
            >
              {loading === 'SHARE_RESULTS' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Send Results ({shareRecipients.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approval Preview Dialog */}
      <Dialog open={showApprovalPreview} onOpenChange={setShowApprovalPreview}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send for Approval — Preview</DialogTitle>
            <DialogDescription>
              Review the approval email and select recipients before sending.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Email Preview */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3 dark:border-slate-700 dark:bg-slate-800/50">
              <h3 className="font-semibold text-gray-900 dark:text-slate-100">Poll Approval Request: {poll.subject || poll.topic}</h3>
              <div className="text-sm space-y-1 text-gray-700 dark:text-slate-300">
                <p><span className="font-medium">Department:</span> {poll.department}</p>
                <p><span className="font-medium">Deadline:</span> {formatDate(poll.deadline)}</p>
              </div>

              {poll.draft_email_body && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 dark:text-slate-400">Draft Email Body</p>
                  <div
                    className="rounded bg-white border border-gray-200 p-3 text-sm text-gray-700 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200 dark:[&_*]:!bg-transparent dark:[&_*]:!text-slate-200"
                    dangerouslySetInnerHTML={{ __html: sanitizeWordHtml(poll.draft_email_body) }}
                  />
                </div>
              )}

              {questions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 dark:text-slate-400">Poll Questions</p>
                  <ol className="text-sm space-y-1">
                    {questions.map((q, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="font-medium text-gray-400 dark:text-slate-500">{i + 1}.</span>
                        <span className="text-gray-800 dark:text-slate-200">{q.text}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {poll.ms_form_link && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 dark:text-slate-400">Poll Form Link</p>
                  <a href={poll.ms_form_link} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline break-all">
                    {poll.ms_form_link}
                  </a>
                </div>
              )}
            </div>

            {/* Recipient Selector */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Send To</Label>
              <div className="flex gap-2">
                <Input
                  value={recipientInput}
                  onChange={(e) => setRecipientInput(e.target.value)}
                  placeholder="Enter email address and press Enter"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      const email = recipientInput.trim().replace(/,$/, '')
                      if (email && !approvalRecipients.includes(email)) {
                        setApprovalRecipients(prev => [...prev, email])
                      }
                      setRecipientInput('')
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const email = recipientInput.trim()
                    if (email && !approvalRecipients.includes(email)) {
                      setApprovalRecipients(prev => [...prev, email])
                    }
                    setRecipientInput('')
                  }}
                >
                  Add
                </Button>
              </div>

              {approvalRecipients.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {approvalRecipients.map((email) => (
                    <span key={email} className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs text-blue-700 dark:bg-blue-900/20 dark:border-blue-900/50 dark:text-blue-300">
                      {email}
                      <button
                        type="button"
                        onClick={() => setApprovalRecipients(prev => prev.filter(e => e !== email))}
                        className="hover:text-red-600 transition-colors ml-0.5 dark:hover:text-red-400"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <p className="text-xs text-gray-400 dark:text-slate-500">Press Enter or comma to add multiple recipients.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApprovalPreview(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setShowApprovalPreview(false)
                let attachments: { name: string; contentType: string; contentBytes: string }[] = []
                if (releaseAttachments.length > 0) {
                  try {
                    attachments = await Promise.all(
                      releaseAttachments.map(async (f) => ({
                        name: f.name,
                        contentType: f.type || 'application/octet-stream',
                        contentBytes: await fileToBase64(f),
                      }))
                    )
                  } catch {
                    toast.error('Failed to process attachments.')
                    return
                  }
                }
                void runAction('SEND_FOR_APPROVAL', { recipients: approvalRecipients, attachments })
              }}
              disabled={approvalRecipients.length === 0 || !!loading}
            >
              {loading === 'SEND_FOR_APPROVAL' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              <Send className="mr-1.5 h-3.5 w-3.5" /> Send for Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
