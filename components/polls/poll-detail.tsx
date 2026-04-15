'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink, CheckCircle, XCircle, Edit, Send, AlertCircle, Loader2, Download, RefreshCw, Save, X, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { StatusBadge } from './status-badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { formatDate, formatDateTime, formatRelative, isApprovalOverdue } from '@/lib/utils'
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
  const [editEmailBody, setEditEmailBody] = useState(initialPoll.draft_email_body || '')
  const [editQuestions, setEditQuestions] = useState<Question[]>(parseQuestions(initialPoll.questions ?? ''))
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

  // Share results state
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [shareRecipients, setShareRecipients] = useState<string[]>([])
  const [shareRecipientInput, setShareRecipientInput] = useState('')

  // Per-entry remarks state (index → text)
  const [entryRemarks, setEntryRemarks] = useState<Record<number, string>>({})
  const [savingEntry, setSavingEntry] = useState<number | null>(null)

  const router = useRouter()

  // Sync local edit state when poll changes (after actions)
  useEffect(() => {
    if (poll.status === 'DRAFT') {
      setEditSubject(poll.subject || `Poll: ${poll.topic}`)
      setEditEmailBody(poll.draft_email_body || '')
      setEditQuestions(parseQuestions(poll.questions ?? ''))
    }
  }, [poll])

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

  const hasChanges =
    editSubject !== (poll.subject || `Poll: ${poll.topic}`) ||
    editEmailBody !== (poll.draft_email_body || '') ||
    JSON.stringify(editQuestions) !== JSON.stringify(parseQuestions(poll.questions ?? ''))

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

  const saveEntry = async (index: number, actionable: boolean | null) => {
    if (!response?.response_data) return
    setSavingEntry(index)
    type EntryType = { email?: string; respondent?: string; submitted_at: string; answers: { question: string; answer: string }[]; actionable?: boolean | null; remarks?: string }
    const entries = JSON.parse(response.response_data) as EntryType[]
    const remarks = entryRemarks[index] ?? entries[index]?.remarks ?? ''
    try {
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UPDATE_ENTRY_ACTIONABLE', entryIndex: index, actionable, remarks }),
      })
      if (!res.ok) {
        const d = await res.json() as { error: string }
        throw new Error(d.error)
      }
      // Optimistically update local response state
      const updated = entries.map((e, i) => i === index ? { ...e, actionable, remarks } : e)
      setResponse(prev => prev ? { ...prev, response_data: JSON.stringify(updated) } : prev)
      toast.success('Entry saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingEntry(null)
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

  const openReleaseDialog = async () => {
    setShowReleaseDialog(true)
    setSelectedHuntGroupIds([])
    setCustomReleaseText('')
    setHuntGroupDropdownOpen(false)
    setHuntGroupsLoading(true)
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
    setShowReleaseDialog(false)
    void runAction('RELEASE_POLL', { allEmails })
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
            <h2 className="text-xl font-bold text-white">{poll.topic}</h2>
            <p className="text-sm text-white/50">Poll ID: {poll.id.slice(0, 8)}...</p>
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
                  <dt className="text-gray-500">Department</dt>
                  <dd className="font-medium text-gray-900">{poll.department}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Requested By</dt>
                  <dd className="font-medium text-gray-900">{poll.requested_by}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Source</dt>
                  <dd className="font-medium capitalize text-gray-900">{poll.source}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Deadline</dt>
                  <dd className="font-medium text-gray-900">{formatDateTime(poll.deadline)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Created</dt>
                  <dd className="font-medium text-gray-900">{formatDateTime(poll.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Sent At</dt>
                  <dd className="font-medium text-gray-900">{formatDateTime(poll.sent_at)}</dd>
                </div>
                {poll.ms_form_link && (
                  <div className="col-span-2">
                    <dt className="text-gray-500">Poll Form</dt>
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
                    <dt className="text-gray-500">RMS Task ID</dt>
                    <dd className="font-medium text-gray-900">{poll.rms_task_id}</dd>
                  </div>
                )}
                {poll.remarks && (
                  <div className="col-span-2">
                    <dt className="text-gray-500">Remarks</dt>
                    <dd className="text-gray-700">{poll.remarks}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* DRAFT status — editable sections */}
          {poll.status === 'DRAFT' && (
            <>
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
                  <p className="text-xs text-gray-400">
                    This subject will appear on the poll response form and in all emails.
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
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${useKeywords ? 'bg-cyan-600' : 'bg-gray-200'}`}
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
                  <Textarea
                    value={editEmailBody}
                    onChange={(e) => setEditEmailBody(e.target.value)}
                    rows={8}
                    className="font-mono text-sm"
                    placeholder="Email body will appear here..."
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
                    <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-wrap">
                      {poll.draft_email_body}
                    </div>
                  </CardContent>
                </Card>
              )}

              {questions.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Poll Questions</CardTitle></CardHeader>
                  <CardContent>
                    <ol className="space-y-2 text-sm">
                      {questions.map((q, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="font-medium text-gray-500">{i + 1}.</span>
                          <span className="text-gray-900">{q.text}</span>
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

              {poll.status === 'CLOSED' && (
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

              {!['CLOSED', 'RESULTS_UPLOADED', 'ARCHIVED'].includes(poll.status) && (
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
                <p className="text-sm text-gray-400">No activity yet.</p>
              ) : (
                <ol className="space-y-3">
                  {auditLogs.map((log) => (
                    <li key={log.id} className="flex gap-2 text-sm">
                      <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-400 mt-1.5" />
                      <div>
                        <p className="font-medium text-gray-900">{log.action.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-gray-500">
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
                        <span className="text-xs text-gray-400">{formatRelative(a.actioned_at)}</span>
                      </div>
                      {a.notes && <p className="mt-0.5 text-gray-600">{a.notes}</p>}
                      {a.actioned_by && <p className="text-xs text-gray-400">by {a.actioned_by}</p>}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Results & Follow-up — full width */}
      {response?.response_data && (() => {
        type EntryType = {
          email?: string
          respondent?: string
          submitted_at: string
          answers: { question: string; answer: string }[]
          actionable?: boolean | null
          remarks?: string
        }
        const entries = JSON.parse(response.response_data) as EntryType[]
        return (
          <Card className="mt-6">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>
                  Results & Follow-up{' '}
                  <span className="text-sm font-normal text-gray-400">
                    ({entries.length} {entries.length === 1 ? 'response' : 'responses'})
                  </span>
                </CardTitle>
                <Button size="sm" variant="outline" onClick={downloadResponses}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Download Excel
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {entries.map((entry, i) => (
                <div key={i} className="rounded-xl border border-gray-200">
                  {/* Entry header */}
                  <div className="flex items-center justify-between bg-gray-50 px-5 py-3 border-b border-gray-200 rounded-t-xl">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{entry.respondent ?? 'Anonymous'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{entry.email ?? ''} · {formatDateTime(entry.submitted_at)}</p>
                    </div>
                    {entry.actionable === true && (
                      <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700">Actionable</span>
                    )}
                    {entry.actionable === false && (
                      <span className="text-xs font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-600">Not Actionable</span>
                    )}
                  </div>

                  {/* Answers */}
                  <div className="px-5 py-4 space-y-3">
                    {entry.answers.map((a, ai) => (
                      <div key={ai} className="text-sm">
                        <p className="font-semibold text-gray-500">{ai + 1}. {a.question}</p>
                        <p className="mt-1 pl-4 text-gray-800">
                          {a.answer ? a.answer : <span className="italic text-gray-400">No answer</span>}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Actionable / Remarks / Save */}
                  <div className="border-t border-gray-100 px-5 py-4 space-y-3 bg-gray-50 rounded-b-xl">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Follow-up</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void saveEntry(i, true)}
                        disabled={savingEntry === i}
                        className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          entry.actionable === true
                            ? 'bg-emerald-500 text-white border-emerald-500'
                            : 'border-gray-300 text-gray-600 hover:border-emerald-400 hover:text-emerald-600'
                        }`}
                      >
                        Actionable
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveEntry(i, false)}
                        disabled={savingEntry === i}
                        className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          entry.actionable === false
                            ? 'bg-gray-500 text-white border-gray-500'
                            : 'border-gray-300 text-gray-600 hover:border-gray-400'
                        }`}
                      >
                        Not Actionable
                      </button>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500">Remarks</label>
                      <textarea
                        placeholder="Add internal remarks about this response..."
                        value={entryRemarks[i] ?? entry.remarks ?? ''}
                        onChange={e => setEntryRemarks(p => ({ ...p, [i]: e.target.value }))}
                        rows={3}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition resize-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void saveEntry(i, entry.actionable ?? null)}
                      disabled={savingEntry === i}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-xs font-semibold text-gray-700 hover:border-cyan-400 hover:text-cyan-600 transition-colors disabled:opacity-50"
                    >
                      {savingEntry === i
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Save className="h-3.5 w-3.5" />
                      }
                      Save
                    </button>
                  </div>
                </div>
              ))}
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
            <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Hunt Groups</Label>
            <div className="relative" ref={huntGroupDropdownRef}>
              <button
                type="button"
                onClick={() => !huntGroupsLoading && setHuntGroupDropdownOpen(o => !o)}
                className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
                disabled={huntGroupsLoading}
              >
                <span className={selectedHuntGroupIds.length === 0 ? 'text-gray-400' : ''}>
                  {huntGroupsLoading
                    ? 'Loading...'
                    : selectedHuntGroupIds.length === 0
                      ? 'Select hunt groups...'
                      : `${selectedHuntGroupIds.length} group${selectedHuntGroupIds.length > 1 ? 's' : ''} selected`}
                </span>
                {huntGroupsLoading
                  ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  : <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${huntGroupDropdownOpen ? 'rotate-180' : ''}`} />}
              </button>

              {huntGroupDropdownOpen && huntGroups.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                  {huntGroups.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-gray-400 text-center">No hunt groups configured.</p>
                  ) : (
                    huntGroups.map((group) => (
                      <label key={group.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          checked={selectedHuntGroupIds.includes(group.id)}
                          onChange={(e) => {
                            setSelectedHuntGroupIds(prev =>
                              e.target.checked ? [...prev, group.id] : prev.filter(id => id !== group.id)
                            )
                          }}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{group.name}</p>
                          <p className="text-xs text-gray-400 truncate">{group.email}</p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              )}

              {huntGroupDropdownOpen && huntGroups.length === 0 && !huntGroupsLoading && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-gray-200 bg-white shadow-lg px-3 py-3">
                  <p className="text-sm text-gray-400 text-center">No hunt groups configured. Add them in Settings.</p>
                </div>
              )}
            </div>

            {/* Selected group chips */}
            {selectedHuntGroupIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {huntGroups.filter(g => selectedHuntGroupIds.includes(g.id)).map(g => (
                  <span key={g.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs text-blue-700">
                    {g.name}
                    <button type="button" onClick={() => setSelectedHuntGroupIds(prev => prev.filter(id => id !== g.id))} className="hover:text-red-600 ml-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Manual individual email addresses */}
          <div className="space-y-1.5 pt-1 border-t border-gray-100">
            <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
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
              <p className="text-xs text-gray-400">
                {parseEmails(customReleaseText).length} email(s) detected
              </p>
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
                className="flex-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
              <Button type="button" size="sm" variant="outline" onClick={addShareRecipient}>Add</Button>
            </div>

            {shareRecipients.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {shareRecipients.map((email) => (
                  <span key={email} className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs text-blue-700">
                    {email}
                    <button type="button" onClick={() => setShareRecipients(prev => prev.filter(e => e !== email))} className="hover:text-red-600 ml-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400">Press Enter or comma to add multiple recipients.</p>
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
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
              <h3 className="font-semibold text-gray-900">Poll Approval Request: {poll.topic}</h3>
              <div className="text-sm space-y-1 text-gray-700">
                <p><span className="font-medium">Department:</span> {poll.department}</p>
                <p><span className="font-medium">Deadline:</span> {formatDate(poll.deadline)}</p>
              </div>

              {poll.draft_email_body && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Draft Email Body</p>
                  <div className="rounded bg-white border border-gray-200 p-3 text-sm text-gray-700 whitespace-pre-wrap">
                    {poll.draft_email_body}
                  </div>
                </div>
              )}

              {questions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Poll Questions</p>
                  <ol className="text-sm space-y-1">
                    {questions.map((q, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="font-medium text-gray-400">{i + 1}.</span>
                        <span className="text-gray-800">{q.text}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {poll.ms_form_link && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Poll Form Link</p>
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
                    <span key={email} className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs text-blue-700">
                      {email}
                      <button
                        type="button"
                        onClick={() => setApprovalRecipients(prev => prev.filter(e => e !== email))}
                        className="hover:text-red-600 transition-colors ml-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <p className="text-xs text-gray-400">Press Enter or comma to add multiple recipients.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApprovalPreview(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowApprovalPreview(false)
                void runAction('SEND_FOR_APPROVAL', { recipients: approvalRecipients })
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
