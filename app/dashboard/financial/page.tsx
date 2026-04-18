"use client"

import { useState, useEffect } from "react"
import { ArrowUpRight, BarChart3, CreditCard, DollarSign, TrendingUp, AlertTriangle, CheckCircle, Clock, XCircle, Bot, Download } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useChatbot } from "@/components/chatbot/chatbot-provider"
import { anomalyStateService } from "@/components/anomaly-state.service"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { AIChatWidget } from "@/components/ai-chat-widget"
import { ThemeToggle } from "@/components/theme-toggle"

interface TradingDesk {
  desk_id: string
  desk_name: string
  region: string
  type: string
  status: string
  pnl_reported: number
  pnl_expected: number
  variance: number
  last_updated: string
}

interface Anomaly {
  desk_id: string
  desk_name: string
  issue: string
  reported_pnl: number
  expected_pnl: number
  variance: number
  root_causes: string[]
  severity: string
}

interface Summary {
  totalDesks: number
  reconciled: number
  pending: number
  anomalies: number
}

export default function FinancialDashboardPage() {
  const [tradingDesks, setTradingDesks] = useState<TradingDesk[]>([])
  const [summary, setSummary] = useState<Summary>({ totalDesks: 0, reconciled: 0, pending: 0, anomalies: 0 })
  const [anomalies, setAnomalies] = useState<Anomaly[]>([])
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [aiResponse, setAiResponse] = useState<any>(null)
  const [resolvedAnomaly, setResolvedAnomaly] = useState<any>(null)
  const [solvedCount, setSolvedCount] = useState(0)
  const [totalAnomalies, setTotalAnomalies] = useState(0)
  const [showAISuggestion, setShowAISuggestion] = useState(false)
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(-1)
  const [previousAnomalyCount, setPreviousAnomalyCount] = useState<number>(0)
  const [currentAnomalyCount, setCurrentAnomalyCount] = useState<number>(0)
  const [showResolutionPopup, setShowResolutionPopup] = useState(false)
  const { toast } = useToast()
  const { sendAnomalyToChat, setOnAnomalyResolved } = useChatbot()

  const generateAISuggestion = (anomaly: Anomaly) => {
    // Generate AI-powered analysis based on anomaly type
    if (anomaly.desk_name.toLowerCase().includes('equity') || anomaly.desk_name.toLowerCase().includes('derivatives')) {
      return {
        issue: `${anomaly.desk_name} showing a ${Math.abs(anomaly.variance).toFixed(1)}M variance`,
        rootCause: "FX rate mismatch on hedged positions causing valuation discrepancies",
        steps: [
          "Review FX rate feeds for EUR/USD and GBP/USD pairs",
          "Recalculate option valuations with corrected rates",
          "Update hedge accounting entries",
          "Reconcile P&L with corrected valuations"
        ]
      }
    } else if (anomaly.desk_name.toLowerCase().includes('fx') || anomaly.desk_name.toLowerCase().includes('trading')) {
      return {
        issue: `${anomaly.desk_name} showing a ${Math.abs(anomaly.variance).toFixed(1)}M variance`,
        rootCause: "Stale market data used for spot FX valuations",
        steps: [
          "Check market data feed connectivity",
          "Refresh FX rate cache",
          "Revalue open positions with live rates",
          "Update trade confirmations"
        ]
      }
    } else {
      return {
        issue: `${anomaly.desk_name} showing a ${Math.abs(anomaly.variance).toFixed(1)}M variance`,
        rootCause: "Multiple valuation discrepancies detected",
        steps: [
          "Conduct comprehensive data audit",
          "Validate all pricing feeds",
          "Recalculate portfolio valuations",
          "Implement enhanced monitoring controls"
        ]
      }
    }
  }

  const aiResolveSteps = [
    "Analyzing root cause...",
    "Validating market data...",
    "Recalculating P&L...",
    "Updating records..."
  ]

  const handleResolveWithAI = async () => {
    if (!selectedAnomaly) return

    setIsResolving(true)
    setCurrentStepIndex(0)

    for (let index = 0; index < aiResolveSteps.length; index += 1) {
      setCurrentStepIndex(index)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    setCurrentStepIndex(-1)
    await resolveAnomaly(selectedAnomaly.desk_id, { suppressToast: true })
    setShowAISuggestion(false)
    setSelectedAnomaly(null)
  }

  useEffect(() => {
    // Generate random anomaly total on mount
    const randomTotal = Math.floor(Math.random() * (600 - 100 + 1)) + 100
    setTotalAnomalies(randomTotal)
    fetchTradingDesks()
    fetchAnomalies()
  }, [])

  useEffect(() => {
    // Register refresh callbacks for chatbot to call on anomaly resolution
    setOnAnomalyResolved(async () => {
      // Fetch fresh data
      try {
        console.log("[FINANCIAL] Anomaly resolved, refreshing data...")
        const deskResponse = await fetch('/api/trading-desks')
        const deskData = await deskResponse.json()
        setTradingDesks(deskData.tradingDesks)
        setSummary(deskData.summary)

        const anomalyResponse = await fetch('/api/anomalies')
        const anomalyData = await anomalyResponse.json()
        setAnomalies(anomalyData.anomalies)
        
        toast({
          title: "Dashboard Refreshed",
          description: "Trading desk data has been updated with latest anomaly status",
          duration: 3000,
        })
      } catch (error) {
        console.error('Failed to refresh data:', error)
      }
    })
  }, [setOnAnomalyResolved, toast])

  useEffect(() => {
    const unsubscribe = anomalyStateService.subscribe((count) => {
      setCurrentAnomalyCount((prevCount) => {
        if (prevCount !== 0 && prevCount > count) {
          setShowResolutionPopup(true)
        }
        setPreviousAnomalyCount(prevCount)
        return count
      })
    })

    return unsubscribe
  }, [])

  const fetchTradingDesks = async () => {
    try {
      const response = await fetch('/api/trading-desks')
      const data = await response.json()
      setTradingDesks(data.tradingDesks)
      setSummary(data.summary)
    } catch (error) {
      console.error('Failed to fetch trading desks:', error)
    }
  }

  const fetchAnomalies = async () => {
    try {
      const response = await fetch('/api/anomalies')
      const data = await response.json()
      const previousCount = currentAnomalyCount
      const currentCount = data.anomalies.length
      anomalyStateService.updateAnomalyCount(currentCount)
      setPreviousAnomalyCount(previousCount)
      setCurrentAnomalyCount(currentCount)
      setAnomalies(data.anomalies)

      if (previousCount !== 0 && previousCount > currentCount) {
        setShowResolutionPopup(true)
      }
    } catch (error) {
      console.error('Failed to fetch anomalies:', error)
    }
  }

  const resolveAnomaly = async (
    deskId: string,
    options?: { successToastMessage?: string; suppressToast?: boolean }
  ) => {
    setIsResolving(true)
    try {
      const response = await fetch('/api/resolve-anomaly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desk_id: deskId })
      })
      const result = await response.json()
      setResolvedAnomaly(result)
      // Refresh data
      await fetchTradingDesks()
      await fetchAnomalies()

      if (!options?.suppressToast) {
        toast({
          title: "Anomaly Resolved",
          description: options?.successToastMessage ?? `${result.desk_name || 'Desk'} P&L updated to $${result.final_pnl.toFixed(1)}M`,
          duration: 3000,
        })
      }
    } catch (error) {
      console.error('Failed to resolve anomaly:', error)
      toast({
        title: "Resolution Failed",
        description: "Failed to resolve the anomaly. Please try again.",
        variant: "destructive",
        duration: 5000,
      })
    } finally {
      setIsResolving(false)
    }
  }

  const exportToCSV = () => {
    try {
      // Prepare CSV headers
      const headers = ['Desk ID', 'Desk Name', 'Region', 'Type', 'Status', 'P&L Reported', 'P&L Expected', 'Variance', 'Last Updated']
      
      // Prepare CSV rows
      const rows = tradingDesks.map(desk => [
        desk.desk_id,
        desk.desk_name,
        desk.region,
        desk.type,
        desk.status,
        desk.pnl_reported.toFixed(1),
        desk.pnl_expected.toFixed(1),
        desk.variance.toFixed(1),
        new Date(desk.last_updated).toLocaleString()
      ])

      // Combine headers and rows
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n')

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)
      link.setAttribute('download', `trading-desks-${new Date().toISOString().split('T')[0]}.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      toast({
        title: "Export Successful",
        description: `Downloaded ${tradingDesks.length} trading desks`,
        duration: 3000,
      })
    } catch (error) {
      console.error('Export failed:', error)
      toast({
        title: "Export Failed",
        description: "Failed to export CSV file",
        variant: "destructive",
        duration: 5000,
      })
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Reconciled':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'Pending':
        return <Clock className="w-5 h-5 text-yellow-500" />
      case 'Anomaly':
        return <XCircle className="w-5 h-5 text-red-500" />
      default:
        return <Clock className="w-5 h-5 text-gray-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Reconciled':
        return 'bg-green-500/10 text-green-300'
      case 'Pending':
        return 'bg-yellow-500/10 text-yellow-300'
      case 'Anomaly':
        return 'bg-red-500/10 text-red-300'
      default:
        return 'bg-gray-500/10 text-gray-300'
    }
  }

  const metrics = [
    {
      label: "Total Trading Desks",
      value: summary.totalDesks.toString(),
      detail: "Across all regions",
      icon: CreditCard,
      color: "from-blue-500 to-cyan-500",
    },
    {
      label: "Reconciled",
      value: summary.reconciled.toString(),
      detail: "Auto-reconciled today",
      icon: CheckCircle,
      color: "from-green-500 to-emerald-500",
    },
    {
      label: "Pending Review",
      value: summary.pending.toString(),
      detail: "Awaiting controller sign-off",
      icon: Clock,
      color: "from-yellow-500 to-orange-500",
    },
    {
      label: "Anomalies Detected",
      value: currentAnomalyCount.toString(),
      detail: "Requires immediate attention",
      icon: AlertTriangle,
      color: "from-red-500 to-rose-500",
    },
  ]

  function SolveWithAIButton({ deskId, onComplete }: { deskId: string; onComplete: () => Promise<void> | void }) {
    const [running, setRunning] = useState(false)
    const [progress, setProgress] = useState(0)
    const [stepText, setStepText] = useState('')

    useEffect(() => {
      let timer: NodeJS.Timeout | null = null
      if (running) {
        setProgress(0)
        const steps = ["Identifying affected instruments", "Refreshing market data & FX rates", "Reconciling valuations"]
        let step = 0
        setStepText(steps[step])
        timer = setInterval(() => {
          setProgress((p) => {
            const next = p + Math.floor(100 / (steps.length * 6))
            if (next >= 100) {
              // finish
              if (timer) clearInterval(timer)
              setProgress(100)
              setStepText('Finalizing changes')
              // call completion after a short delay
              setTimeout(async () => {
                try {
                  await Promise.resolve(onComplete())
                } catch (e) {
                  console.error(e)
                }
                setRunning(false)
                setProgress(0)
                setStepText('')
                toast({ title: 'AI Solve Complete', description: `Desk ${deskId} reconciled`, duration: 4000 })
              }, 700)
              return 100
            }
            // update step text every ~33% progress
            if (next > ((step + 1) * (100 / steps.length))) {
              step = Math.min(step + 1, steps.length - 1)
              setStepText(steps[step])
            }
            return next
          })
        }, 300)
      }
      return () => {
        if (timer) clearInterval(timer)
      }
    }, [running])

    return (
      <div>
        {!running ? (
          <Button
            onClick={() => {
              setRunning(true)
            }}
          >
            Solve Anomaly (AI)
          </Button>
        ) : (
          <div className="w-full">
            <div className="w-full bg-slate-800 rounded overflow-hidden h-3">
              <div className="bg-emerald-500 h-3" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-sm text-slate-300 mt-2">{stepText} — {progress}%</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-8 lg:p-10">
      <div className="max-w-7xl mx-auto space-y-8">
        <section className="space-y-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <p className="text-sm uppercase tracking-[0.32em] text-sky-400 dark:text-sky-400/80">Enterprise AI Operating System</p>
              <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white">Daily P&L Reconciliation</h1>
              <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-400">
                Goldman Sachs · Global Trading Floor · {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. Monitor desk reconciliation, variance trends, and control review status across all regions.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ThemeToggle />
              <Button variant="secondary" className="rounded-full px-5 py-3" onClick={exportToCSV}>Export CSV</Button>
              <Button className="rounded-full px-5 py-3" onClick={() => { fetchTradingDesks(); fetchAnomalies(); }}>Refresh</Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
            {metrics.map((metric) => (
              <Card key={metric.label} className="border-border/30 bg-slate-900/90 dark:bg-slate-900/90 bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700">
                <CardContent className="space-y-4 p-6">
                  <div className={`inline-flex items-center justify-center rounded-2xl bg-gradient-to-br ${metric.color} p-3 text-white shadow-lg`}>
                    <metric.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm uppercase tracking-[0.25em] text-slate-600 dark:text-slate-400">{metric.label}</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-900 dark:text-white">{metric.value}</p>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{metric.detail}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {anomalies.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center gap-4">
              <AlertTriangle className="w-6 h-6 text-red-500" />
              <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">Active Anomalies</h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {anomalies.map((anomaly) => (
                <Card
                  key={anomaly.desk_id}
                  className="border-red-500/30 bg-red-500/5 dark:bg-red-500/5 hover:bg-red-500/10 dark:hover:bg-red-500/10 cursor-pointer transition-colors border border-red-300 dark:border-red-500/30"
                  onClick={() => setSelectedAnomaly(anomaly)}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <h3 className="font-semibold text-slate-900 dark:text-white">{anomaly.desk_name}</h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">{anomaly.issue}</p>
                        <p className="text-lg font-bold text-red-600 dark:text-red-400">${anomaly.variance.toFixed(1)}M variance</p>
                      </div>
                      <Badge className="bg-red-500/10 dark:bg-red-500/10 text-red-700 dark:text-red-300">{anomaly.severity}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Anomaly Details Modal */}
            <Dialog open={!!selectedAnomaly} onOpenChange={(open) => !open && setSelectedAnomaly(null)}>
              <DialogContent className="bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white max-w-2xl">
                {selectedAnomaly && (
                  <>
                    <DialogHeader>
                      <DialogTitle className="text-xl text-slate-900 dark:text-white">Anomaly Analysis: {selectedAnomaly.desk_name}</DialogTitle>
                      <DialogDescription className="text-slate-600 dark:text-slate-400">
                        AI-powered root cause analysis and automated resolution
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6">
                      {/* Anomaly Details */}
                      <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <p className="text-sm text-slate-600 dark:text-slate-400">Reported P&L</p>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">${selectedAnomaly.reported_pnl.toFixed(1)}M</p>
                          </div>
                          <div className="space-y-2">
                            <p className="text-sm text-slate-600 dark:text-slate-400">Expected P&L</p>
                            <p className="text-2xl font-bold text-green-600 dark:text-green-400">${selectedAnomaly.expected_pnl.toFixed(1)}M</p>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <h4 className="font-semibold text-slate-900 dark:text-white">Root Causes Identified:</h4>
                          <ul className="space-y-2">
                            {selectedAnomaly.root_causes.map((cause, index) => (
                              <li key={index} className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                                <span className="text-red-600 dark:text-red-400 mt-1">•</span>
                                {cause}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="flex gap-3">
                          <Button
                            className="flex-1"
                            onClick={() => {
                              setShowAISuggestion(true)
                            }}
                          >
                            Ask AI Suggestion
                          </Button>
                          <Button
                            variant="outline"
                            className="flex-1 border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10"
                            onClick={() => {
                              sendAnomalyToChat({
                                desk_id: selectedAnomaly.desk_id,
                                desk_name: selectedAnomaly.desk_name,
                                reported_pnl: selectedAnomaly.reported_pnl,
                                expected_pnl: selectedAnomaly.expected_pnl,
                                variance: selectedAnomaly.variance,
                                issue: selectedAnomaly.issue,
                                root_causes: selectedAnomaly.root_causes,
                                severity: selectedAnomaly.severity
                              })
                              setSelectedAnomaly(null)
                            }}
                          >
                            Resolve Automatically
                          </Button>
                        </div>

                        {resolvedAnomaly && resolvedAnomaly.desk_id === selectedAnomaly.desk_id && (
                          <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                            <h4 className="font-semibold text-green-400 mb-2">Resolution Complete</h4>
                            <p className="text-sm text-slate-300 mb-2">Final P&L: ${resolvedAnomaly.final_pnl.toFixed(1)}M</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </DialogContent>
            </Dialog>

            {/* AI Suggestion Modal */}
            <Dialog open={showAISuggestion} onOpenChange={setShowAISuggestion}>
              <DialogContent className="bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white max-w-2xl">
                {selectedAnomaly && (
                  <>
                    <DialogHeader>
                      <DialogTitle className="text-xl text-slate-900 dark:text-white">AI Analysis: {selectedAnomaly.desk_name}</DialogTitle>
                      <DialogDescription className="text-slate-600 dark:text-slate-400">
                        AI-powered root cause analysis and resolution steps
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6">
                      <div className="space-y-3">
                        <h4 className="font-semibold text-slate-900 dark:text-white">Issue Summary</h4>
                        <p className="text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
                          {generateAISuggestion(selectedAnomaly).issue}
                        </p>
                      </div>

                      <div className="space-y-3">
                        <h4 className="font-semibold text-slate-900 dark:text-white">Root Cause</h4>
                        <p className="text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
                          {generateAISuggestion(selectedAnomaly).rootCause}
                        </p>
                      </div>

                      <div className="space-y-3">
                        <h4 className="font-semibold text-slate-900 dark:text-white">Recommended Resolution Steps</h4>
                        <ol className="space-y-2">
                          {generateAISuggestion(selectedAnomaly).steps.map((step: string, index: number) => (
                            <li key={index} className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                              <span className="text-blue-600 dark:text-blue-400 font-semibold mt-1">{index + 1}.</span>
                              {step}
                            </li>
                          ))}
                        </ol>
                      </div>

                      {isResolving && currentStepIndex >= 0 ? (
                        <div className="rounded-3xl border border-slate-700 bg-slate-950/95 p-5 text-center transition-all duration-300 opacity-100">
                          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border-4 border-slate-700 border-t-cyan-400 animate-spin" />
                          <p className="text-sm text-slate-400">Resolving with AI...</p>
                          <p className="mt-3 text-base font-semibold text-white transition-opacity duration-300">
                            {aiResolveSteps[currentStepIndex]}
                          </p>
                          <div className="mt-4 flex items-center justify-center gap-2">
                            {aiResolveSteps.map((_, idx) => (
                              <span
                                key={idx}
                                className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ${
                                  idx === currentStepIndex ? 'bg-cyan-400' : 'bg-slate-700'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-3 pt-4">
                          <Button
                            className="flex-1"
                            onClick={handleResolveWithAI}
                            disabled={isResolving}
                          >
                            {isResolving ? "Resolving..." : "Resolve with AI"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setShowAISuggestion(false)}
                          >
                            Close
                          </Button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </DialogContent>
            </Dialog>

            <Dialog open={showResolutionPopup} onOpenChange={(open) => !open && setShowResolutionPopup(false)}>
              <DialogContent className="bg-transparent border-0 shadow-none max-w-md p-0 overflow-visible [&>button]:hidden">
                <DialogHeader>
                  <DialogTitle className="sr-only">Anomaly Cleared</DialogTitle>
                </DialogHeader>
                <style jsx>{`
                  @keyframes popScale {
                    0% { transform: scale(0.3) rotate(-10deg); opacity: 0; }
                    50% { transform: scale(1.08) rotate(2deg); opacity: 1; }
                    100% { transform: scale(1) rotate(0deg); opacity: 1; }
                  }
                  @keyframes checkDraw {
                    0% { stroke-dashoffset: 100; }
                    100% { stroke-dashoffset: 0; }
                  }
                  @keyframes ringPulse {
                    0% { transform: scale(0.8); opacity: 0; }
                    50% { transform: scale(1); opacity: 1; }
                    100% { transform: scale(1.5); opacity: 0; }
                  }
                  @keyframes shimmer {
                    0% { background-position: -200% 0; }
                    100% { background-position: 200% 0; }
                  }
                  @keyframes particleFly1 {
                    0% { transform: translate(0, 0) scale(1); opacity: 1; }
                    100% { transform: translate(-80px, -120px) scale(0); opacity: 0; }
                  }
                  @keyframes particleFly2 {
                    0% { transform: translate(0, 0) scale(1); opacity: 1; }
                    100% { transform: translate(90px, -100px) scale(0); opacity: 0; }
                  }
                  @keyframes particleFly3 {
                    0% { transform: translate(0, 0) scale(1); opacity: 1; }
                    100% { transform: translate(-60px, 80px) scale(0); opacity: 0; }
                  }
                  @keyframes particleFly4 {
                    0% { transform: translate(0, 0) scale(1); opacity: 1; }
                    100% { transform: translate(70px, 90px) scale(0); opacity: 0; }
                  }
                  @keyframes particleFly5 {
                    0% { transform: translate(0, 0) scale(1); opacity: 1; }
                    100% { transform: translate(-100px, -40px) scale(0); opacity: 0; }
                  }
                  @keyframes particleFly6 {
                    0% { transform: translate(0, 0) scale(1); opacity: 1; }
                    100% { transform: translate(110px, -50px) scale(0); opacity: 0; }
                  }
                  .popup-container {
                    animation: popScale 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                  }
                  .check-icon {
                    animation: checkDraw 0.8s ease-out 0.3s forwards;
                    stroke-dasharray: 100;
                    stroke-dashoffset: 100;
                  }
                  .ring-pulse {
                    animation: ringPulse 1.5s ease-out 0.2s infinite;
                  }
                  .shimmer-text {
                    background: linear-gradient(90deg, #34d399, #6ee7b7, #a7f3d0, #6ee7b7, #34d399);
                    background-size: 200% auto;
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    animation: shimmer 3s linear infinite;
                  }
                  .particle {
                    position: absolute;
                    border-radius: 50%;
                    pointer-events: none;
                  }
                  .p1 { animation: particleFly1 1.2s ease-out 0.4s forwards; background: #34d399; width: 8px; height: 8px; top: 50%; left: 50%; }
                  .p2 { animation: particleFly2 1.0s ease-out 0.5s forwards; background: #6ee7b7; width: 6px; height: 6px; top: 50%; left: 50%; }
                  .p3 { animation: particleFly3 1.3s ease-out 0.3s forwards; background: #a78bfa; width: 7px; height: 7px; top: 50%; left: 50%; }
                  .p4 { animation: particleFly4 1.1s ease-out 0.6s forwards; background: #fbbf24; width: 5px; height: 5px; top: 50%; left: 50%; }
                  .p5 { animation: particleFly5 1.4s ease-out 0.35s forwards; background: #60a5fa; width: 6px; height: 6px; top: 50%; left: 50%; }
                  .p6 { animation: particleFly6 1.0s ease-out 0.45s forwards; background: #f472b6; width: 8px; height: 8px; top: 50%; left: 50%; }
                `}</style>
                <div className="popup-container relative">
                  {/* Particles */}
                  <div className="particle p1" />
                  <div className="particle p2" />
                  <div className="particle p3" />
                  <div className="particle p4" />
                  <div className="particle p5" />
                  <div className="particle p6" />

                  <div className="relative bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border border-emerald-500/30 rounded-3xl shadow-2xl shadow-emerald-500/20 overflow-hidden">
                    {/* Top gradient glow */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-gradient-to-b from-emerald-500/20 to-transparent rounded-full blur-3xl" />

                    <div className="relative z-10 p-8 flex flex-col items-center text-center space-y-5">
                      {/* Animated checkmark */}
                      <div className="relative">
                        <div className="ring-pulse absolute inset-0 w-24 h-24 rounded-full border-2 border-emerald-400/40" />
                        <div className="w-24 h-24 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center shadow-xl shadow-emerald-500/40">
                          <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none">
                            <path
                              className="check-icon"
                              d="M5 13l4 4L19 7"
                              stroke="white"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                      </div>

                      {/* Title */}
                      <div className="space-y-2">
                        <h2 className="shimmer-text text-2xl font-bold tracking-tight">
                          Anomaly Cleared
                        </h2>
                        <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
                          The P&L variance has been successfully reconciled. All market data and FX rates have been refreshed and validated.
                        </p>
                      </div>

                      {/* Status badges */}
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-full text-xs font-semibold text-emerald-400">
                          <span className="w-2 h-2 bg-emerald-400 rounded-full" />
                          Reconciled
                        </span>
                        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded-full text-xs font-semibold text-blue-400">
                          <span className="w-2 h-2 bg-blue-400 rounded-full" />
                          Data Refreshed
                        </span>
                      </div>

                      {/* Divider */}
                      <div className="w-full h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent" />

                      {/* Actions */}
                      <Button
                        className="w-full bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-bold shadow-lg shadow-emerald-500/25 rounded-xl py-5 text-sm tracking-wide"
                        onClick={async () => {
                          setShowResolutionPopup(false)
                          await fetchTradingDesks()
                          await fetchAnomalies()
                        }}
                      >
                        Continue to Dashboard
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </section>
        )}

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">Trading Desks Overview</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">Real-time P&L reconciliation status across all desks</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className={`rounded-full px-3 py-1 ${getStatusColor('Reconciled')}`}>Reconciled</Badge>
              <Badge className={`rounded-full px-3 py-1 ${getStatusColor('Pending')}`}>Pending</Badge>
              <Badge className={`rounded-full px-3 py-1 ${getStatusColor('Anomaly')}`}>Anomaly</Badge>
            </div>
          </div>

          <Card className="border-border/30 bg-white dark:bg-slate-900/90 shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-100 dark:bg-slate-950/80">
                  <TableRow className="border-slate-200 dark:border-slate-700">
                    <TableHead className="text-slate-700 dark:text-slate-400">Desk ID</TableHead>
                    <TableHead className="text-slate-700 dark:text-slate-400">Desk Name</TableHead>
                    <TableHead className="text-slate-700 dark:text-slate-400">Region</TableHead>
                    <TableHead className="text-slate-700 dark:text-slate-400">Type</TableHead>
                    <TableHead className="text-slate-700 dark:text-slate-400">P&L Reported</TableHead>
                    <TableHead className="text-slate-700 dark:text-slate-400">Expected</TableHead>
                    <TableHead className="text-slate-700 dark:text-slate-400">Variance</TableHead>
                    <TableHead className="text-slate-700 dark:text-slate-400">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tradingDesks.map((desk) => (
                    <TableRow key={desk.desk_id} className="border-slate-200 dark:border-slate-800">
                      <TableCell className="font-mono text-slate-700 dark:text-slate-300">{desk.desk_id}</TableCell>
                      <TableCell className="text-slate-900 dark:text-slate-100 font-semibold">{desk.desk_name}</TableCell>
                      <TableCell className="text-slate-700 dark:text-slate-300">{desk.region}</TableCell>
                      <TableCell className="text-slate-700 dark:text-slate-300">{desk.type}</TableCell>
                      <TableCell className="text-slate-900 dark:text-slate-100">${desk.pnl_reported.toFixed(1)}M</TableCell>
                      <TableCell className="text-slate-900 dark:text-slate-100">${desk.pnl_expected.toFixed(1)}M</TableCell>
                      <TableCell className={`font-semibold ${desk.variance > 0 ? 'text-red-600 dark:text-red-400' : desk.variance < 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}`}>
                        ${desk.variance.toFixed(1)}M
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(desk.status)}
                          <Badge className={`rounded-full px-2 py-1 text-xs ${getStatusColor(desk.status)}`}>
                            {desk.status}
                          </Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </section>
      </div>
    </div>
  )
}