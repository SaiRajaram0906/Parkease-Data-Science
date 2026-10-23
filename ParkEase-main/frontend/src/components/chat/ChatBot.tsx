import { useState, useRef, useEffect } from "react";
import { MessageCircle, Send, X, Bot, MapPin, IndianRupee, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGoogleMaps } from "@/context/GoogleMapsContext";
import { Link } from "wouter";

interface Message {
  id: string;
  type: "user" | "bot";
  content: string | React.ReactNode;
  timestamp: Date;
}

export function ChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      type: "bot",
      content: "Hi! I'm your ParkEase AI. Ask me for parking near any location like 'Find parking near Tnagar'!",
      timestamp: new Date(),
    }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { isLoaded } = useGoogleMaps();

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      type: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    const currentInput = input;
    setInput("");
    setIsTyping(true);

    try {
      await processQuery(currentInput);
    } catch (error) {
      addBotMessage("Sorry, I encountered an error processing your request.");
    } finally {
      setIsTyping(false);
    }
  };

  const addBotMessage = (content: string | React.ReactNode) => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        type: "bot",
        content,
        timestamp: new Date(),
      },
    ]);
  };

  const processQuery = async (query: string) => {
    const q = query.toLowerCase();
    
    // Improved extraction logic
    let vehicleType: string | undefined = q.includes("bike") ? "bike" : q.includes("car") ? "car" : undefined;

    if (isInitialGreeting(q)) {
      addBotMessage("Hello! I'm your ParkEase assistant. How can I help you find parking today?");
      return;
    }

    // Check for queries asking for the user's current location
    const isGeneralParkingQuery = /\b(near me|nearest|nearby|close by|around|around me|my location|current location|to me|close|closest)\b/i.test(q);

    if (isGeneralParkingQuery) {
      // Use browser geolocation to find nearby spots
      addBotMessage("Let me find parking near your current location...");
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
        });
        const latVal = pos.coords.latitude;
        const lngVal = pos.coords.longitude;
        await fetchAndShowSpots(latVal, lngVal, vehicleType, "your current location");
      } catch {
        addBotMessage("I couldn't access your location. Please allow location access in your browser or try saying 'Find parking near T-Nagar' with a specific area name.");
      }
      return;
    }
    
    // Look for specific location with keywords, using word boundaries \b
    let locationMatch = q.match(/\b(near|at|in|to)\b\s+([a-zA-Z0-9\s,.-]+?)(?:\s+for|\s+with|\?|$)/i);
    let locationName = "";

    if (locationMatch) {
      locationName = locationMatch[2].trim();
    } else {
      // Greedy fallback: remove common verbs and filler words to guess the location
      locationName = q.replace(/\b(find|search|show|me|parking|for|my|the|a|an|location|spot|spots|give|some|reply|what|happen|now|tell|that|are|to|is|there|any|can|you|where|we)\b/gi, "").trim();
    }

    if (!locationName) {
      addBotMessage("I can help you find parking! Try saying:\n• 'Find parking near T-Nagar'\n• 'Show me nearest parking' (uses your location)\n• 'Bike parking near Anna Nagar'");
      return;
    }
    
    if (!isLoaded) {
      addBotMessage("Searching... Give me a second to wake up my map senses!");
      return;
    }

    try {
      const geocoder = new window.google.maps.Geocoder();
      
      const performGeocode = (addressStr: string, useRestrictions: boolean) => {
        return new Promise<google.maps.GeocoderResult[]>((resolve, reject) => {
          const options: google.maps.GeocoderRequest = { address: addressStr };
          if (useRestrictions) options.componentRestrictions = { country: 'IN' };
          
          geocoder.geocode(options, (res, status) => {
            if (status === 'OK' && res) resolve(res);
            else reject(status);
          });
        });
      };

      const getResults = async (str: string) => {
        try { return await performGeocode(str, true); } catch {
          try { return await performGeocode(str, false); } catch { return null; }
        }
      };

      let results = await getResults(locationName);
      
      // If full string fails, try progressive stripping
      if (!results) {
        const stripped = locationName.replace(/^(no|door|flat|g\d+|[0-9/-]+)\s+/gi, "").trim();
        if (stripped && stripped !== locationName) {
          results = await getResults(stripped);
        }
      }
      
      if (!results) {
        const parts = locationName.split(/\s+/);
        if (parts.length > 3) {
          const areaOnly = parts.slice(-4).join(" ");
          results = await getResults(areaOnly);
        }
      }

      if (results && results[0]) {
        const { lat, lng } = results[0].geometry.location;
        const latVal = lat();
        const lngVal = lng();
        
        addBotMessage(`Searching for ${vehicleType || "parking"} spots near ${results[0].formatted_address}...`);
        await fetchAndShowSpots(latVal, lngVal, vehicleType, locationName);
      } else {
        addBotMessage(`I couldn't find the location "${locationName}". Could you be more specific? For example: 'Parking near T-Nagar, Chennai'`);
      }
    } catch (error) {
      addBotMessage("I couldn't find that exact location. Could you try being more specific? For example: 'Find parking near T-Nagar, Chennai'");
    }
  };

  const fetchAndShowSpots = async (latVal: number, lngVal: number, vehicleType: string | undefined, locationLabel: string) => {
    try {
      // Try fetching from the API with nearby search first
      const apiBase = window.location.port === '5173' ? '' : 'http://localhost:5000';
      let response = await fetch(`${apiBase}/api/spots?lat=${latVal}&lng=${lngVal}${vehicleType ? `&vehicleType=${vehicleType}` : ""}`);
      let spots = await response.json();

      // If no spots found within 500m, fetch ALL spots as fallback
      if (!spots || spots.length === 0) {
        response = await fetch(`${apiBase}/api/spots${vehicleType ? `?vehicleType=${vehicleType}` : ""}`);
        spots = await response.json();
      }

      if (spots && spots.length > 0) {
        addBotMessage(
          <div className="space-y-3 mt-2">
            <p>I found these parking spots for you:</p>
            {spots.slice(0, 3).map((spot: any) => (
              <Card key={spot.id} className="overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
                <div className="flex gap-3 p-2">
                  <img src={spot.imageUrl || "/spot-placeholder.jpg"} className="w-16 h-16 object-cover rounded" alt={spot.name} />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm truncate">{spot.name}</h4>
                    <div className="flex items-center text-xs text-muted-foreground mt-1 gap-2">
                      <span className="flex items-center"><IndianRupee className="h-3 w-3 mr-0.5" />{spot.pricePerHour}/hr</span>
                      <span className="capitalize">{spot.vehicleType}</span>
                    </div>
                    <Link href={`/spots/${spot.id}`}>
                      <Button variant="link" size="sm" className="h-6 p-0 text-xs mt-1" onClick={() => setIsOpen(false)}>
                        View & Book <ExternalLink className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </Card>
            ))}
            <Link href={`/spots?lat=${latVal}&lng=${lngVal}&search=${encodeURIComponent(locationLabel)}`}>
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setIsOpen(false)}>
                See all on Map
              </Button>
            </Link>
          </div>
        );
      } else {
        addBotMessage("No parking spots are currently available. Check back later or try a different area!");
      }
    } catch (error) {
      addBotMessage("I had trouble connecting to the server. Please make sure the app is running and try again.");
    }
  };

  const isInitialGreeting = (q: string) => {
    return q === "hi" || q === "hello" || q === "hey" || q === "help";
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {isOpen && (
        <Card className="w-[350px] sm:w-[400px] h-[500px] mb-4 flex flex-col shadow-2xl border-2 animate-in slide-in-from-bottom-4 duration-300">
          <div className="p-4 bg-primary text-primary-foreground rounded-t-lg flex justify-between items-center shadow-md">
            <div className="flex items-center gap-2">
              <div className="bg-primary-foreground/20 p-1.5 rounded-full">
                <Bot className="h-5 w-5" />
              </div>
              <span className="font-bold tracking-tight">AI Parking Assistant</span>
            </div>
            <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-primary-foreground/20 -mr-2" onClick={() => setIsOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.type === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] p-3 rounded-2xl text-sm shadow-sm ${
                    m.type === "user" 
                      ? "bg-primary text-primary-foreground rounded-br-none" 
                      : "bg-muted text-foreground rounded-bl-none border"
                  }`}>
                    {m.content}
                    <div className={`text-[10px] mt-1 opacity-60 ${m.type === "user" ? "text-right" : "text-left"}`}>
                      {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-muted p-3 rounded-2xl rounded-bl-none border">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="p-3 border-t bg-muted/30">
            <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2">
              <Input 
                placeholder="Ask for parking..." 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="bg-background shadow-inner"
              />
              <Button type="submit" size="icon" className="shrink-0 shadow-md">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </Card>
      )}

      <Button 
        size="lg" 
        className={`rounded-full h-14 w-14 shadow-2xl transition-all duration-300 hover:scale-110 ${isOpen ? "rotate-90 opacity-0 pointer-events-none" : ""}`}
        onClick={() => setIsOpen(true)}
      >
        <MessageCircle className="h-6 w-6" />
      </Button>
    </div>
  );
}
