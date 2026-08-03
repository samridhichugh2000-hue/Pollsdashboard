'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Loader2, Handshake } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { getErrorMessage } from '@/lib/utils'

interface Sender {
  id: string
  name: string
  email: string
  created_at: string
}

export function KGTSendersManager() {
  const [senders, setSenders] = useState<Sender[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchSenders = async () => {
    const res = await fetch('/api/kgt-senders')
    const data = await res.json() as Sender[]
    setSenders(data)
  }

  useEffect(() => { void fetchSenders() }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/kgt-senders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      })
      if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to add requester'))
      toast.success('KGT requester added')
      setName('')
      setEmail('')
      void fetchSenders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add requester')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: string, senderEmail: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/kgt-senders/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to remove requester'))
      toast.success(`Removed ${senderEmail}`)
      void fetchSenders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove requester')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Handshake className="h-4 w-4 text-gray-500" />
          Authorized KGT Requesters
        </CardTitle>
        <CardDescription>
          Only unread emails from these senders (e.g. Nupur, Rohit Aggarwal, Nabila, Bhargavi, Sakshi, HR) are surfaced as candidate KGT requests via Refresh.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {senders.map((sender) => (
            <li
              key={sender.id}
              className="flex items-center justify-between rounded-lg border border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-4 py-2.5 text-sm"
            >
              <div>
                <p className="font-medium text-gray-900 dark:text-slate-100">{sender.name}</p>
                <p className="text-gray-500 dark:text-slate-400">{sender.email}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(sender.id, sender.email)}
                disabled={deletingId === sender.id}
                title="Remove requester"
              >
                {deletingId === sender.id
                  ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  : <Trash2 className="h-4 w-4 text-red-400 hover:text-red-600" />
                }
              </Button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleAdd} className="flex flex-col gap-2 rounded-lg border border-dashed border-gray-300 dark:border-slate-600 p-4 sm:flex-row">
          <Input
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="flex-1"
          />
          <Input
            type="email"
            placeholder="email@koenig-solutions.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="flex-1"
          />
          <Button type="submit" disabled={adding} className="shrink-0">
            {adding
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              : <Plus className="mr-1.5 h-4 w-4" />
            }
            Add Requester
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
