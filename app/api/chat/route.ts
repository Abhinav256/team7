import { convertToModelMessages, streamText, UIMessage } from "ai"
import { cookies } from "next/headers"
import { google } from "@ai-sdk/google"

import companies from "@/data/companies.json"
import crm from "@/data/crm.json"
import assetManagement from "@/data/asset_management.json"
import investmentBanking from "@/data/investment_banking.json"
import leadGeneration from "@/data/lead_generation.json"
import relationshipHistory from "@/data/relationship_history.json"
import trades from "@/data/trades.json"
import marketData from "@/data/market_data.json"
import fxRates from "@/data/fx_rates.json"
import riskAnalysis from "@/data/risk_analysis.json"
import tradingDesks from "@/data/trading_desks.json"
import sessionsData from "@/data/sessions.json"

export const maxDuration = 30

type UserRole = "sales" | "trader" | "admin" | "unknown"
type DashboardType = "sales" | "financial"

interface ChatRequest {
  messages: UIMessage[]
  dashboard?: DashboardType
}

const FINANCIAL_ONLY_KEYWORDS = [
  "anomaly",
  "anomalies",
  "pnl",
  "p&l",
  "trading",
  "trading desk",
  "fx",
  "fx rate",
  "market data",
  "variance",
  "trades",
  "risk analysis",
  "how many anomalies",
  "what anomalies",
  "desk performance",
  "desk variance"
]

const SALES_ONLY_KEYWORDS = [
  "client",
  "clients",
  "lead",
  "leads",
  "crm",
  "relationship",
  "asset management",
  "investment banking",
  "company",
  "companies",
  "contact",
  "contacts",
  "prospect",
  "prospects",
  "deal",
  "deals",
  "account",
  "accounts"
]

// LAYER 1: ROLE EXTRACTION & AUTHORIZATION
// Extracts user role from session and implements RBAC hard block

async function getUserRoleFromSession(req: Request): Promise<UserRole> {
  try {
    const cookieStore = await cookies()
    let sessionId = cookieStore.get("gs_session_id")?.value

    // Also check X-Session-ID header
    if (!sessionId) {
      sessionId = (req.headers.get("X-Session-ID") || req.headers.get("x-session-id")) || undefined
    }

    if (!sessionId) {
      console.log("[SECURITY] No session found, defaulting to unknown")
      return "unknown"
    }

    console.log(`[SECURITY] Session ID found: ${sessionId}`)

    // Look up session in sessions.json
    const session = (sessionsData as any).sessions.find((s: any) => s.sessionId === sessionId)

    if (session) {
      const role = session.role.toLowerCase() === "financial" ? "trader" : session.role.toLowerCase() === "sales" ? "sales" : "admin"
      console.log(`[SECURITY] User role from session: ${role}`)
      return role as UserRole
    }

    // Fallback to hardcoded map
    const sessionMap: Record<string, UserRole> = {
      "session_sales_001": "sales",
      "session_trader_001": "trader",
      "session_admin_001": "admin"
    }

    const role = sessionMap[sessionId] || "unknown"
    console.log(`[SECURITY] User role from map: ${role}`)
    return role
  } catch (error) {
    console.error("[SECURITY] Error extracting role:", error)
    return "unknown"
  }
}

// LAYER 1: RBAC - Hard block for unauthorized access
function authorizeQuery(userRole: UserRole, query: string): { allowed: boolean; message?: string } {
  // Block unknown users from accessing chat entirely
  if (userRole === "unknown") {
    console.log(`[SECURITY] BLOCKED: Unknown user attempting access`)
    return {
      allowed: false,
      message: "Authentication required. Please log in to access the chat."
    }
  }

  // Block sales users from financial queries
  if (userRole === "sales") {
    const queryLower = query.toLowerCase()
    for (const keyword of FINANCIAL_ONLY_KEYWORDS) {
      if (queryLower.includes(keyword)) {
        console.log(`[SECURITY] BLOCKED: Sales user querying "${keyword}"`)
        return {
          allowed: false,
          message: "Your access to this data is restricted."
        }
      }
    }
  }

  // Block trader/financial users from sales queries
  if (userRole === "trader") {
    const queryLower = query.toLowerCase()
    for (const keyword of SALES_ONLY_KEYWORDS) {
      if (queryLower.includes(keyword)) {
        console.log(`[SECURITY] BLOCKED: Trader user querying "${keyword}"`)
        return {
          allowed: false,
          message: "Your access to this data is restricted."
        }
      }
    }
  }

  return { allowed: true }
}

// LAYER 2: CONTEXT ISOLATION
// Sales context - ONLY includes sales data
function buildSalesContext(): string {
  return `You are in the SALES DASHBOARD. You have access to:

COMPANIES DATA:
${JSON.stringify(companies, null, 2)}

CRM CONTACTS:
${JSON.stringify(crm, null, 2)}

ASSET MANAGEMENT:
${JSON.stringify(assetManagement, null, 2)}

INVESTMENT BANKING:
${JSON.stringify(investmentBanking, null, 2)}

LEAD GENERATION:
${JSON.stringify(leadGeneration, null, 2)}

RELATIONSHIP HISTORY:
${JSON.stringify(relationshipHistory, null, 2)}

IMPORTANT: You have NO access to trading data, anomalies, market data, or FX rates.`
}

// LAYER 2: CONTEXT ISOLATION
// Financial context - ONLY includes financial data
function buildFinancialContext(): string {
  const anomaliesData: any[] = []

  if (tradingDesks?.tradingDesks) {
    for (const desk of tradingDesks.tradingDesks) {
      if (desk.status === "Anomaly") {
        const deskTrades = trades.trades.filter((trade: any) => trade.desk_id === desk.desk_id)
        const rootCauses = []

        for (const trade of deskTrades) {
          const marketInfo = marketData.marketData.find((md: any) => md.instrument === trade.instrument)
          if (marketInfo && marketInfo.status === "STALE") {
            rootCauses.push(`Stale market data for ${trade.instrument}`)
          }

          if (trade.currency !== "USD") {
            const fxPair = trade.currency === "EUR" ? "EUR/USD" : "USD/JPY"
            const fxInfo = fxRates.fxRates.find((fx: any) => fx.currency_pair === fxPair && fx.status === "OLD")
            if (fxInfo) {
              rootCauses.push(`Old ${fxPair} FX rate applied`)
            }
          }
        }

        anomaliesData.push({
          desk_id: desk.desk_id,
          desk_name: desk.desk_name,
          reported_pnl: desk.pnl_reported,
          expected_pnl: desk.pnl_expected,
          variance: desk.variance,
          root_causes: rootCauses.length > 0 ? rootCauses : ["Multiple valuation discrepancies detected"],
          severity: Math.abs(desk.variance) > 10 ? "HIGH" : "MEDIUM"
        })
      }
    }
  }

  return `You are in the FINANCIAL DASHBOARD. You have access to:

TRADING DESKS:
${JSON.stringify(tradingDesks, null, 2)}

TRADES:
${JSON.stringify(trades, null, 2)}

MARKET DATA:
${JSON.stringify(marketData, null, 2)}

FX RATES:
${JSON.stringify(fxRates, null, 2)}

DETECTED ANOMALIES (P&L Reconciliation):
${JSON.stringify({ anomalies: anomaliesData }, null, 2)}

RISK ANALYSIS:
${JSON.stringify(riskAnalysis, null, 2)}

IMPORTANT: You have NO access to company info, CRM, or sales data.`
}

// CONTEXT MAP - Extensible for future dashboards
const CONTEXT_MAP: Record<DashboardType, () => string> = {
  sales: () => buildSalesContext(),
  financial: () => buildFinancialContext()
}

// LAYER 3: PROMPT GUARD
// Enforces dashboard-only responses
function buildSystemPrompt(userRole: UserRole, dashboard: DashboardType, context: string): string {
  return `You are an AI Assistant for Goldman Sachs 360° Enterprise Intelligence Platform.

OPERATING DASHBOARD: ${dashboard.toUpperCase()}
USER ROLE: ${userRole}

STRICT RULES (MUST FOLLOW):

1. You ONLY have access to ${dashboard} dashboard data provided below.

2. If a user asks about data NOT in this dashboard:
   - DO NOT guess or infer
   - DO NOT mention other datasets
   - RESPOND EXACTLY with: "This information is not available in the current dashboard."

3. For valid queries in your dashboard:
   - Provide specific, quantitative answers
   - Reference exact data (desk names, amounts, counts)
   - Never fabricate data

4. CRITICAL: Never breach dashboard isolation.

${context}`
}


export async function POST(req: Request) {
  try {
    // Parse request
    const body = (await req.json()) as ChatRequest
    const { messages, dashboard = "financial" } = body

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "No messages provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    // Validate dashboard
    if (dashboard !== "sales" && dashboard !== "financial") {
      return new Response(
        JSON.stringify({ error: "Invalid dashboard type" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    console.log(`[SECURITY] Dashboard: ${dashboard}`)

    // LAYER 1: ROLE EXTRACTION
    const userRole = await getUserRoleFromSession(req)
    console.log(`[SECURITY] Extracted role: ${userRole}`)

    // Extract last user message
    const lastMsg = messages[messages.length - 1] as any
    const lastMessage = lastMsg?.parts?.map((p: any) => p.text || "").join(" ") || lastMsg?.text || ""
    console.log(`[SECURITY] Query: "${lastMessage.substring(0, 60)}..."`)

    // LAYER 1: RBAC HARD BLOCK - Before any LLM processing
    const authResult = authorizeQuery(userRole, lastMessage)
    if (!authResult.allowed) {
      console.log(`[SECURITY] ❌ AUTHORIZATION FAILED - Returning 403`)
      return new Response(
        JSON.stringify({
          error: "Access Exception",
          message: authResult.message || "You do not have permission to access this data.",
          type: "AUTHORIZATION_ERROR",
          code: "403_FORBIDDEN"
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      )
    }

    console.log(`[SECURITY] ✅ AUTHORIZATION PASSED`)

    // LAYER 2: LOAD ISOLATED CONTEXT
    const contextBuilder = CONTEXT_MAP[dashboard]
    const databaseContext = contextBuilder()
    console.log(`[SECURITY] Context isolated for: ${dashboard}`)

    // LAYER 3: BUILD PROMPT GUARD
    const systemPrompt = buildSystemPrompt(userRole, dashboard, databaseContext)
    console.log(`[SECURITY] System prompt created with dashboard isolation`)

    // Stream response from Gemini
    const model = google("gemini-2.5-flash")
    const convertedMessages = await convertToModelMessages(messages)

    console.log(`[SECURITY] Initiating secure stream...`)
    const result = streamText({
      model,
      system: systemPrompt,
      messages: convertedMessages,
      abortSignal: req.signal
    })

    return result.toUIMessageStreamResponse()
  } catch (error) {
    console.error(`[SECURITY] ERROR:`, error)
    return new Response(
      JSON.stringify({
        error: "Failed to process request",
        details: error instanceof Error ? error.message : String(error)
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
}
