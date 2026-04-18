import { NextResponse } from "next/server"
import fs from "fs/promises"
import path from "path"

const USERS_FILE = path.join(process.cwd(), "data", "users.json")

// Global memory cache for Vercel compatibility (filesystem is read-only)
let usersMemory: any = null;

async function readUsers() {
  if (usersMemory) {
    return usersMemory;
  }
  
  try {
    const raw = await fs.readFile(USERS_FILE, "utf8")
    usersMemory = JSON.parse(raw)
    return usersMemory
  } catch (err) {
    usersMemory = { users: [] }
    return usersMemory
  }
}

async function writeUsers(data: any) {
  usersMemory = data;
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify(data, null, 2), "utf8")
  } catch (err) {
    console.warn('[USERS API] Persisting to filesystem failed (read-only FS). Using in-memory fallback.')
  }
}

export async function GET() {
  try {
    const data = await readUsers()
    return NextResponse.json(data)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ users: [] })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, password, role = "Financial", name = "" } = body

    if (!email || !password) {
      return NextResponse.json({ success: false, message: "Missing email or password" }, { status: 400 })
    }

    const data = await readUsers()
    const exists = (data.users || []).some((u: any) => u.email === email)
    if (exists) {
      return NextResponse.json({ success: false, message: "User already exists" }, { status: 409 })
    }

    const id = Date.now().toString()
    const user = { id, email, password, role, name }
    data.users = [user, ...(data.users || [])]
    await writeUsers(data)

    return NextResponse.json({ success: true, user })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ success: false, message: "Could not add user" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json()
    if (!id) return NextResponse.json({ success: false, message: "Missing id" }, { status: 400 })

    const data = await readUsers()
    const before = (data.users || []).length
    data.users = (data.users || []).filter((u: any) => u.id !== id)
    if (data.users.length === before) {
      return NextResponse.json({ success: false, message: "User not found" }, { status: 404 })
    }
    await writeUsers(data)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ success: false, message: "Could not delete user" }, { status: 500 })
  }
}
