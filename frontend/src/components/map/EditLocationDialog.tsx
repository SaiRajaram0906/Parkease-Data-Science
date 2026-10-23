import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSpotQueryKey, useUpdateSpot } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { LocationPicker, type PickedLocation } from "@/components/map/LocationPicker";
import { validCoordinates } from "@/lib/places";

interface SpotLocation {
  id: number;
  address: string;
  city: string;
  state: string;
  latitude?: string | null;
  longitude?: string | null;
}

/**
 * Lets the owner move the map pin of an existing listing. Listings made
 * before the pin had to be chosen can point at the wrong place; this is how
 * to correct them so "Get Directions" leads to the right spot.
 */
export function EditLocationDialog({ spot, open, onClose }: { spot: SpotLocation; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateSpot = useUpdateSpot();
  const [pin, setPin] = useState(() => validCoordinates(spot.latitude, spot.longitude));
  const [address, setAddress] = useState(spot.address);
  const [city, setCity] = useState(spot.city);
  const [state, setState] = useState(spot.state);
  const [addressEdited, setAddressEdited] = useState(false);

  const onPinChange = (location: PickedLocation) => {
    setPin({ lat: location.lat, lng: location.lng });
    if (location.city) setCity(location.city);
    if (location.state) setState(location.state);
    if (location.address && !addressEdited) setAddress(location.address);
  };

  const save = () => {
    if (!pin) return;
    updateSpot.mutate(
      {
        id: spot.id,
        // latitude/longitude are accepted by the server but missing from the generated type.
        data: { latitude: pin.lat.toFixed(7), longitude: pin.lng.toFixed(7), address: address.trim(), city: city.trim(), state: state.trim() } as any,
      },
      {
        onSuccess: () => {
          toast({ title: "Location updated", description: "Directions now lead to the new pin." });
          queryClient.invalidateQueries({ queryKey: getGetSpotQueryKey(spot.id) });
          onClose();
        },
        onError: () => toast({ title: "Error", description: "Could not update the location.", variant: "destructive" }),
      },
    );
  };

  const complete = !!pin && address.trim().length >= 10 && !!city.trim() && !!state.trim();

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit location</DialogTitle>
          <DialogDescription>
            Put the pin on the exact entrance. Drivers are given directions to this pin.
          </DialogDescription>
        </DialogHeader>

        <LocationPicker value={pin} onChange={onPinChange} height={300} />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="edit-lat">Latitude</Label>
            <Input id="edit-lat" className="mt-1.5 bg-muted" readOnly value={pin ? pin.lat.toFixed(7) : ""} placeholder="Filled from the pin" />
          </div>
          <div>
            <Label htmlFor="edit-lng">Longitude</Label>
            <Input id="edit-lng" className="mt-1.5 bg-muted" readOnly value={pin ? pin.lng.toFixed(7) : ""} placeholder="Filled from the pin" />
          </div>
          <div>
            <Label htmlFor="edit-city">City</Label>
            <Input id="edit-city" className="mt-1.5" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="edit-state">State</Label>
            <Input id="edit-state" className="mt-1.5" value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="edit-address">Full address</Label>
            <Textarea
              id="edit-address"
              className="mt-1.5 resize-none"
              value={address}
              onChange={(e) => { setAddress(e.target.value); setAddressEdited(true); }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!complete || updateSpot.isPending}>
            {updateSpot.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save location
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
