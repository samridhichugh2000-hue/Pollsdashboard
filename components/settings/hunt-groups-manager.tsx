'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Loader2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export interface HuntGroup {
  id: string
  name: string
  email: string
  created_at: string
}

export function HuntGroupsManager() {
  const [groups, setGroups] = useState<HuntGroup[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchGroups = async () => {
    const res = await fetch('/api/hunt-groups')
    setGroups(await res.json() as HuntGroup[])
  }

  useEffect(() => { void fetchGroups() }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdding(true)
    try {
      const res = await fetch('/api/hunt-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      })
      if (!res.ok) {
        const d = await res.json() as { error: string }
        throw new Error(d.error)
      }
      toast.success('Hunt group added')
      setName('')
      setEmail('')
      void fetchGroups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: string, groupName: string) => {
    setDeletingId(id)
    try {
      await fetch(`/api/hunt-groups/${id}`, { method: 'DELETE' })
      toast.success(`Removed ${groupName}`)
      void fetchGroups()
    } catch {
      toast.error('Failed to remove')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4 text-gray-500" />
          Hunt Groups / Distribution Lists
        </CardTitle>
        <CardDescription>
          These appear as recipient options when creating a poll. You can also enter a custom recipient manually.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <div
              key={g.id}
              className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{g.name}</p>
                <p className="text-xs text-gray-500 truncate">{g.email}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="ml-2 flex-shrink-0 h-7 w-7"
                onClick={() => handleDelete(g.id, g.name)}
                disabled={deletingId === g.id}
              >
                {deletingId === g.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                  : <Trash2 className="h-3.5 w-3.5 text-red-400 hover:text-red-600" />
                }
              </Button>
            </div>
          ))}
        </div>

        <form onSubmit={handleAdd} className="flex flex-col gap-2 rounded-lg border border-dashed border-gray-300 p-4 sm:flex-row">
          <Input
            placeholder="Group name (e.g. Finance Team)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="flex-1"
          />
          <Input
            type="email"
            placeholder="group@koenig-solutions.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="flex-1"
          />
          <Button type="submit" disabled={adding} className="shrink-0">
            {adding ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
            Add Group
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
