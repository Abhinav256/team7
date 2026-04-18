"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Send, Bot, User, Loader2, CheckCircle, AlertCircle, Zap, Target, TrendingDown, Lock } from "lucide-react"
import { isFinancialOnlyQuery } from "@/app/api/utils/simple-rbac"

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  type?: 'resolution' | 'explanation' | 'error' | 'anomaly_analysis'
  data?: any
}

interface ErrorResponse {
  error?: string
  message?: string
  details?: string
}

interface AIChatWidgetProps {
  deskId?: string
  deskName?: string
  initialContext?: string
  anomalyData?: {
    desk_id: string
    desk_name: string
    issue: string
    reported_pnl: number
    expected_pnl: number
    variance: number
    root_causes: string[]
    severity: string
  }
  onResolution?: (data: any) => void
  onSolveAnomaly?: () => Promise<void>
  apiEndpoint?: string
  className?: string
}

export function AIChatWidget({ deskId, deskName, initialContext, anomalyData, onResolution, onSolveAnomaly, apiEndpoint = '/api/chat', className }: AIChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [showResolutionConfirm, setShowResolutionConfirm] = useState(false)
  const [isSolvingAnomaly, setIsSolvingAnomaly] = useState(false)
  const [resolvedAnomaly, setResolvedAnomaly] = useState<any>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [error, setError] = useState<ErrorResponse | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Get user role from session API on mount
  useEffect(() => {
    const fetchUserSession = async () => {
      try {
        const sessionId = localStorage.getItem("gs_session_id")
        if (!sessionId) {
          console.log("[AI-CHAT] No session ID found")
          return
        }

        const res = await fetch(`/api/sessions?sessionId=${sessionId}`)
        const data = await res.json()

        if (data.success && data.session) {
          setUserRole(data.session.role)
          console.log("[AI-CHAT] User role from session:", data.session.role)
        }
      } catch (error) {
        console.error("[AI-CHAT] Failed to fetch session:", error)
      }
    }

    fetchUserSession()
  }, [])

  useEffect(() => {
    if (anomalyData) {
      // Initialize with anomaly analysis from AI
      const initialMessage = `Analyzing anomaly for ${anomalyData.desk_name}...\n\nPlease wait while I analyze the issue and provide recommendations.`
      setMessages([{
        id: '1',
        role: 'assistant',
        content: initialMessage,
        timestamp: new Date(),
        type: 'explanation'
      }])
      // Automatically fetch AI analysis for anomaly
      setTimeout(() => {
        sendAnomalyAnalysis()
      }, 500)
    } else if (initialContext) {
      setMessages([{
        id: '1',
        role: 'assistant',
        content: initialContext,
        timestamp: new Date(),
        type: 'explanation'
      }])
    }
  }, [anomalyData, initialContext])

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [messages])

  const sendAnomalyAnalysis = async () => {
    if (!anomalyData) return

    setIsLoading(true)
    try {
      const response = await fetch('/api/ai-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          desk_id: anomalyData.desk_id,
          desk_name: anomalyData.desk_name,
          reported_pnl: anomalyData.reported_pnl,
          expected_pnl: anomalyData.expected_pnl,
          variance: anomalyData.variance,
          issue: anomalyData.issue,
          root_causes: anomalyData.root_causes,
          severity: anomalyData.severity
        })
      })

      const aiData = await response.json()

      const analysisMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Issue: ${aiData.issue || anomalyData.issue}\n\nRoot Cause: ${aiData.root_cause || anomalyData.root_causes[0] || 'Valuation mismatch'}\n\nSolution: ${aiData.solution || 'Reconcile market data and FX rates'}\n\nDescription: ${aiData.description || 'Automated reconciliation will normalize P&L'}`,
        timestamp: new Date(),
        type: 'anomaly_analysis',
        data: aiData
      }
      setMessages(prev => [...prev.slice(0, -1), analysisMessage])
      setShowResolutionConfirm(true)
    } catch (error) {
      console.error('Failed to get AI analysis:', error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Failed to get AI analysis. Please try again.',
        timestamp: new Date(),
        type: 'error'
      }
      setMessages(prev => [...prev.slice(0, -1), errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const sendMessage = async (message: string, mode?: 'resolve' | 'analyze') => {
    if (!message.trim()) return

    const normalizedRole = userRole?.toLowerCase()

    // 🔒 FRONTEND RBAC: Block financial queries for sales users BEFORE sending to backend
    if (normalizedRole === "sales" && isFinancialOnlyQuery(message)) {
      console.warn(`[AI-CHAT] Frontend RBAC: Sales user blocked from financial query: "${message}"`)
      setError({
        error: "Access Restricted",
        message: "🔒 You do not have permission to view financial data."
      })
      return
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput("")
    setIsLoading(true)
    setError(null) // Clear any previous errors

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          mode,
          deskId
        })
      })

      // Check for API errors (403, etc.)
      if (!response.ok) {
        try {
          const errorData = await response.json()
          const errorMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `🔒 ${errorData.error || 'Access Restricted'}\n\n${errorData.message || 'Request failed'}\n\n${errorData.details || ''}`,
            timestamp: new Date(),
            type: 'error',
            data: errorData
          }
          setMessages(prev => [...prev, errorMessage])
          return
        } catch {
          const errorMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Request failed with status ${response.status}. Please try again.`,
            timestamp: new Date(),
            type: 'error'
          }
          setMessages(prev => [...prev, errorMessage])
          return
        }
      }

      const data = await response.json()

      if (data.type === 'analysis') {
        const analysisMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
          type: 'explanation'
        }
        setMessages(prev => [...prev, analysisMessage])
        setShowResolutionConfirm(true)
      } else if (data.type === 'resolution') {
        const resolutionMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
          type: 'resolution',
          data: data.data
        }
        setMessages(prev => [...prev, resolutionMessage])
        setShowResolutionConfirm(false)

        // Trigger resolution callback
        if (onResolution) {
          onResolution(data.data)
        }
      } else if (data.type === 'error') {
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
          type: 'error'
        }
        setMessages(prev => [...prev, errorMessage])
      } else {
        // Handle streaming response
        const reader = response.body?.getReader()
        if (reader) {
          const decoder = new TextDecoder()
          let accumulated = ''

          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            type: 'explanation'
          }

          setMessages(prev => [...prev, assistantMessage])

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value)
            const lines = chunk.split('\n')

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6))
                  if (data.content) {
                    accumulated += data.content
                    setMessages(prev => prev.map(msg =>
                      msg.id === assistantMessage.id
                        ? { ...msg, content: accumulated }
                        : msg
                    ))
                  }
                } catch (e) {
                  // Ignore parsing errors
                }
              }
            }
          }
        }
      }
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
        type: 'error'
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleQuickAction = (action: string) => {
    if (action === 'resolve') {
      sendMessage("Please analyze this anomaly and prepare a resolution plan. What issues do you find and how will you fix them?", 'analyze')
    } else if (action === 'explain') {
      sendMessage(`Why is the ${deskName || 'desk'} showing a P&L variance?`)
    }
  }

  return (
    <Card className={`flex flex-col h-[600px] bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border-cyan-500/20 shadow-2xl ${className}`}>
      <CardHeader className="pb-4 border-b border-cyan-500/20 bg-gradient-to-r from-slate-900/80 to-slate-800/80">
        <div className="space-y-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Zap className="w-5 h-5 text-cyan-400 animate-pulse" />
            <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
              AI Finance Assistant
            </span>
            {deskName && (
              <Badge className="ml-2 bg-cyan-500/20 text-cyan-300 border-cyan-500/30">
                {deskName}
              </Badge>
            )}
          </CardTitle>
          {anomalyData && (
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="outline" className="bg-red-500/10 text-red-300 border-red-500/30">
                <AlertCircle className="w-3 h-3 mr-1" />
                Variance: ${anomalyData.variance}M
              </Badge>
              <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30">
                <TrendingDown className="w-3 h-3 mr-1" />
                {anomalyData.severity}
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0">
        <ScrollArea className="flex-1 px-4" ref={scrollAreaRef}>
          <div className="space-y-4 py-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500/30 to-slate-500/30 flex items-center justify-center flex-shrink-0 border border-indigo-500/30">
                    <Bot className="w-4 h-4 text-indigo-400" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-lg px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-gradient-to-r from-indigo-600 to-slate-600 text-white rounded-br-none shadow-lg'
                      : message.type === 'error'
                      ? 'bg-gradient-to-br from-red-950/60 to-red-950/40 text-red-300 border border-red-700/40 rounded-bl-none'
                      : message.type === 'resolution'
                      ? 'bg-gradient-to-r from-green-600/30 to-emerald-600/30 text-green-300 border border-green-500/40 rounded-bl-none shadow-lg'
                      : message.type === 'anomaly_analysis'
                      ? 'bg-slate-800/80 text-slate-100 border border-indigo-500/30 rounded-bl-none'
                      : 'bg-slate-800/60 text-slate-100 rounded-bl-none'
                  }`}
                >
                  {message.type === 'error' && message.data?.error ? (
                    <div className="space-y-2">
                      <div className="font-semibold text-red-200">
                        🔒 {message.data.error || 'Access Restricted'}
                      </div>
                      <div className="text-red-300/90 text-sm">
                        {message.data.message || message.content}
                      </div>
                      {message.data.details && (
                        <div className="text-red-300/60 text-xs italic">
                          {message.data.details}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="whitespace-pre-line text-sm leading-relaxed">{message.content}</div>
                  )}
                  <div className="text-xs opacity-60 mt-2">
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                {message.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-slate-600 flex items-center justify-center flex-shrink-0 shadow-lg">
                    <User className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 justify-start animate-in">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500/30 to-slate-500/30 flex items-center justify-center flex-shrink-0 border border-indigo-500/30">
                  <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                </div>
                <div className="bg-slate-800/80 rounded-lg px-4 py-3 border border-indigo-500/30">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
                    <span className="text-sm text-slate-300">AI is analyzing...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Error Display */}
        {error && (
          <div className="px-4 py-3 border-t border-red-500/30 bg-gradient-to-r from-red-950/60 to-red-950/40">
            <div className="flex items-start gap-3">
              <Lock className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="font-semibold text-red-100 mb-1">{error.error}</h4>
                <p className="text-red-100/90 text-sm">{error.message}</p>
                {error.details && (
                  <p className="text-red-100/70 text-xs mt-1">{error.details}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {showResolutionConfirm && !resolvedAnomaly && (
          <div className="px-4 py-4 border-t border-cyan-500/30 bg-gradient-to-r from-cyan-900/40 via-blue-900/40 to-slate-900/40 space-y-3 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-semibold bg-gradient-to-r from-cyan-300 to-blue-300 bg-clip-text text-transparent">Ready to resolve this anomaly?</span>
            </div>
            <Button
              size="lg"
              onClick={async () => {
                setIsSolvingAnomaly(true)
                setShowResolutionConfirm(false)
                
                try {
                  if (onSolveAnomaly) {
                    await onSolveAnomaly()
                  }
                  setResolvedAnomaly(true)
                  
                  const resolvedMessage: Message = {
                    id: (Date.now() + 2).toString(),
                    role: 'assistant',
                    content: '✅ Anomaly Successfully Resolved!\n\nThe P&L variance has been corrected and reconciled. The anomaly has been removed from the active list and the trading desk status has been updated to Reconciled. The progress tracker has been updated accordingly.',
                    timestamp: new Date(),
                    type: 'resolution'
                  }
                  setMessages(prev => [...prev, resolvedMessage])
                } catch (error) {
                  console.error('Failed to solve anomaly:', error)
                  const errorMessage: Message = {
                    id: (Date.now() + 2).toString(),
                    role: 'assistant',
                    content: '❌ Failed to resolve the anomaly. Please try again or contact support.',
                    timestamp: new Date(),
                    type: 'error'
                  }
                  setMessages(prev => [...prev, errorMessage])
                } finally {
                  setIsSolvingAnomaly(false)
                }
              }}
              disabled={isSolvingAnomaly}
              className="w-full bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600 hover:from-green-700 hover:via-emerald-700 hover:to-teal-700 font-bold shadow-xl text-white h-12 text-base"
            >
              {isSolvingAnomaly ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Resolving Anomaly (10s)...
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5 mr-2" />
                  Resolve Anomaly & Update
                </>
              )}
            </Button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="px-4 py-4 border-t border-cyan-500/20 bg-slate-900/50 space-y-3">
            <p className="text-xs uppercase tracking-wider text-cyan-400 font-semibold">Quick Actions:</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleQuickAction('explain')}
                disabled={isLoading}
                className="text-xs border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10 hover:border-cyan-500/50"
              >
                📊 Explain Issue
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleQuickAction('resolve')}
                disabled={isLoading}
                className="text-xs border-green-500/30 text-green-300 hover:bg-green-500/10 hover:border-green-500/50"
              >
                ✨ Analyze & Fix
              </Button>
            </div>
            <p className="text-xs text-slate-400">
              💡 Ask me anything about this anomaly or say "resolve" to fix it automatically
            </p>
          </div>
        )}

        <div className="p-4 border-t border-cyan-500/20 bg-gradient-to-r from-slate-900/80 to-slate-800/80">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about the anomaly or request resolution..."
              disabled={isLoading}
              className="flex-1 bg-slate-800/50 border-cyan-500/30 text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/60 focus:ring-cyan-400/20"
            />
            <Button 
              type="submit" 
              disabled={isLoading || !input.trim()}
              className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 shadow-lg"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  )
}