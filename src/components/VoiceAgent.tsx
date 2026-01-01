import { useState, useRef, useEffect } from "react";
import DailyIframe from "@daily-co/daily-js";
import { Mic, MicOff, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TranscriptMessage {
  id: string;
  speaker: "user" | "ai";
  text: string;
  timestamp: Date;
}

export default function VoiceAgent() {
  const [isOpen, setIsOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [callFrame, setCallFrame] = useState<any>(null);
  const [timer, setTimer] = useState(0);
  const [inputText, setInputText] = useState("");
  const { toast } = useToast();
  const connectLockRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Auto-connect when opening
  useEffect(() => {
    if (isOpen && !isConnected && !isConnecting) {
      startConversation();
    }
  }, [isOpen]);

  // Timer logic
  useEffect(() => {
    if (isConnected) {
      timerRef.current = setInterval(() => {
        setTimer((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setTimer(0);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isConnected]);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const addToTranscript = (speaker: "user" | "ai", text: string) => {
    setTranscript((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(7),
        speaker,
        text,
        timestamp: new Date(),
      },
    ]);
  };

  const startConversation = async () => {
    if (connectLockRef.current || isConnecting || isConnected) return;

    connectLockRef.current = true;
    setIsConnecting(true);

    try {
      /*
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setIsConnected(true);
      setIsConnecting(false);
      connectLockRef.current = false;
      // toast({ title: "Connected", description: "Farm Vaidya is listening (Test Mode)" });
      
      // Simulate bot greeting
      addToTranscript("ai", "Namaste! I am Farm Vaidya. How can I help you with your crops today?");
      */

      const endpoint = import.meta.env.VITE_PIPECAT_ENDPOINT || "https://api.pipecat.daily.co/v1/public/webagent/start";
      const apiKey = import.meta.env.VITE_PIPECAT_TOKEN;
      console.log("Connecting to Pipecat endpoint:", endpoint);
      console.log("API Key provided:", !!apiKey);
      
      if (!apiKey) {
        throw new Error("VITE_PIPECAT_TOKEN is not configured in .env file");
      }

      // Ensure the Authorization header uses a Bearer token. If the token
      // already includes the Bearer prefix, leave it as-is.
      const authHeader = apiKey.match(/^Bearer\s+/i) ? apiKey : `Bearer ${apiKey}`;

      // Start API request immediately
      const fetchPromise = fetch(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": authHeader,
          },
          body: JSON.stringify({
            createDailyRoom: true,
            dailyRoomProperties: {
              enable_recording: "cloud",
              privacy: "public",
            },
            dailyMeetingTokenProperties: {
              is_owner: true,
            },
          }),
        }
      ).then(async (res) => {
        if (!res.ok) {
           const errorText = await res.text();
           console.error("API Error Response:", errorText);
           throw new Error(`API request failed: ${res.status} ${res.statusText} - ${errorText}`);
        }
        return res.json();
      });

      // Cleanup existing frame while API is fetching
      if (callFrame) {
        await callFrame.leave().catch(console.error);
        await callFrame.destroy().catch(console.error);
        setCallFrame(null);
      }

      // Initialize new frame while API is fetching
      const frame = DailyIframe.createFrame({
        showLeaveButton: false,
        showFullscreenButton: false,
        iframeStyle: {
          position: "fixed",
          width: "1px",
          height: "1px",
          opacity: "0",
          pointerEvents: "none",
        },
      });

      // Setup listeners immediately
      frame
        .on("joined-meeting", () => {
          setIsConnected(true);
          setIsConnecting(false);
          connectLockRef.current = false;
        })
        .on("left-meeting", () => {
          setIsConnected(false);
          connectLockRef.current = false;
        })
        .on("error", () => {
          setIsConnecting(false);
          connectLockRef.current = false;
          toast({ title: "Error", description: "Connection failed", variant: "destructive" });
        })
        .on("participant-joined", (e: any) => {
          if (e.participant.user_name === "Chatbot") {
             addToTranscript("ai", "I am Farm Vaidya AI");
          }
        })
        .on("active-speaker-change", (e: any) => {
          const localParticipant = frame.participants().local;
          if (e.activeSpeaker && e.activeSpeaker.peerId === localParticipant.user_id) {
            // User is speaking
          } else if (e.activeSpeaker) {
            // AI is speaking
          } else {
            // No one is speaking
          }
        });

      // Wait for API data
      const data = await fetchPromise;
      const roomUrl = data.dailyRoom || data.room_url || data.roomUrl;
      const roomToken = data.dailyToken || data.token;

      if (!roomUrl || !roomToken) {
        console.error("API Response:", data);
        throw new Error("Missing room URL or token from API response");
      }

      // Join room with optimized settings
      await frame.join({ 
          url: roomUrl, 
          token: roomToken,
          subscribeToTracksAutomatically: true
      });
      setCallFrame(frame);

    } catch (error: any) {
      console.error(error);
      setIsConnecting(false);
      connectLockRef.current = false;
      toast({ title: "Error", description: error.message || "Could not start conversation", variant: "destructive" });
    }
  };

  const endConversation = async () => {
    if (callFrame) {
      await callFrame.leave();
    }
    setIsConnected(false);
    setIsOpen(false);
  };

  const toggleMute = () => {
    const newMuteState = !isMuted;
    if (callFrame) {
      callFrame.setLocalAudio(!newMuteState);
    }
    setIsMuted(newMuteState);
  };

  // @ts-ignore - Used for future text input functionality
  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    addToTranscript("user", inputText);
    setInputText("");
    // Here you would typically send the text to the AI if supported by the backend
    
    // Simulate AI response for testing
    setTimeout(() => {
        addToTranscript("ai", "I am a mock bot response. The API is bypassed for testing.");
    }, 1000);
  };

  const GoogleLogo = () => (
    <svg viewBox="0 0 24 24" className="h-full w-full p-1">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );

  const GoogleDots = () => (
    <div className="flex items-center justify-center gap-1 h-full w-full bg-white">
      <div className="w-1.5 h-1.5 rounded-full bg-[#4285F4] animate-google-dot" style={{ animationDelay: "0s" }} />
      <div className="w-1.5 h-1.5 rounded-full bg-[#EA4335] animate-google-dot" style={{ animationDelay: "0.2s" }} />
      <div className="w-1.5 h-1.5 rounded-full bg-[#FBBC05] animate-google-dot" style={{ animationDelay: "0.4s" }} />
      <div className="w-1.5 h-1.5 rounded-full bg-[#34A853] animate-google-dot" style={{ animationDelay: "0.6s" }} />
    </div>
  );

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col items-start gap-4">
      {/* Active Call Pill UI */}
      {isOpen && (
        <div className="w-fit p-[2px] rounded-full bg-black border-2 border-blue-500 shadow-2xl animate-in slide-in-from-bottom-10 fade-in duration-300">
            <div className="flex items-center justify-between rounded-full bg-white px-2.5 py-1.5 gap-2">
                {/* Avatar Section */}
                <div className="relative">
                    {/* Spinning Ring - Blue Colors */}
                    <div className="absolute -inset-1 rounded-full border-[2px] border-transparent border-t-blue-500 border-r-blue-500/20 border-b-blue-500/10 border-l-blue-500 animate-ring-rotate"></div>
                    
                    {/* Avatar Container */}
                    <div className="relative h-8 w-8 rounded-full overflow-hidden bg-white flex items-center justify-center">
                        <GoogleDots />
                    </div>
                </div>

                {/* Status Text */}
                <div className="flex flex-col items-start leading-none shrink min-w-0">
                    <span className="text-black font-bold text-[13px] whitespace-nowrap">
                        {isConnecting ? "Connecting..." : "Connected"}
                    </span>
                    <span className="text-gray-500 font-mono text-[10px] font-medium whitespace-nowrap mt-0.5">
                        {isConnecting ? "00:00:00" : formatTime(timer)}
                    </span>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-7 w-7 rounded-full transition-all duration-300",
                            isMuted 
                            ? "bg-red-100 text-red-500 hover:bg-red-200" 
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        )}
                        onClick={toggleMute}
                    >
                        {isMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                    </Button>
                    
                    <Button
                        variant="destructive"
                        size="icon"
                        className="h-7 w-7 rounded-full shadow-md hover:scale-105 transition-transform bg-red-500 hover:bg-red-600"
                        onClick={endConversation}
                    >
                        <Phone className="h-3.5 w-3.5 rotate-135" />
                    </Button>
                </div>
            </div>
        </div>
      )}

      {/* Floating Toggle Button */}
      {!isOpen && (
        <div
            onClick={() => {
                setIsOpen(true);
                startConversation();
            }}
            className="w-fit cursor-pointer group relative p-[2px] rounded-full bg-black border-2 border-blue-500 shadow-2xl transition-all duration-300 hover:scale-105 animate-bounce-subtle"
        >
            <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-full bg-white h-full w-full">
                <div className="relative">
                    {/* Avatar Container */}
                    <div className="h-8 w-8 rounded-full overflow-hidden bg-white flex items-center justify-center">
                        <GoogleLogo />
                    </div>
                </div>
                <div className="flex flex-col items-start leading-none gap-0.5">
                    <span className="text-black font-bold text-[13px] block">
                        Talk to TechSprint
                    </span>
                    <span className="text-black font-bold text-[13px] block ml-1">
                        Hackathon 2026
                    </span>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
