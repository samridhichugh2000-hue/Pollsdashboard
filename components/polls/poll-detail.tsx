'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink, CheckCircle, XCircle, Edit, Send, AlertCircle, Loader2, Download, RefreshCw, Plus, Trash2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { StatusBadge } from './status-badge'
import { formatDateTime, formatRelative, isApprovalOverdue } from '@/lib/utils'
import type { Poll, PollApproval, AuditLog, PollResponse } from '@/types'

interface PollDetailProps {
  poll: Poll
  approvals: PollApproval[]
  auditLogs: AuditLog[]
  response: PollResponse | null
}

export function PollDetail({ poll: initialPoll, approvals, auditLogs, response: initialResponse }: PollDetailProps) {
  const [poll, setPoll] = useState(initialPoll)
  const [response, setResponse] = useState(initialResponse)
  const [loading, setLoading] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [emailReply, setEmailReply] = useState('')

  // Draft edit state
  const [editSubject, setEditSubject] = useState(initialPoll.subject || `Poll: ${initialPoll.topic}`)
  const [editEmailBody, setEditEmailBody] = useState(initialPoll.draft_email_body || '')
  const [editQuestions, setEditQuestions] = useState<string[]>(
    initialPoll.questions ? (JSON.parse(initialPoll.questions) as string[]) : []
  )
  const [keywords, setKeywords] = useState('')
  const [tone, setTone] = useState('professional')

  const router = useRouter()

  // Sync local edit state when poll changes (after actions)
  useEffect(() => {
    if (poll.status === 'DRAFT') {
      setEditSubject(poll.subject || `Poll: ${poll.topic}`)
      setEditEmailBody(poll.draft_email_body || '')
      setEditQuestions(poll.questions ? (JSON.parse(poll.questions) as string[]) : [])
    }
  }, [poll])

  const hasChanges =
    editSubject !== (poll.subject || `Poll: ${poll.topic}`) ||
    editEmailBody !== (poll.draft_email_body || '') ||
    JSON.stringify(editQuestions) !== JSON.stringify(poll.questions ? JSON.parse(poll.questions) : [])

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

  const runRegenerate = async (section: string) => {
    const actionKey = `REGENERATE_DRAFT_${section.toUpperCase()}`
    setLoading(actionKey)
    try {
      const res = await fetch(`/api/polls/${poll.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REGENERATE_DRAFT', section, keywords, tone }),
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

  const overdue = poll.status === 'AWAITING_APPROVAL' && isApprovalOverdue(poll.updated_at)

  const downloadResponses = () => {
    window.open(`/api/polls/${poll.id}/download`, '_blank')
  }

  const questions: string[] = poll.questions ? JSON.parse(poll.questions) : []

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
                      />
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
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runRegenerate('email')}
                      disabled={!!loading}
                    >
                      {loading === 'REGENERATE_DRAFT_EMAIL' ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 h-3 w-3" />
                      )}
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
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runRegenerate('questions')}
                      disabled={!!loading}
                    >
                      {loading === 'REGENERATE_DRAFT_QUESTIONS' ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 h-3 w-3" />
                      )}
                      Redraft Questions
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {editQuestions.map((q, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-400 w-5 shrink-0">{i + 1}.</span>
                      <Input
                        value={q}
                        onChange={(e) => {
                          const updated = [...editQuestions]
                          updated[i] = e.target.value
                          setEditQuestions(updated)
                        }}
                        className="flex-1"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="shrink-0 text-gray-400 hover:text-red-500"
                        onClick={() => setEditQuestions(editQuestions.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  {editQuestions.length < 4 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1"
                      onClick={() => setEditQuestions([...editQuestions, ''])}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add Question
                    </Button>
                  )}
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
                          <span className="text-gray-900">{q}</span>
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Response management */}
          {['CLOSED', 'RESULTS_UPLOADED', 'ARCHIVED'].includes(poll.status) && (
            <Card>
              <CardHeader><CardTitle>Response Management</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {response ? (
                  <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
                    Responses collected. {response.is_actionable ? 'Marked as actionable.' : 'Not actionable.'}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No responses fetched yet.</p>
                )}

                <div className="space-y-2">
                  <Label>Follow-up Email Response</Label>
                  <Textarea
                    placeholder="Type a follow-up email to send to the requester..."
                    value={emailReply}
                    onChange={(e) => setEmailReply(e.target.value)}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runAction('UPDATE_RESPONSE', { is_actionable: true, email_response: emailReply })}
                      disabled={!!loading}
                    >
                      {loading === 'UPDATE_RESPONSE' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      Mark Actionable & Save
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
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
                    void runAction('SEND_FOR_APPROVAL')
                  }}
                  disabled={!!loading}
                >
                  {loading === 'SEND_FOR_APPROVAL' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  <Send className="mr-1.5 h-3.5 w-3.5" /> Send for Approval
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
                    onClick={() => runAction('APPROVE', { notes })}
                    disabled={!!loading}
                  >
                    {loading === 'APPROVE' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    <CheckCircle className="mr-1.5 h-3.5 w-3.5" /> Approve
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
                    onClick={() => runAction('SHARE_RESULTS')}
                    disabled={!!loading}
                  >
                    {loading === 'SHARE_RESULTS' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    Share Results via Email
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
    </div>
  )
}
