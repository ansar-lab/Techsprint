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

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col items-start gap-4">
      {/* Active Call Pill UI */}
      {isOpen && (
        <div className="p-[4px] rounded-full bg-primary shadow-2xl animate-in slide-in-from-bottom-10 fade-in duration-300">
            <div className="flex items-center rounded-full bg-white px-4 py-2 gap-3">
                {/* Avatar Section */}
                <div className="relative">
                    {/* Spinning Ring - Gradient Colors */}
                    <div className="absolute -inset-1.5 rounded-full border-[3px] border-transparent border-t-brown border-r-brown/20 border-b-brown/10 border-l-brown animate-ring-rotate"></div>
                    
                    {/* Avatar Container */}
                    <div className="relative h-11 w-11 rounded-full overflow-hidden bg-white">
                        <img 
                            src="/Farm-vaidya-icon.png" 
                            alt="Farm Vaidya" 
                            className="h-full w-full object-cover"
                        />
                    </div>
                </div>

                {/* Status Text */}
                <div className="flex flex-col text-primary">
                    <span className="font-semibold text-sm leading-tight">
                        {isConnecting ? "Connecting..." : "Connected"}
                    </span>
                    <span className="text-xs font-mono text-gray-700 font-semibold">
                        {isConnecting ? "00:00:00" : formatTime(timer)}
                    </span>
                </div>

                {/* Controls */}
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        "h-10 w-10 rounded-full transition-all duration-300",
                        isMuted 
                        ? "bg-red-100 text-red-500 hover:bg-red-200" 
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    )}
                    onClick={toggleMute}
                >
                    {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </Button>
                
                <Button
                    variant="destructive"
                    size="icon"
                    className="h-10 w-10 rounded-full shadow-md hover:scale-105 transition-transform bg-red-500 hover:bg-red-600"
                    onClick={endConversation}
                >
                    <Phone className="h-5 w-5 rotate-135" />
                </Button>
            </div>
        </div>
      )}

      {/* Floating Toggle Button */}
      {!isOpen && (
        <div
            onClick={() => setIsOpen(true)}
            className="cursor-pointer group relative p-[4px] rounded-full bg-primary shadow-2xl transition-all duration-300 hover:scale-105 animate-bounce-subtle"
        >
            <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-white h-full w-full">
                <div className="relative">
                    {/* Avatar Container */}
                    <div className="h-11 w-11 rounded-full overflow-hidden bg-white">
                        <img 
                            src="/Farm-vaidya-icon.png" 
                            alt="Farm Vaidya" 
                            className="h-full w-full object-cover"
                        />
                    </div>
                    
                    <span className="absolute top-0 right-0 flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brown opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-brown border-2 border-white"></span>
                    </span>
                </div>
                <span className="text-primary font-bold text-lg whitespace-nowrap">
                    Talk to Farm Vaidya
                </span>
            </div>
        </div>
      )}
    </div>
  );
}
