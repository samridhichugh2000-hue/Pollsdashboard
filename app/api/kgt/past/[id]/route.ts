import { NextRequest, NextResponse } from 'next/server'
import { updatePastKGT } from '@/lib/db/queries'
import { getDb } from '@/lib/db/client'
import type { PastKgtOutcome } from '@/types'

const VALID_OUTCOMES: PastKgtOutcome[] = ['SUCCESSFUL', 'UNSUCCESSFUL', 'DISCARDED', 'ON_HOLD']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json() as Record<string, unknown>

  const fields: Record<string, string | null> = {}
  if ('kgt_date' in body) fields.kgt_date = (body.kgt_date as string | null)?.trim() || null
  if ('topic' in body) {
    const topic = (body.topic as string | undefined)?.trim()
    if (!topic) return NextResponse.json({ error: 'Topic cannot be empty' }, { status: 400 })
    fields.topic = topic
  }
  if ('audience' in body) fields.audience = (body.audience as string | null)?.trim() || null
  if ('participants' in body) fields.participants = (body.participants as string | null) ?? null
  if ('outcome' in body) {
    const outcome = body.outcome as PastKgtOutcome
    if (!VALID_OUTCOMES.includes(outcome)) return NextResponse.json({ error: 'Invalid outcome' }, { status: 400 })
    fields.outcome = outcome
  }
  if ('finalised_kite' in body) fields.finalised_kite = (body.finalised_kite as string | null)?.trim() || null

  await updatePastKGT(id, fields)

  const result = await getDb().execute({ sql: 'SELECT * FROM past_kgts WHERE id = ?', args: [id] })
  if (!result.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(result.rows[0])
}
