import { NextRequest, NextResponse } from 'next/server'
import { getAllPastKGTs, createPastKGT } from '@/lib/db/queries'
import { runMigrations } from '@/lib/db/schema'
import type { PastKgtOutcome } from '@/types'

const VALID_OUTCOMES: PastKgtOutcome[] = ['SUCCESSFUL', 'UNSUCCESSFUL', 'DISCARDED', 'ON_HOLD']

export async function GET() {
  await runMigrations()
  const records = await getAllPastKGTs()
  return NextResponse.json(records)
}

export async function POST(req: NextRequest) {
  await runMigrations()
  const body = await req.json() as Record<string, unknown>

  const topic = (body.topic as string | undefined)?.trim()
  const outcome = body.outcome as PastKgtOutcome | undefined
  if (!topic) return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
  if (!outcome || !VALID_OUTCOMES.includes(outcome)) {
    return NextResponse.json({ error: 'A valid outcome is required' }, { status: 400 })
  }

  const record = await createPastKGT({
    kgt_date: (body.kgt_date as string | undefined)?.trim() || null,
    topic,
    audience: (body.audience as string | undefined)?.trim() || null,
    participants: (body.participants as string | undefined)?.trim() || null,
    outcome,
    finalised_kite: (body.finalised_kite as string | undefined)?.trim() || null,
  })
  return NextResponse.json(record, { status: 201 })
}
