import { NextResponse } from "next/server"
import fs from "fs/promises"
import path from "path"

const TRADING_FILE = path.join(process.cwd(), "data", "trading_desks.json")

// Global memory cache for Vercel compatibility (filesystem is read-only)
let tradingMemory: any = null;

export async function POST(request: Request) {
  try {
    const { desk_id } = await request.json()

    let trading: any;
    if (tradingMemory) {
      trading = tradingMemory;
    } else {
      const raw = await fs.readFile(TRADING_FILE, 'utf8')
      trading = JSON.parse(raw)
      tradingMemory = trading;
    }

    const deskIndex = trading.tradingDesks.findIndex((d: any) => d.desk_id === desk_id)
    if (deskIndex === -1) {
      return NextResponse.json({ error: "Desk not found" }, { status: 404 })
    }

    const desk = trading.tradingDesks[deskIndex]
    const actions_taken: string[] = []

    // Simulate automated fixes: refresh market data and FX (scripted)
    actions_taken.push('Market data refreshed')
    actions_taken.push('FX rates updated')
    actions_taken.push('Valuation recalculated')

    const corrected_pnl = desk.pnl_expected

    // Update the desk entry
    trading.tradingDesks[deskIndex].status = 'Reconciled'
    trading.tradingDesks[deskIndex].pnl_reported = corrected_pnl
    trading.tradingDesks[deskIndex].variance = 0
    trading.tradingDesks[deskIndex].last_updated = new Date().toISOString()

    // Update summary counts
    if (typeof trading.summary === 'object') {
      trading.summary.anomalies = Math.max(0, (trading.summary.anomalies || 0) - 1)
      trading.summary.reconciled = (trading.summary.reconciled || 0) + 1
      if (trading.summary.pending && trading.summary.pending > 0) trading.summary.pending = Math.max(0, trading.summary.pending - 0)
    }

    // Persist file
    try {
      await fs.writeFile(TRADING_FILE, JSON.stringify(trading, null, 2), 'utf8')
    } catch (err) {
      console.warn('[RESOLVE API] Persisting to filesystem failed (read-only FS). Using in-memory fallback.')
    }

    const result = {
      desk_id: desk.desk_id,
      status: 'Reconciled',
      actions_taken,
      final_pnl: corrected_pnl,
      timestamp: new Date().toISOString()
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to resolve anomaly' }, { status: 500 })
  }
}