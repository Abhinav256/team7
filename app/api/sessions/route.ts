import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const SESSIONS_FILE = path.join(process.cwd(), 'data', 'sessions.json')

interface Session {
  sessionId: string
  email: string
  role: string
  name: string
  loginTime: string
  lastActivityTime: string
  isActive: boolean
}

// Global variable to persist sessions in memory across lambda invocations (if reused)
// This is used as a fallback because Vercel's filesystem is read-only at runtime
let sessionsMemory: SessionsData | null = null;

async function getSessions(): Promise<SessionsData> {
  if (sessionsMemory) {
    return sessionsMemory;
  }
  
  try {
    const data = await fs.readFile(SESSIONS_FILE, 'utf-8')
    sessionsMemory = JSON.parse(data)
    return sessionsMemory!
  } catch {
    sessionsMemory = { sessions: [] }
    return sessionsMemory
  }
}

async function saveSessions(data: SessionsData): Promise<void> {
  sessionsMemory = data;
  try {
    await fs.writeFile(SESSIONS_FILE, JSON.stringify(data, null, 2))
  } catch (error) {
    // On Vercel, this will fail. We log it but don't throw an error 
    // because we've already updated the in-memory cache.
    console.warn('[SESSION API] Persisting to filesystem failed (read-only FS). Using in-memory fallback.')
  }
}

export async function POST(req: NextRequest) {
  try {
    const { action, sessionId, email, role, name } = await req.json()

    const sessionsData = await getSessions()

    if (action === 'create') {
      // Create a new session
      const newSession: Session = {
        sessionId: `session_${Date.now()}`,
        email,
        role,
        name,
        loginTime: new Date().toISOString(),
        lastActivityTime: new Date().toISOString(),
        isActive: true,
      }

      // Remove any existing sessions for this email
      sessionsData.sessions = sessionsData.sessions.filter(s => s.email !== email)
      
      // Add new session
      sessionsData.sessions.push(newSession)
      await saveSessions(sessionsData)

      return NextResponse.json({
        success: true,
        sessionId: newSession.sessionId,
        session: newSession,
      })
    }

    if (action === 'get') {
      // Get a session by ID
      const session = sessionsData.sessions.find(s => s.sessionId === sessionId)
      if (!session) {
        return NextResponse.json(
          { success: false, message: 'Session not found' },
          { status: 404 }
        )
      }

      // Update last activity time
      session.lastActivityTime = new Date().toISOString()
      await saveSessions(sessionsData)

      return NextResponse.json({ success: true, session })
    }

    if (action === 'delete') {
      // Delete a session
      sessionsData.sessions = sessionsData.sessions.filter(s => s.sessionId !== sessionId)
      await saveSessions(sessionsData)

      return NextResponse.json({ success: true, message: 'Session deleted' })
    }

    if (action === 'list') {
      // List all active sessions
      const activeSessions = sessionsData.sessions.filter(s => s.isActive)
      return NextResponse.json({ success: true, sessions: activeSessions })
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

    const sessionsData = await getSessions()

    if (sessionId) {
      const session = sessionsData.sessions.find(s => s.sessionId === sessionId)
      if (!session) {
        return NextResponse.json(
          { success: false, message: 'Session not found' },
          { status: 404 }
        )
      }

      // Update last activity time
      session.lastActivityTime = new Date().toISOString()
      await saveSessions(sessionsData)

      return NextResponse.json({ success: true, session })
    }

    // List all active sessions
    const activeSessions = sessionsData.sessions.filter(s => s.isActive)
    return NextResponse.json({ success: true, sessions: activeSessions })
  } catch (error) {
    console.error('[SESSION API] Error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}
