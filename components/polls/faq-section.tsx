'use client'

import { useEffect, useState } from 'react'
import { Plus, Save, X, Loader2, Megaphone, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { getErrorMessage, parseEmailList } from '@/lib/utils'
import type { PollFaq } from '@/types'
import { FAQ_STATUS_LABELS, FAQ_STATUS_COLORS } from '@/types'

interface FaqSectionProps {
  pollId: string
}

// Standalone FAQ manager for a single poll — independent of the poll's own
// status/lifecycle, so it works the same whether the poll is a draft, still
// active, or already closed/expired.
export function FaqSection({ pollId }: FaqSectionProps) {
  const [faqs, setFaqs] = useState<PollFaq[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const [newQuestion, setNewQuestion] = useState('')
  const [newAnswer, setNewAnswer] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editQuestion, setEditQuestion] = useState('')
  const [editAnswer, setEditAnswer] = useState('')

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const [announcingFaq, setAnnouncingFaq] = useState<PollFaq | null>(null)
  const [huntGroups, setHuntGroups] = useState<{ id: string; name: string; email: string }[]>([])
  const [huntGroupsLoading, setHuntGroupsLoading] = useState(false)
  const [selectedHuntGroupIds, setSelectedHuntGroupIds] = useState<string[]>([])
  const [manualEmailsText, setManualEmailsText] = useState('')
  const [huntGroupDropdownOpen, setHuntGroupDropdownOpen] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/polls/${pollId}/faqs`)
      .then(r => r.ok ? r.json() : [])
      .then((data: PollFaq[]) => setFaqs(data))
      .catch(() => toast.error('Failed to load FAQs'))
      .finally(() => setLoading(false))
  }, [pollId])

  const addFaq = async () => {
    const question = newQuestion.trim()
    const answer = newAnswer.trim()
    if (!question || !answer) { toast.error('Question and answer are required'); return }
    setSaving('ADD')
    try {
      const res = await fetch(`/api/polls/${pollId}/faqs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer }),
      })
      if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to add FAQ'))
      const created = await res.json() as PollFaq
      setFaqs(prev => [...prev, created])
      setNewQuestion('')
      setNewAnswer('')
      toast.success('FAQ added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add FAQ')
    } finally {
      setSaving(null)
    }
  }

  const startEdit = (faq: PollFaq) => {
    setEditingId(faq.id)
    setEditQuestion(faq.question)
    setEditAnswer(faq.answer)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditQuestion('')
    setEditAnswer('')
  }

  const saveEdit = async (faqId: string) => {
    const question = editQuestion.trim()
    const answer = editAnswer.trim()
    if (!question || !answer) { toast.error('Question and answer are required'); return }
    setSaving(faqId)
    try {
      const res = await fetch(`/api/polls/${pollId}/faqs/${faqId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'EDIT', question, answer }),
      })
      if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to save FAQ'))
      const updated = await res.json() as PollFaq
      setFaqs(prev => prev.map(f => f.id === faqId ? updated : f))
      cancelEdit()
      toast.success('FAQ saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save FAQ')
    } finally {
      setSaving(null)
    }
  }

  const deleteFaq = async (faqId: string) => {
    setSaving(faqId)
    try {
      const res = await fetch(`/api/polls/${pollId}/faqs/${faqId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to delete FAQ'))
      setFaqs(prev => prev.filter(f => f.id !== faqId))
      setConfirmDeleteId(null)
      toast.success('FAQ deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete FAQ')
    } finally {
      setSaving(null)
    }
  }

  const openAnnounce = async (faq: PollFaq) => {
    setAnnouncingFaq(faq)
    setSelectedHuntGroupIds([])
    setManualEmailsText('')
    setHuntGroupDropdownOpen(false)
    if (huntGroups.length === 0) {
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
  }

  const confirmAnnounce = async () => {
    if (!announcingFaq) return
    const huntGroupSelected = huntGroups.filter(g => selectedHuntGroupIds.includes(g.id))
    const manualEmails = parseEmailList(manualEmailsText)
    const emails = [...new Set([...huntGroupSelected.map(g => g.email), ...manualEmails])]
    if (!emails.length) { toast.error('Add at least one recipient'); return }

    const faqId = announcingFaq.id
    setSaving(faqId)
    try {
      const res = await fetch(`/api/polls/${pollId}/faqs/${faqId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ANNOUNCE', emails }),
      })
      if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to announce FAQ'))
      const updated = await res.json() as PollFaq
      setFaqs(prev => prev.map(f => f.id === updated.id ? updated : f))
      setAnnouncingFaq(null)
      toast.success('FAQ announced')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to announce FAQ')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : (
        <div className="space-y-3">
          {faqs.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-slate-500">No FAQs added yet.</p>
          )}
          {faqs.map((faq) => (
            <div key={faq.id} className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
              {editingId === faq.id ? (
                <div className="space-y-2">
                  <Input value={editQuestion} onChange={e => setEditQuestion(e.target.value)} placeholder="Question" />
                  <Textarea value={editAnswer} onChange={e => setEditAnswer(e.target.value)} placeholder="Answer" rows={3} />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saving === faq.id}>Cancel</Button>
                    <Button size="sm" onClick={() => void saveEdit(faq.id)} disabled={saving === faq.id}>
                      {saving === faq.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{faq.question}</p>
                    <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${FAQ_STATUS_COLORS[faq.status]}`}>
                      {FAQ_STATUS_LABELS[faq.status]}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-slate-300 whitespace-pre-wrap">{faq.answer}</p>
                  <div className="flex items-center gap-3 pt-1">
                    <button className="text-xs font-medium text-cyan-600 hover:text-cyan-800 hover:underline" onClick={() => startEdit(faq)}>Edit</button>
                    <button className="text-xs font-medium text-cyan-600 hover:text-cyan-800 hover:underline" onClick={() => void openAnnounce(faq)}>Announce</button>
                    {confirmDeleteId === faq.id ? (
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">Delete?</span>
                        <button className="text-xs font-medium text-rose-600 hover:underline" disabled={saving === faq.id} onClick={() => void deleteFaq(faq.id)}>Confirm</button>
                        <button className="text-xs font-medium text-gray-400 hover:underline" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="text-xs font-medium text-gray-400 hover:text-rose-600 hover:underline" onClick={() => setConfirmDeleteId(faq.id)}>Delete</button>
                    )}
                  </div>
                  {faq.status === 'ANNOUNCED' && faq.announce_emails && (
                    <p className="text-[11px] text-gray-400 dark:text-slate-500">
                      Announced to {(() => { try { return (JSON.parse(faq.announce_emails) as string[]).join(', ') } catch { return '' } })()}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add new FAQ */}
      <div className="space-y-2 rounded-lg border border-dashed border-gray-300 dark:border-slate-600 p-3">
        <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">Add FAQ</Label>
        <Input value={newQuestion} onChange={e => setNewQuestion(e.target.value)} placeholder="Question" />
        <Textarea value={newAnswer} onChange={e => setNewAnswer(e.target.value)} placeholder="Answer" rows={3} />
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void addFaq()} disabled={saving === 'ADD'}>
            {saving === 'ADD' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
            Add FAQ
          </Button>
        </div>
      </div>

      {/* Announce dialog */}
      <Dialog open={!!announcingFaq} onOpenChange={(open) => { if (!open) setAnnouncingFaq(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Announce FAQ</DialogTitle>
            <DialogDescription>Select who this FAQ should be emailed to.</DialogDescription>
          </DialogHeader>

          {announcingFaq && (
            <div className="rounded-md bg-gray-50 dark:bg-slate-800 p-3 text-sm">
              <p className="font-medium text-gray-900 dark:text-slate-100">{announcingFaq.question}</p>
              <p className="text-gray-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">{announcingFaq.answer}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">Hunt Groups</Label>
            <div className="relative">
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
                <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform dark:text-slate-500 ${huntGroupDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {huntGroupDropdownOpen && (
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
            </div>
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

          <div className="space-y-1.5 pt-1 border-t border-gray-100 dark:border-slate-700">
            <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-slate-400">Add individual emails</Label>
            <Textarea
              value={manualEmailsText}
              onChange={(e) => setManualEmailsText(e.target.value)}
              placeholder={'john@koenig-solutions.com\njane@koenig-solutions.com\n\nOne per line, or comma-separated.'}
              rows={3}
              className="resize-none text-sm"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnouncingFaq(null)}>Cancel</Button>
            <Button onClick={() => void confirmAnnounce()} disabled={huntGroupsLoading || saving === announcingFaq?.id}>
              {saving === announcingFaq?.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Megaphone className="mr-1.5 h-3.5 w-3.5" />}
              Announce
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
