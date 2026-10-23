import { useState, useRef, useEffect } from "react";
import { MessageCircle, Send, X, Bot, MapPin, IndianRupee, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGoogleMaps } from "@/context/GoogleMapsContext";
import { Link } from "wouter";
import { assistantSearch, type AssistantResult } from "@/lib/app-api";
import { ApiRequestError } from "@/lib/auth-api";

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
      content: "Hi! I'm your ParkEase assistant. Ask me for parking near any place, like 'spot near Rajalakshmi Engineering College' or 'parking in T Nagar'.",
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

  /**
   * Works out what the driver asked for and answers with the spots closest
   * to that place.
   *
   *   "spot near Rajalakshmi engineering college"  -> spots around the college
   *   "bike parking in Anna Nagar"                 -> bike spots around Anna Nagar
   *   "parking near me" / "nearest parking"        -> spots around the driver
   *
   * The place is looked up with Google Maps when it is available, and
   * otherwise by the server (well-known Chennai places and listing names).
   * The spots always come back nearest first with their distance from the
   * place, so a question about one area is never answered with another.
   */
  const processQuery = async (query: string) => {
    const q = query.toLowerCase().replace(/[?!]+$/g, "").trim();
    const vehicleType = /\b(bike|bikes|two[- ]?wheeler|scooter|motorcycle)\b/.test(q)
      ? "bike"
      : /\b(car|cars|four[- ]?wheeler)\b/.test(q)
        ? "car"
        : undefined;

    if (isInitialGreeting(q)) {
      addBotMessage("Hello! Tell me a place and I'll find parking near it. For example: 'spot near Rajalakshmi Engineering College' or 'bike parking in T Nagar'.");
      return;
    }

    const place = extractPlace(q);

    if (place === "me") {
      addBotMessage("Let me find parking near your current location...");
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
        });
        await showSpotsNear({ q: "your location", lat: pos.coords.latitude, lng: pos.coords.longitude, label: "your current location", vehicleType });
      } catch {
        addBotMessage("I couldn't access your location. Please allow location access in your browser, or name a place: 'parking near T Nagar'.");
      }
      return;
    }

    if (!place) {
      addBotMessage("I can help you find parking! Try saying:\n• 'Spot near Rajalakshmi Engineering College'\n• 'Bike parking in Anna Nagar'\n• 'Nearest parking' (uses your location)");
      return;
    }

    // 1. Google Maps knows almost every place name and address.
    const found = await geocodePlace(place);
    if (found) {
      await showSpotsNear({ q: place, lat: found.lat, lng: found.lng, label: found.label, vehicleType });
      return;
    }
    // 2. Otherwise the server looks the name up itself.
    await showSpotsNear({ q: place, vehicleType });
  };

  /** The place named in the question, "me" for the driver's own position, or "" if none. */
  const extractPlace = (q: string): string => {
    const tidy = (text: string) =>
      text
        .replace(/\b(for|with)\s+(my|a|the)?\s*(bike|bikes|car|cars|two[- ]?wheeler|four[- ]?wheeler|scooter|motorcycle)\b.*$/i, "")
        .replace(/\b(please|pls|now|today|tonight|tomorrow)\b/gi, "")
        .replace(/[.,;:]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const isMe = (text: string) => /^(me|my location|my place|here|my current location|current location|by|me now)?$/.test(text);

    // "... near X", "... close to X", "... in X", "... at X", "... around X"
    const keyword = q.match(/\b(?:near to|nearest to|closest to|close to|next to|near|around|beside|opposite|outside|at|in)\s+(.+)$/i);
    if (keyword) {
      const rest = tidy(keyword[1]!);
      return isMe(rest) ? "me" : rest;
    }
    if (/\b(near me|nearest|nearby|closest|close by|around me|my location|current location)\b/.test(q)) return "me";

    // No keyword: drop the filler words and treat what is left as the place.
    const rest = tidy(
      q.replace(/\b(find|search|show|get|give|book|need|want|looking|look|me|i|a|an|the|some|any|is|are|there|can|you|where|parking|park|spot|spots|slot|slots|place|places|space|spaces|available|free|bike|bikes|car|cars|for|my|to)\b/gi, " "),
    );
    return rest.length >= 3 ? rest : "";
  };

  /** Coordinates of a place name from Google Maps, or null if it is unavailable or unknown. */
  const geocodePlace = async (name: string): Promise<{ lat: number; lng: number; label: string } | null> => {
    if (!isLoaded || !window.google?.maps?.Geocoder) return null;
    const geocoder = new window.google.maps.Geocoder();
    const attempt = (address: string, india: boolean) =>
      new Promise<google.maps.GeocoderResult | null>((resolve) => {
        const request: google.maps.GeocoderRequest = { address };
        if (india) request.componentRestrictions = { country: "IN" };
        geocoder.geocode(request, (results, status) => resolve(status === "OK" && results?.[0] ? results[0] : null));
      });
    try {
      const result = (await attempt(name, true)) ?? (await attempt(`${name}, Tamil Nadu`, true)) ?? (await attempt(name, false));
      if (!result) return null;
      // "India" alone means Google did not recognise the name at all.
      if (result.types?.includes("country")) return null;
      return { lat: result.geometry.location.lat(), lng: result.geometry.location.lng(), label: result.formatted_address || name };
    } catch {
      return null;
    }
  };

  const formatDistance = (km: number) => (km < 1 ? `${Math.max(10, Math.round(km * 100) * 10)} m` : `${km.toFixed(1)} km`);

  const showSpotsNear = async (params: { q: string; lat?: number; lng?: number; label?: string; vehicleType?: string }) => {
    let result: AssistantResult;
    try {
      result = await assistantSearch(params);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        addBotMessage(`I couldn't find a place called "${params.q}". Could you be more specific? For example: 'parking near T Nagar, Chennai'.`);
      } else {
        addBotMessage("I had trouble connecting to the server. Please make sure the app is running and try again.");
      }
      return;
    }

    const { place, spots, nearbyCount, nearbyKm } = result;
    const kind = params.vehicleType ? `${params.vehicleType} parking` : "parking";
    if (spots.length === 0) {
      addBotMessage(`There are no ${kind} spots listed on ParkEase yet.`);
      return;
    }

    const nothingClose = nearbyCount === 0;
    const shown = spots.slice(0, nothingClose ? 3 : 4);
    addBotMessage(
      <div className="space-y-3 mt-1">
        <p>
          {nothingClose ? (
            <>No {kind} is listed within {nearbyKm} km of <strong>{place.name}</strong> yet. The closest spots are:</>
          ) : (
            <>{nearbyCount} {kind} spot{nearbyCount === 1 ? "" : "s"} within {nearbyKm} km of <strong>{place.name}</strong>. Nearest first:</>
          )}
        </p>
        {shown.map((spot) => (
          <Card key={spot.id} className="overflow-hidden border shadow-sm hover:shadow-md transition-shadow">
            <div className="flex gap-3 p-2">
              <img src={spot.imageUrl || "/spot-placeholder.jpg"} className="w-16 h-16 object-cover rounded" alt="" />
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-sm truncate">{spot.name}</h4>
                <div className="flex flex-wrap items-center text-xs text-muted-foreground mt-1 gap-x-2">
                  <span className="flex items-center font-semibold text-foreground"><MapPin className="h-3 w-3 mr-0.5" />{formatDistance(spot.distanceKm)} away</span>
                  <span className="flex items-center"><IndianRupee className="h-3 w-3 mr-0.5" />{spot.pricePerHour}/hr</span>
                  <span>{spot.availableSlots > 0 ? `${spot.availableSlots} free` : "Full"}</span>
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
        {spots[0]!.distanceKm <= 0.5 && (
          <Link href={`/spots?lat=${place.lat}&lng=${place.lng}&search=${encodeURIComponent(params.q)}`}>
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setIsOpen(false)}>
              See all on Map
            </Button>
          </Link>
        )}
      </div>
    );
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
                  <div className={`max-w-[85%] p-3 rounded-2xl text-sm shadow-sm whitespace-pre-line ${
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
                placeholder="Ask for parking near a place..."
                aria-label="Message to the parking assistant" 
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
        <span className="sr-only">Open the parking assistant</span>
      </Button>
    </div>
  );
}
