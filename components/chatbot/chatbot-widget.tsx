"use client";

import { useState, useRef, useEffect } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Send, Sparkles, Bot, Zap, AlertCircle, Lock, Mic, MicOff, AlertTriangle } from "lucide-react"
import { ComparisonChart } from "./comparison-chart"
import { useChatbot } from "./chatbot-provider"
import { anomalyStateService } from "@/components/anomaly-state.service"

interface ComparisonData {
  companies: string[]
  metrics: Array<{
    name: string
    [key: string]: string | number
  }>
}

interface ErrorResponse {
  error?: string
  message?: string
  details?: string
  type?: string
  code?: string
}

export function ChatbotWidget() {
  const [input, setInput] = useState("")
  const [comparisonData, setComparisonData] = useState<ComparisonData | null>(null)
  const [resolving, setResolving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentAnomalyId, setCurrentAnomalyId] = useState<string | null>(null)
  const [isAnomalyMode, setIsAnomalyMode] = useState(false)
  const [error, setError] = useState<ErrorResponse | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [failedMessageIds, setFailedMessageIds] = useState<Set<string>>(new Set())
  const [showResolvedPopup, setShowResolvedPopup] = useState(false)
  const [pendingClearMessages, setPendingClearMessages] = useState(false)
  const recognitionRef = useRef<any>(null)
  const silenceTimeoutRef = useRef<any>(null)
  const [isClosing, setIsClosing] = useState(false)
  const { pendingAnomaly, setPendingAnomaly, onAnomalyResolved } = useChatbot()

  // Get user role from session API on mount
  useEffect(() => {
    const fetchUserSession = async () => {
      try {
        const sessionId = localStorage.getItem("gs_session_id")
        if (!sessionId) {
          console.log("[CHATBOT] No session ID found")
          return
        }

        const res = await fetch(`/api/sessions?sessionId=${sessionId}`)
        const data = await res.json()
        
        if (data.success && data.session) {
          setUserRole(data.session.role)
          console.log("[CHATBOT] User role from session:", data.session.role)
        }
      } catch (error) {
        console.error("[CHATBOT] Failed to fetch session:", error)
      }
    }

    fetchUserSession()
  }, [])

  // Initialize Web Speech API for voice dictation
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.warn("[CHATBOT] Speech Recognition API not supported")
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = "en-US"

    recognition.onstart = () => {
      console.log("[CHATBOT] Voice dictation started")
      setIsListening(true)
      setIsClosing(false)
      // Start 5-second initial silence timeout
      clearTimeout(silenceTimeoutRef.current)
      silenceTimeoutRef.current = setTimeout(() => {
        console.log("[CHATBOT] No speech detected for 5s, auto-stopping")
        stopListeningWithAnimation()
      }, 5000)
    }

    recognition.onend = () => {
      console.log("[CHATBOT] Voice dictation ended")
      clearTimeout(silenceTimeoutRef.current)
      // Only set isListening false if not already closing (animation handles it)
      if (!isClosing) {
        setIsListening(false)
      }
    }

    recognition.onresult = (event: any) => {
      // Reset silence timeout on any speech activity
      clearTimeout(silenceTimeoutRef.current)
      silenceTimeoutRef.current = setTimeout(() => {
        console.log("[CHATBOT] Silence detected for 2s after speech, auto-stopping")
        stopListeningWithAnimation()
      }, 2000)

      let interimTranscript = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          // Final result - add to input
          setInput((prev) => prev + transcript + " ")
        } else {
          // Interim result for preview
          interimTranscript += transcript
        }
      }
    }

    recognition.onerror = (event: any) => {
      clearTimeout(silenceTimeoutRef.current)
      if (event.error !== "aborted") {
        console.error("[CHATBOT] Speech recognition error:", event.error)
      }
    }

    recognitionRef.current = recognition

    // Cleanup function to abort recognition on unmount
    return () => {
      clearTimeout(silenceTimeoutRef.current)
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  }, [])

  // Stop listening with a closing animation
  const stopListeningWithAnimation = () => {
    clearTimeout(silenceTimeoutRef.current)
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch (e) {}
    }
    setIsClosing(true)
    // Wait for the pop-out animation to finish before hiding
    setTimeout(() => {
      setIsListening(false)
      setIsClosing(false)
    }, 450)
  }

  // Handle auto-send when listening ends
  useEffect(() => {
    if (!isListening && input.trim()) {
      const timer = setTimeout(() => {
        handleVoiceSubmit()
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [isListening])

  const toggleVoiceDictation = () => {
    if (!recognitionRef.current) {
      console.error("[CHATBOT] Speech Recognition not available")
      return
    }

    if (isListening) {
      stopListeningWithAnimation()
    } else {
      recognitionRef.current.start()
      setIsListening(true)
    }
  }

  const handleVoiceSubmit = () => {
    if (!input.trim() || isLoading) return

    // ✅ All users can query all data - no restrictions
    setComparisonData(null)
    setError(null)
    sendMessage({ text: input })
    setInput("")
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  /**
   * Parse error response from API
   * Handles both structured error objects and plain error messages
   */
  const parseErrorResponse = (error: any): ErrorResponse => {
    console.log("[CHATBOT] parseErrorResponse called with:", error)
    
    // If it's already a structured error object
    if (error?.error || error?.message) {
      console.log("[CHATBOT] Parsed as structured error:", error)
      
      // Check if message is a JSON string and extract it
      let message = error.message
      if (typeof message === 'string' && message.startsWith('{')) {
        try {
          const parsed = JSON.parse(message)
          message = parsed.message || parsed.error || message
        } catch {}
      }
      
      return {
        error: error.error,
        message: message,
        details: error.details,
        type: error.type,
        code: error.code,
      }
    }

    // If it's a string, try to parse as JSON
    if (typeof error === "string") {
      try {
        const parsed = JSON.parse(error)
        if (parsed?.error || parsed?.message) {
          console.log("[CHATBOT] Parsed string as JSON:", parsed)
          return {
            error: parsed.error || "Error",
            message: parsed.message || String(parsed),
            details: parsed.details,
            type: parsed.type,
            code: parsed.code,
          }
        }
      } catch {}
      // If not JSON, return as generic message
      console.log("[CHATBOT] Treating string as plain message:", error)
      return {
        error: "Error",
        message: error,
      }
    }

    // If the error object has a message but no explicit error type, normalize it
    if (error?.message) {
      console.log("[CHATBOT] Parsed as error with message:", error)
      
      // Check if message is a JSON string
      let message = error.message
      if (typeof message === 'string' && message.startsWith('{')) {
        try {
          const parsed = JSON.parse(message)
          message = parsed.message || parsed.error || message
        } catch {}
      }
      
      return {
        error: error.error || "Error",
        message: message,
        details: error.details,
        type: error.type,
        code: error.code,
      }
    }

    // Fallback
    console.log("[CHATBOT] Using fallback error message")
    return {
      error: "Error",
      message: "An unexpected error occurred",
    }
  }

  const { messages, sendMessage, setMessages, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: async (resource, options) => {
        // Get dashboard from pathname
        const currentPath = typeof window !== "undefined" ? window.location.pathname : ""
        const dashboard = currentPath.includes("/financial") ? "financial" : currentPath.includes("/sales") ? "sales" : "financial"
        
        // Get session ID from localStorage or cookie
        const sessionId = typeof window !== "undefined" ? localStorage.getItem("gs_session_id") : null
        
        // Parse the request body to add dashboard
        const body = options?.body ? JSON.parse(options.body as string) : {}
        body.dashboard = dashboard
        
        // Create new options with updated body
        const updatedOptions = {
          ...options,
          body: JSON.stringify(body),
          credentials: "include" as const, // Include cookies in the request
          headers: {
            ...((options?.headers || {}) as Record<string, string>),
            "Content-Type": "application/json",
            ...(sessionId ? { "X-Session-ID": sessionId } : {})
          }
        }
        
        console.log(`[CHATBOT] Sending request with dashboard: ${dashboard}, sessionId: ${sessionId}`)
        const response = await fetch(resource, updatedOptions)
        
        // If we get a 403 error, clone and return it so the error can be read by the error handler
        if (response.status === 403) {
          console.error("[CHATBOT] Authorization error (403) received from server")
          // Clone the response so it can be read by the error handler
          return response.clone()
        }
        
        return response
      }
    }),
    onError: (error) => {
      console.error("[CHATBOT] Error:", error)
      // Try to extract the error response from the error object
      const errorData = (error as any)?.data || error
      const parsedError = parseErrorResponse(errorData)
      setError(parsedError)
      
      // If this is a 403 authorization error, flag messages for clearing
      // so the blocked query doesn't get re-sent with the next request
      if (parsedError.code === "403_FORBIDDEN") {
        console.log("[CHATBOT] Flagging messages for clear after 403")
        setPendingClearMessages(true)
      }
    },
    onFinish: (result) => {
      console.log("[CHATBOT] Message finished")
      const text = ((result.message as any).parts || [])
        .filter((part: any) => part?.type === "text" || part?.type === "reasoning")
        .map((part: any) => part.text || "")
        .join("")

      if (text.includes("COMPARISON_DATA:")) {
        try {
          const jsonMatch = text.match(/COMPARISON_DATA:([\s\S]*?)END_COMPARISON/)
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[1])
            setComparisonData(data)
          }
        } catch {}
      }
    },
  })

  // Clear messages after 403 error - done via useEffect to avoid stale closure in onError
  useEffect(() => {
    if (pendingClearMessages) {
      console.log("[CHATBOT] Clearing messages after 403 authorization failure")
      setMessages([])
      setPendingClearMessages(false)
    }
  }, [pendingClearMessages, setMessages])

  // Custom submit handler
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    // ✅ All users can query all data - no restrictions
    setComparisonData(null)
    setError(null)
    sendMessage({ text: input })
    setInput("")
  }

  const isLoading = status === "streaming" || status === "submitted"

  const isUserNearBottom = () => {
    const el = scrollRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100
  }

  useEffect(() => {
    if (isUserNearBottom()) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  // Handle pending anomaly from financial dashboard
  useEffect(() => {
    if (pendingAnomaly) {
      const normalizedRole = userRole?.toLowerCase()
      if (normalizedRole === "sales") {
        console.warn("[CHATBOT] Sales user blocked from pending anomaly analysis")
        setError({
          error: "Access Restricted",
          message: "🔒 You do not have permission to analyze P&L anomalies."
        })
        return
      }

      console.log("[CHATBOT] Received pending anomaly:", pendingAnomaly)
      setIsAnomalyMode(true)
      setError(null)
      const anomalyMessage = `Please analyze and resolve this P&L anomaly:

**Desk:** ${pendingAnomaly.desk_name}
**Issue:** ${pendingAnomaly.issue}
**Reported P&L:** $${pendingAnomaly.reported_pnl}M
**Expected P&L:** $${pendingAnomaly.expected_pnl}M
**Variance:** $${pendingAnomaly.variance}M
**Severity:** ${pendingAnomaly.severity}

**Root Causes Identified:**
${pendingAnomaly.root_causes.map((cause) => `- ${cause}`).join('\n')}

Please provide a brief, simple summary (2-3 sentences max) of the issue and confirm if you are ready to proceed with automated resolution.`

      setComparisonData(null)
      console.log("[CHATBOT] Sending anomaly message to AI...")
      sendMessage({ text: anomalyMessage })
      // Don't clear pendingAnomaly here - keep it for the resolve button!
    }
  }, [pendingAnomaly, sendMessage])

  const getMessageText = (message: typeof messages[0]) => {
    const text = (message as any).parts
      ?.filter((part: any) => part?.type === "text" || part?.type === "reasoning")
      .map((part: any) => {
        const partText = part.text || ""
        // Ensure we always return a string
        return typeof partText === "string" ? partText : JSON.stringify(partText)
      })
      .join("") || ""
    
    // Ensure we always return a string, not an object
    return typeof text === "string" ? text : JSON.stringify(text)
  }

  const normalizeChatText = (text: string) => {
    return text
      .replace(/^\s*\*\s+/gm, "- ")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/_(.*?)_/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s*#{1,6}\s*/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  }

  const formatMessageText = (text: any) => {
    // Ensure text is a string
    const stringText = typeof text === "string" ? text : JSON.stringify(text)
    return normalizeChatText(stringText.replace(/COMPARISON_DATA:[\s\S]*?END_COMPARISON/g, "")).trim()
  }

  const handleResolveAnomaly = async (deskId: string) => {
    if (!pendingAnomaly) return
    
    setResolving(true)
    setCurrentAnomalyId(deskId)
    setProgress(0)

    // 4-5 second progress animation
    const duration = 4500 // 4.5 seconds
    const startTime = Date.now()
    const animateProgress = () => {
      const elapsed = Date.now() - startTime
      const progressPercent = Math.min((elapsed / duration) * 100, 100)
      setProgress(progressPercent)

      if (progressPercent < 100) {
        requestAnimationFrame(animateProgress)
      } else {
        // Resolve complete - call API and refresh
        fetch('/api/resolve-anomaly', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ desk_id: deskId })
        }).then(async (response) => {
          // Wait a moment for API to complete
          await new Promise(resolve => setTimeout(resolve, 500))

          // Call the refresh callback to update dashboard
          // (dashboard handles anomaly count updates internally)
          if (onAnomalyResolved && typeof onAnomalyResolved === 'function') {
            try {
              await onAnomalyResolved()
            } catch (err) {
              console.error('Error calling onAnomalyResolved:', err)
            }
          }
        }).catch(err => console.error('Failed to resolve:', err))
        
        setResolving(false)
        setCurrentAnomalyId(null)
        setProgress(0)
        setPendingAnomaly(null)
        setIsAnomalyMode(false)
        setShowResolvedPopup(true)
      }
    }

    requestAnimationFrame(animateProgress)
  }

  return (
    <>
      <style jsx>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        /* Cartoon Pop-In Animation */
        @keyframes cartoonPopIn {
          0% {
            transform: scale(0) rotate(-10deg);
            opacity: 0;
          }
          50% {
            transform: scale(1.15) rotate(3deg);
          }
          100% {
            transform: scale(1) rotate(0deg);
            opacity: 1;
          }
        }

        /* Pop Out Animation */
        @keyframes cartoonPopOut {
          0% {
            transform: scale(1) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: scale(0) rotate(-10deg);
            opacity: 0;
          }
        }

        /* Bounce Effect */
        @keyframes bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-20px);
          }
        }

        /* Pulse Glow for Mic */
        @keyframes micPulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7), inset 0 0 0 0 rgba(239, 68, 68, 0.3);
          }
          50% {
            box-shadow: 0 0 0 25px rgba(239, 68, 68, 0), inset 0 0 30px 0 rgba(239, 68, 68, 0.5);
          }
        }

        /* Wave Animation for listening text */
        @keyframes wave {
          0%, 100% {
            opacity: 0.6;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.08);
          }
        }

        /* Soundwave Animation */
        @keyframes soundwave {
          0%, 100% {
            transform: scaleY(0.4);
            opacity: 0.4;
          }
          50% {
            transform: scaleY(1);
            opacity: 1;
          }
        }

        /* Fade Background */
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        .modal-enter {
          animation: cartoonPopIn 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .modal-exit {
          animation: cartoonPopOut 0.5s cubic-bezier(0.64, 0, 0.78, 0.34) forwards;
        }

        .mic-glow {
          animation: micPulse 2.5s ease-in-out infinite;
        }

        .listening-text {
          animation: wave 1.5s ease-in-out infinite;
        }

        .soundwave-bar {
          animation: soundwave 0.8s ease-in-out infinite;
        }

        .soundwave-bar:nth-child(1) {
          animation-delay: 0s;
        }
        .soundwave-bar:nth-child(2) {
          animation-delay: 0.1s;
        }
        .soundwave-bar:nth-child(3) {
          animation-delay: 0.2s;
        }
        .soundwave-bar:nth-child(4) {
          animation-delay: 0.3s;
        }
        .soundwave-bar:nth-child(5) {
          animation-delay: 0.2s;
        }
        .soundwave-bar:nth-child(6) {
          animation-delay: 0.1s;
        }

        .fade-in {
          animation: fadeIn 0.4s ease-out;
        }

        /* Close Button Animation */
        @keyframes rotateClose {
          0% {
            transform: rotate(0deg) scale(1);
          }
          50% {
            transform: rotate(180deg) scale(1.1);
          }
          100% {
            transform: rotate(360deg) scale(1);
          }
        }

        .close-btn:hover {
          animation: rotateClose 0.6s ease-in-out;
        }

        /* Progress Bar Shimmer */
        @keyframes shimmerSlide {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        /* Resolve Popup Animations */
        @keyframes resolvePopIn {
          0% { transform: scale(0.3) rotate(-8deg); opacity: 0; }
          60% { transform: scale(1.06) rotate(1deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes resolveCheckDraw {
          0% { stroke-dashoffset: 100; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes resolveRingPulse {
          0% { transform: scale(0.8); opacity: 0; }
          50% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes resolveShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes rp1 { 0%{transform:translate(0,0) scale(1);opacity:1} 100%{transform:translate(-70px,-110px) scale(0);opacity:0} }
        @keyframes rp2 { 0%{transform:translate(0,0) scale(1);opacity:1} 100%{transform:translate(85px,-95px) scale(0);opacity:0} }
        @keyframes rp3 { 0%{transform:translate(0,0) scale(1);opacity:1} 100%{transform:translate(-55px,75px) scale(0);opacity:0} }
        @keyframes rp4 { 0%{transform:translate(0,0) scale(1);opacity:1} 100%{transform:translate(65px,85px) scale(0);opacity:0} }
        @keyframes rp5 { 0%{transform:translate(0,0) scale(1);opacity:1} 100%{transform:translate(-95px,-35px) scale(0);opacity:0} }
        @keyframes rp6 { 0%{transform:translate(0,0) scale(1);opacity:1} 100%{transform:translate(100px,-45px) scale(0);opacity:0} }
        .resolve-popup { animation: resolvePopIn 0.6s cubic-bezier(0.34,1.56,0.64,1) forwards; }
        .resolve-check { animation: resolveCheckDraw 0.8s ease-out 0.3s forwards; stroke-dasharray:100; stroke-dashoffset:100; }
        .resolve-ring { animation: resolveRingPulse 1.5s ease-out 0.2s infinite; }
        .resolve-shimmer {
          background: linear-gradient(90deg, #34d399, #6ee7b7, #a7f3d0, #6ee7b7, #34d399);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: resolveShimmer 3s linear infinite;
        }
        .rpt { position:absolute; border-radius:50%; pointer-events:none; }
        .rp1 { animation:rp1 1.2s ease-out 0.4s forwards; background:#34d399; width:8px; height:8px; top:40%; left:50%; }
        .rp2 { animation:rp2 1.0s ease-out 0.5s forwards; background:#6ee7b7; width:6px; height:6px; top:40%; left:50%; }
        .rp3 { animation:rp3 1.3s ease-out 0.3s forwards; background:#a78bfa; width:7px; height:7px; top:40%; left:50%; }
        .rp4 { animation:rp4 1.1s ease-out 0.6s forwards; background:#fbbf24; width:5px; height:5px; top:40%; left:50%; }
        .rp5 { animation:rp5 1.4s ease-out 0.35s forwards; background:#60a5fa; width:6px; height:6px; top:40%; left:50%; }
        .rp6 { animation:rp6 1.0s ease-out 0.45s forwards; background:#f472b6; width:8px; height:8px; top:40%; left:50%; }
      `}</style>

      {/* Listening Modal Popup with Cartoon Animation */}
      {isListening && (
        <div 
          className="fixed inset-0 z-[60] flex items-center justify-center fade-in"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.55)' }}
          onClick={stopListeningWithAnimation}
        >
          <div 
            className={`${isClosing ? 'modal-exit' : 'modal-enter'} relative bg-gradient-to-br from-red-950 via-slate-900 to-red-950 border-4 border-red-500 rounded-[40px] shadow-2xl shadow-red-500/70 p-12 flex flex-col items-center justify-center w-96 h-[430px]`}
            onClick={(e) => e.stopPropagation()}
          >
            
            {/* Animated Background Glow */}
            <div className="absolute inset-0 rounded-[40px] bg-gradient-to-br from-red-600/25 to-transparent opacity-50"></div>

            {/* Close Button - Top Right */}
            <button
              onClick={stopListeningWithAnimation}
              className="close-btn absolute top-5 right-5 z-20 w-12 h-12 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center transition-all duration-200 hover:shadow-lg hover:shadow-red-500/60 cursor-pointer border-2 border-red-400 active:scale-95"
              title="Stop listening"
            >
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Content Container */}
            <div className="relative z-10 flex flex-col items-center justify-center w-full h-full gap-6">
              
              {/* Red Mic Icon with Pulse Glow */}
              <div className="relative flex items-center justify-center mt-2">
                <div className="mic-glow absolute w-40 h-40 bg-gradient-to-br from-red-600 to-red-700 rounded-full"></div>
                <button
                  onClick={stopListeningWithAnimation}
                  className="relative w-32 h-32 bg-gradient-to-br from-red-600 to-red-800 rounded-full flex items-center justify-center shadow-2xl shadow-red-500/80 border-4 border-red-400 hover:from-red-500 hover:to-red-700 transition-all duration-200 cursor-pointer hover:scale-110 active:scale-95"
                >
                  <Mic className="w-16 h-16 text-white animate-bounce" style={{ animationDuration: '1.5s' }} />
                </button>
              </div>

              {/* Listening Text */}
              <div className="text-center space-y-2">
                <p className="listening-text text-white font-black text-5xl tracking-wider">
                  Listening
                </p>
                <p className="text-red-300 font-semibold text-lg">Speak Now</p>
              </div>

              {/* Soundwave Visualization */}
              <div className="flex items-center justify-center gap-2.5 h-16">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="soundwave-bar bg-gradient-to-t from-red-500 to-red-300 rounded-full shadow-lg"
                    style={{ width: '3px', height: `${25 + i * 12}px` }}
                  ></div>
                ))}
              </div>

              {/* Hint Text */}
              <p className="text-red-200/70 text-sm font-medium leading-tight">
                Tap to stop listening
              </p>
            </div>
          </div>
        </div>
      )}

      <Card className="fixed top-20 right-0 bottom-0 w-[360px] flex flex-col shadow-2xl z-50 overflow-hidden border-l border-violet-900/30 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 backdrop-blur-xl">
        <CardHeader className="pb-3 border-b border-violet-900/20 shrink-0 px-4 bg-gradient-to-r from-violet-900/10 to-transparent">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-transparent">GS AI Assistant</CardTitle>
                <p className="text-xs text-violet-300/60">Goldman Sachs</p>
              </div>
            </div>
            <div className="text-xs text-violet-300/50 font-medium">Right panel</div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col p-0 overflow-hidden bg-gradient-to-b from-slate-900 via-slate-900/50 to-slate-950">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 no-scrollbar space-y-4">
            {error && (
              <div className="animate-in slide-in-from-top-4 duration-300">
                <div className="bg-gradient-to-br from-amber-950/70 via-yellow-900/40 to-orange-950/30 border border-amber-600/40 rounded-xl backdrop-blur-md overflow-hidden shadow-2xl relative">
                  {/* Decorative gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-r from-amber-600/5 to-yellow-600/5 pointer-events-none" />
                  
                  <div className="p-6 space-y-4 relative z-10">
                    {/* Exception Header */}
                    <div className="flex items-start gap-4">
                      <div className="flex gap-2 mt-0.5">
                        <div className="p-2.5 bg-amber-500/15 rounded-lg border border-amber-500/20">
                          <AlertTriangle className="w-5 h-5 text-amber-400" />
                        </div>
                        <div className="p-2.5 bg-amber-500/10 rounded-lg border border-amber-500/10">
                          <Lock className="w-5 h-5 text-amber-300/80" />
                        </div>
                      </div>
                      <div className="flex-1 pt-0.5">
                        <h3 className="font-bold text-base bg-gradient-to-r from-amber-200 via-yellow-100 to-orange-200 bg-clip-text text-transparent">
                          {error.error || "Access Exception"}
                        </h3>
                        <p className="text-amber-300/60 text-xs mt-1 font-medium uppercase tracking-widest">
                          ⚠ Exception
                        </p>
                        {error.code && (
                          <p className="text-amber-400/50 text-xs mt-1 font-mono">
                            [{error.code}]
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Divider */}
                    <div className="h-px bg-gradient-to-r from-amber-700/0 via-amber-600/30 to-amber-700/0" />

                    {/* Exception Message */}
                    <div className="space-y-3">
                      <div>
                        <p className="text-amber-100/90 text-sm leading-relaxed font-medium">
                          {error.message || "You don't have permission to access this resource."}
                        </p>
                      </div>

                      {/* Exception Details Box */}
                      {error.details && (
                        <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-3">
                          <p className="text-amber-300/70 text-xs leading-relaxed font-mono">
                            <span className="text-amber-400 mr-2">→</span>{error.details}
                          </p>
                        </div>
                      )}

                      {/* Exception Type Badge */}
                      {error.type && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-900/30 border border-amber-600/40 rounded-md text-xs font-mono text-amber-300">
                            <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                            {error.type}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-2 pt-2 border-t border-amber-700/20">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setError(null)}
                        className="border-amber-600/40 text-amber-200 hover:bg-amber-900/30 hover:text-amber-100 hover:border-amber-500/60 transition-all duration-200 mt-3"
                      >
                        Dismiss
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setInput("");
                          setError(null);
                        }}
                        className="text-amber-300 hover:bg-amber-900/40 hover:text-amber-100 transition-all duration-200 mt-3"
                      >
                        Clear & Retry
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {messages.length === 0 && !error && (
              <div className="text-center py-12">
                <div className="p-3 bg-gradient-to-br from-violet-900/20 to-purple-900/10 rounded-2xl w-fit mx-auto mb-4 border border-violet-700/20">
                  <Bot className="w-8 h-8 text-violet-400" />
                </div>
                <p className="text-sm text-violet-300/70 font-medium">
                  Ask me about clients, comparisons, or insights.
                </p>
                <p className="text-xs text-violet-300/40 mt-2">
                  Data access restricted by role
                </p>
              </div>
            )}

            {messages.map((message, index) => {
              // If there's a current error and this is the last user message with no assistant response,
              // and we're in an error state, skip rendering it
              if (error && message.role === "user" && index === messages.length - 1) {
                const hasAssistantResponse = messages.some((m, i) => i > index && m.role === "assistant")
                if (!hasAssistantResponse) {
                  return null // Don't render failed user messages
                }
              }
              
              const text = formatMessageText(getMessageText(message))
              const isLastMessage = index === messages.length - 1
              const isAssistantMessage = message.role === "assistant"
              const showResolveButton = isLastMessage && isAssistantMessage && isAnomalyMode && pendingAnomaly && !resolving

              return (
                <div
                  key={message.id}
                  className={`flex ${
                    message.role === "user"
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >
                  <div className={`max-w-[85%] space-y-2`}>
                    <div
                      className={`px-4 py-3 rounded-xl text-sm font-medium ${
                        message.role === "user"
                          ? "bg-gradient-to-br from-violet-600 to-purple-600 text-white shadow-lg shadow-violet-500/20"
                          : "bg-slate-800/60 border border-slate-700/50 text-slate-200 backdrop-blur-sm"
                      }`}
                    >
                      {text}
                    </div>
                    
                    {showResolveButton && (
                      <Button
                        size="default"
                        className="w-full bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-bold shadow-lg shadow-emerald-500/30"
                        onClick={() => handleResolveAnomaly(pendingAnomaly.desk_id)}
                      >
                        <Zap className="w-4 h-4 mr-2" />
                        Resolve Anomaly
                      </Button>
                    )}

                    {currentAnomalyId === pendingAnomaly?.desk_id && resolving && (
                      <div className="space-y-2">
                        <div className="w-full bg-slate-800/80 rounded-full overflow-hidden h-4 shadow-lg border border-slate-600/40 relative">
                          {/* Animated glow behind the bar */}
                          <div 
                            className="absolute top-0 left-0 h-4 rounded-full blur-sm opacity-60"
                            style={{ 
                              width: `${progress}%`,
                              background: `linear-gradient(90deg, 
                                #3b82f6 0%, 
                                #06b6d4 ${Math.min(progress * 1.5, 100)}%, 
                                #10b981 ${Math.min(progress * 2, 100)}%, 
                                #34d399 100%)`,
                            }} 
                          />
                          {/* Main progress bar */}
                          <div 
                            className="h-4 transition-all duration-200 rounded-full relative overflow-hidden"
                            style={{ 
                              width: `${progress}%`,
                              background: `linear-gradient(90deg, 
                                #3b82f6, 
                                #6366f1 ${20}%, 
                                #8b5cf6 ${35}%, 
                                #06b6d4 ${50}%, 
                                #14b8a6 ${70}%, 
                                #10b981 ${85}%, 
                                #34d399 100%)`,
                            }} 
                          >
                            {/* Shimmer overlay */}
                            <div 
                              className="absolute inset-0 opacity-30"
                              style={{
                                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
                                backgroundSize: '200% 100%',
                                animation: 'shimmerSlide 1.5s linear infinite',
                              }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-slate-300 font-medium">
                            {progress < 25 ? 'Identifying affected instruments...' 
                              : progress < 50 ? 'Refreshing market data & FX rates...' 
                              : progress < 75 ? 'Recalculating valuations...' 
                              : progress < 100 ? 'Finalizing reconciliation...'
                              : 'Complete!'}
                          </p>
                          <span className="text-xs font-bold bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                            {Math.round(progress)}%
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-violet-950/30 border border-violet-700/30 px-4 py-2 rounded-lg flex gap-1">
                  <span className="animate-bounce text-violet-400">.</span>
                  <span className="animate-bounce delay-150 text-violet-400">.</span>
                  <span className="animate-bounce delay-300 text-violet-400">.</span>
                </div>
              </div>
            )}

            {comparisonData && <ComparisonChart data={comparisonData} />}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={handleSubmit} className="p-4 border-t border-violet-900/30 bg-gradient-to-t from-slate-950 to-slate-900/50 backdrop-blur-sm">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question..."
                disabled={isLoading}
                className="flex-1 bg-slate-800/60 border-slate-700/50 text-white placeholder-slate-500 focus-visible:ring-violet-500 focus-visible:border-violet-500"
              />
              <Button
                type="button"
                size="icon"
                onClick={toggleVoiceDictation}
                className={`transition-all ${
                  isListening 
                    ? "bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white shadow-lg shadow-red-500/30" 
                    : "bg-gradient-to-br from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-lg shadow-violet-500/30"
                }`}
                title={isListening ? "Stop listening" : "Start voice dictation"}
              >
                {isListening ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </Button>
              <Button
                type="submit"
                disabled={isLoading || !input.trim()}
                size="icon"
                className="bg-gradient-to-br from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-lg shadow-violet-500/30 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Anomaly Resolved Success Popup */}
      {showResolvedPopup && (
        <div 
          className="fixed inset-0 z-[70] flex items-center justify-center fade-in"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
          onClick={() => setShowResolvedPopup(false)}
        >
          <div 
            className="resolve-popup relative max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Particles */}
            <div className="rpt rp1" />
            <div className="rpt rp2" />
            <div className="rpt rp3" />
            <div className="rpt rp4" />
            <div className="rpt rp5" />
            <div className="rpt rp6" />

            <div className="relative bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border border-emerald-500/30 rounded-3xl shadow-2xl shadow-emerald-500/20 overflow-hidden">
              {/* Top glow */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 bg-gradient-to-b from-emerald-500/25 to-transparent rounded-full blur-3xl" />

              <div className="relative z-10 p-8 flex flex-col items-center text-center space-y-5">
                {/* Animated checkmark */}
                <div className="relative">
                  <div className="resolve-ring absolute inset-0 w-20 h-20 rounded-full border-2 border-emerald-400/40" />
                  <div className="w-20 h-20 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center shadow-xl shadow-emerald-500/40">
                    <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none">
                      <path
                        className="resolve-check"
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
                  <h2 className="resolve-shimmer text-xl font-bold tracking-tight">
                    Anomaly Cleared
                  </h2>
                  <p className="text-slate-400 text-xs leading-relaxed max-w-[240px]">
                    P&L variance reconciled successfully. Market data and FX rates have been refreshed.
                  </p>
                </div>

                {/* Status badges */}
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-full text-[10px] font-semibold text-emerald-400">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                    Reconciled
                  </span>
                  <span className="flex items-center gap-1 px-2.5 py-1 bg-blue-500/10 border border-blue-500/30 rounded-full text-[10px] font-semibold text-blue-400">
                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                    Refreshed
                  </span>
                </div>

                {/* Divider */}
                <div className="w-full h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent" />

                {/* Button */}
                <Button
                  className="w-full bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-bold shadow-lg shadow-emerald-500/25 rounded-xl py-4 text-xs tracking-wide"
                  onClick={() => setShowResolvedPopup(false)}
                >
                  Continue
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
