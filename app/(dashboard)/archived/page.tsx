export const dynamic = 'force-dynamic'

import { getAllPolls } from '@/lib/db/queries'
import { PollsTable } from '@/components/polls/polls-table'

export default async function ArchivedPage() {
  const polls = await getAllPolls()
  const archived = polls.filter(p => p.status === 'ARCHIVED')

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">Archived / Closed</h2>
        <p className="text-sm text-white/50">{archived.length} archived polls</p>
      </div>
      <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        <PollsTable polls={archived} />
      </div>
    </div>
  )
}
