import { NextRequest, NextResponse } from 'next/server'

interface Session {
  sessionId: string
  email: string
  role: string
  name: string
  loginTime: string
  lastActivityTime: string
  isActive: boolean
}

// Stateless session management for Vercel stability
// We encode/decode session data directly into the sessionId token

function encodeSession(data: any): string {
  const sessionData = {
    ...data,
    loginTime: data.loginTime || new Date().toISOString(),
    lastActivityTime: new Date().toISOString(),
    isActive: true
  }
  const token = Buffer.from(JSON.stringify(sessionData)).toString('base64')
  return `st_${token}`
}

function decodeSession(sessionId: string): Session | null {
  if (!sessionId || !sessionId.startsWith('st_')) return null
  try {
    const token = sessionId.substring(3)
    const json = Buffer.from(token, 'base64').toString('utf8')
    const data = JSON.parse(json)
    return {
      ...data,
      sessionId
    } as Session
  } catch (e) {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const { action, sessionId, email, role, name } = await req.json()

    if (action === 'create') {
      // Create a new stateless session
      const newSessionId = encodeSession({ email, role, name })
      const session = decodeSession(newSessionId)

      return NextResponse.json({
        success: true,
        sessionId: newSessionId,
        session,
      })
    }

    if (action === 'get') {
      // Decode a session by ID
      const session = decodeSession(sessionId)
      if (!session) {
        return NextResponse.json(
          { success: false, message: 'Session not found or expired' },
          { status: 404 }
        )
      }

      return NextResponse.json({ success: true, session })
    }

    if (action === 'delete') {
      // In stateless mode, deletion is just handled by the client removing the token
      return NextResponse.json({ success: true, message: 'Session invalidation requested (stateless)' })
    }

    if (action === 'list') {
      // Listing is not applicable for stateless sessions without a database
      return NextResponse.json({ success: true, sessions: [] })
    }

    return NextResponse.json(
      { success: false, message: 'Invalid action' },
      { status: 400 }
    )
  } catch (error) {
    console.error('[SESSION API] Error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const sessionId = searchParams.get('sessionId')

    if (sessionId) {
      const session = decodeSession(sessionId)
      if (!session) {
        return NextResponse.json(
          { success: false, message: 'Session not found or expired' },
          { status: 404 }
        )
      }

      // Return the decoded session (no update needed for stateless unless we issue a new token)
      return NextResponse.json({ success: true, session })
    }

    // List all active sessions (not possible in stateless mode)
    return NextResponse.json({ success: true, sessions: [] })
  } catch (error) {
    console.error('[SESSION API] Error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}
