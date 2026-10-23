import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateSpot } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { Label } from "@/components/ui/label";
import { MapPin, IndianRupee, Info, Loader2, QrCode } from "lucide-react";
import { LocationPicker, type PickedLocation } from "@/components/map/LocationPicker";
import { nearestCity, validCoordinates } from "@/lib/places";


const spotSchema = z.object({
  name: z.string().min(5, "Name must be at least 5 characters"),
  address: z.string().min(10, "Address must be at least 10 characters"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  pricePerHour: z.string().min(1, "Hourly price is required"),
  pricePerDay: z.string().optional(),
  vehicleType: z.string().min(1, "Select vehicle type"),
  totalSlots: z.string().min(1, "Total slots required"),
  description: z.string().optional(),
  amenities: z.array(z.string()).optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  isLargeFacility: z.boolean().optional(),
}).refine((v) => validCoordinates(v.latitude, v.longitude) !== null, {
  // Without a pin, drivers cannot be given directions to the spot.
  path: ["latitude"],
  message: "Place the pin on the map (search, click the map or use your location).",
});

export default function ListSpot() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createSpot = useCreateSpot();
  const { user } = useAuth();
  // True while the address box still holds the address filled in from the pin.
  const [addressFromPin, setAddressFromPin] = useState(true);

  const form = useForm<z.infer<typeof spotSchema>>({
    resolver: zodResolver(spotSchema),
    defaultValues: {
      name: "",
      address: "",
      city: "",
      state: "",
      pricePerHour: "",
      pricePerDay: "",
      vehicleType: "both",
      totalSlots: "1",
      description: "",
      amenities: [],
      latitude: "",
      longitude: "",
      isLargeFacility: false,
    },
  });

  const latitude = form.watch("latitude");
  const longitude = form.watch("longitude");
  const pin = validCoordinates(latitude, longitude);

  /** The pin moved: fill latitude, longitude, city and state (and the address, unless the owner typed one). */
  const onPinChange = (location: PickedLocation) => {
    const options = { shouldValidate: true, shouldDirty: true };
    // The two coordinates are checked as a pair, so set both before clearing
    // the "place the pin" message.
    form.setValue("latitude", location.lat.toFixed(7), { shouldDirty: true });
    form.setValue("longitude", location.lng.toFixed(7), { shouldDirty: true });
    form.clearErrors(["latitude", "longitude"]);
    if (location.city) form.setValue("city", location.city, options);
    if (location.state) form.setValue("state", location.state, options);
    if (location.address && (addressFromPin || !form.getValues("address").trim())) {
      form.setValue("address", location.address, options);
      setAddressFromPin(true);
    }
  };

  /** Latitude or longitude typed by hand: fill the city and state if they are still empty. */
  const onCoordinatesTyped = () => {
    const at = validCoordinates(form.getValues("latitude"), form.getValues("longitude"));
    const near = at ? nearestCity(at.lat, at.lng) : null;
    if (!near) return;
    if (!form.getValues("city").trim() && near.city) form.setValue("city", near.city, { shouldValidate: true });
    if (!form.getValues("state").trim() && near.state) form.setValue("state", near.state, { shouldValidate: true });
  };

  const amenitiesList = [
    { id: "covered", label: "Covered Parking" },
    { id: "cctv", label: "CCTV Surveillance" },
    { id: "security", label: "Security Guard" },
    { id: "ev", label: "EV Charging" },
    { id: "24x7", label: "24/7 Access" },
  ];

  const onSubmit = (values: z.infer<typeof spotSchema>) => {
    createSpot.mutate({
      data: {
        ...values,
        // An empty optional field must be sent as "no value", not as "".
        pricePerDay: values.pricePerDay || null,
        latitude: values.latitude || null,
        longitude: values.longitude || null,
        totalSlots: parseInt(values.totalSlots, 10),
        amenities: values.amenities?.join(",") || "",
        // The logged-in user owns the new spot (this used to be hardcoded to user 1).
        ownerId: user?.id ?? null,
        isLargeFacility: values.isLargeFacility === true,
      } as any
    }, {
      onSuccess: (data) => {
        toast({ title: "Success!", description: "Your parking spot has been listed." });
        setLocation(`/spots/${data.id}`);
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error?.data?.error || "Failed to list spot. Please try again.",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="mb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">List Your Parking Spot</h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto">
          Turn your unused driveway, garage, or commercial space into passive income. Join India's largest parking network.
        </p>
      </div>

      <Card className="border-2 shadow-xl">
        <CardHeader className="bg-muted/30 border-b pb-8">
          <CardTitle className="flex items-center text-2xl">
            <Info className="mr-2 h-6 w-6 text-primary" />
            Spot Details
          </CardTitle>
          <CardDescription className="text-base">Provide accurate information to attract more drivers.</CardDescription>
        </CardHeader>
        <CardContent className="pt-8">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              
              {/* Basic Info */}
              <div className="space-y-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">Spot Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Secure Basement Parking near Metro" className="h-12 text-base" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="vehicleType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base">Allowed Vehicles</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-12 text-base">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="car">Car Only</SelectItem>
                            <SelectItem value="bike">Bike Only</SelectItem>
                            <SelectItem value="both">Both Car & Bike</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="totalSlots"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base">Number of Slots</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" className="h-12 text-base" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <FormField
                control={form.control}
                name="isLargeFacility"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-xl border p-4">
                    <FormControl>
                      <Checkbox checked={field.value === true} onCheckedChange={(checked) => field.onChange(checked === true)} />
                    </FormControl>
                    <div className="space-y-1">
                      <FormLabel className="flex cursor-pointer items-center text-base font-medium">
                        <QrCode className="mr-2 h-4 w-4 text-primary" /> Large parking facility (QR entry check)
                      </FormLabel>
                      <FormDescription>
                        For store, mall and public car parks with many slots. Each booking keeps a numbered slot and
                        gets a QR code that your staff check at the entrance (Verify Entry in the menu).
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />

              {/* Location */}
              <div className="space-y-6 p-6 bg-muted/20 rounded-xl border">
                <h3 className="text-lg font-semibold flex items-center mb-4">
                  <MapPin className="mr-2 h-5 w-5 text-primary" /> Location
                </h3>

                <div>
                  <Label className="text-base mb-2 block">Pin Location on Map</Label>
                  <LocationPicker value={pin} onChange={onPinChange} />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="latitude"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Latitude</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="Filled from the pin" className="h-12" {...field} onBlur={() => { field.onBlur(); onCoordinatesTyped(); }} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="longitude"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Longitude</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="Filled from the pin" className="h-12" {...field} onBlur={() => { field.onBlur(); onCoordinatesTyped(); }} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input placeholder="Filled from the pin" className="h-12" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl>
                          <Input placeholder="Filled from the pin" className="h-12" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Address</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Street address, building name, landmark..."
                          className="resize-none"
                          {...field}
                          onChange={(e) => { field.onChange(e); setAddressFromPin(false); }}
                        />
                      </FormControl>
                      <FormDescription>Filled in from the pin. Edit it to add the door number or a landmark.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Pricing */}
              <div className="space-y-6 p-6 bg-primary/5 rounded-xl border border-primary/20">
                <h3 className="text-lg font-semibold flex items-center mb-4 text-primary">
                  <IndianRupee className="mr-2 h-5 w-5" /> Pricing
                </h3>
                <div className="grid md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="pricePerHour"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price Per Hour (₹)</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="50" className="h-12 text-lg font-semibold" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="pricePerDay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price Per Day (₹) <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="300" className="h-12 text-lg font-semibold" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Amenities */}
              <FormField
                control={form.control}
                name="amenities"
                render={() => (
                  <FormItem>
                    <div className="mb-4">
                      <FormLabel className="text-base">Features & Amenities</FormLabel>
                      <FormDescription>Select all that apply to your parking spot.</FormDescription>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {amenitiesList.map((item) => (
                        <FormField
                          key={item.id}
                          control={form.control}
                          name="amenities"
                          render={({ field }) => {
                            return (
                              <FormItem
                                key={item.id}
                                className="flex flex-row items-start space-x-3 space-y-0 p-4 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                              >
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(item.id)}
                                    onCheckedChange={(checked) => {
                                      return checked
                                        ? field.onChange([...(field.value || []), item.id])
                                        : field.onChange(field.value?.filter((value) => value !== item.id))
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="font-medium cursor-pointer">
                                  {item.label}
                                </FormLabel>
                              </FormItem>
                            )
                          }}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Additional Details (Optional)</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Any specific instructions for finding the spot or accessing it?" 
                        className="min-h-[100px]" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" size="lg" className="w-full h-14 text-lg font-bold shadow-lg" disabled={createSpot.isPending}>
                {createSpot.isPending ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Publishing...</>
                ) : "List Parking Spot"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
