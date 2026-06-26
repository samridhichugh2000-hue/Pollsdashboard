'use client'

import { Users } from 'lucide-react'

export default function ParticipationPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Participation</h1>
        <p className="text-sm text-slate-500">Department and employee participation analytics</p>
      </div>
      <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] flex flex-col items-center justify-center py-24 gap-3">
        <Users className="h-10 w-10 text-slate-200" />
        <p className="text-sm font-medium text-slate-400">Coming soon — Participation page</p>
      </div>
    </div>
  )
}
