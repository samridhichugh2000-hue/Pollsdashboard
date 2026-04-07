import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  const result = await getDb().execute('SELECT * FROM hunt_groups ORDER BY name ASC')
  return NextResponse.json(result.rows)
}

export async function POST(req: NextRequest) {
  const { name, email } = await req.json() as { name: string; email: string }

  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
  }

  const id = uuidv4()
  try {
    await getDb().execute({
      sql: 'INSERT INTO hunt_groups (id, name, email) VALUES (?, ?, ?)',
      args: [id, name.trim(), email.trim()],
    })
    return NextResponse.json({ id, name: name.trim(), email: email.trim() }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
  }
}
