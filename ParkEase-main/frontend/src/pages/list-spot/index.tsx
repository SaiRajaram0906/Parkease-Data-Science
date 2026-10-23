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
import { MapPin, IndianRupee, Info, Camera, Loader2, LocateFixed } from "lucide-react";
import { GoogleMap, Marker } from "@react-google-maps/api";
import { useGoogleMaps } from "@/context/GoogleMapsContext";


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
});

export default function ListSpot() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createSpot = useCreateSpot();
  const { user, refreshUser } = useAuth();

  const form = useForm<z.infer<typeof spotSchema>>({
    resolver: zodResolver(spotSchema),
    defaultValues: {
      name: "",
      address: "",
      city: "",
      state: "Maharashtra",
      pricePerHour: "",
      pricePerDay: "",
      vehicleType: "both",
      totalSlots: "1",
      description: "",
      amenities: [],
      latitude: "",
      longitude: "",
    },
  });

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
      }
    }, {
      onSuccess: (data) => {
        // Listing a first spot turns a driver account into an owner account.
        void refreshUser();
        toast({
          title: "Success!",
          description: user?.role === "driver"
            ? "Your parking spot has been listed. Your account is now an owner account."
            : "Your parking spot has been listed.",
        });
        setLocation(`/spots/${data.id}`);
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to list spot. Please try again.",
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

              {/* Location */}
              <div className="space-y-6 p-6 bg-muted/20 rounded-xl border">
                <h3 className="text-lg font-semibold flex items-center mb-4">
                  <MapPin className="mr-2 h-5 w-5 text-primary" /> Location
                </h3>

                {/* Google Maps Integration */}
                <div className="mb-6">
                  <Label className="text-base mb-2 block">Pin Location on Map</Label>
                  <MapPicker 
                    onPositionChange={(lat, lng) => {
                      form.setValue("latitude", lat.toString());
                      form.setValue("longitude", lng.toString());
                    }}
                  />
                  <div className="flex gap-4 mt-2">
                    <FormField
                      control={form.control}
                      name="latitude"
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input placeholder="Latitude" {...field} readOnly className="bg-muted h-10 text-xs" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="longitude"
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input placeholder="Longitude" {...field} readOnly className="bg-muted h-10 text-xs" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Address</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Street address, building name, landmark..." className="resize-none" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-12">
                              <SelectValue placeholder="Select city" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Pune", "Chennai"].map(city => (
                              <SelectItem key={city} value={city}>{city}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                          <Input className="h-12" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
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

function MapPicker({ onPositionChange }: { onPositionChange: (lat: number, lng: number) => void }) {
  const { isLoaded } = useGoogleMaps();

  const [position, setPosition] = useState({ lat: 19.0760, lng: 72.8777 }); // Default to Mumbai

  const mapContainerStyle = {
    width: '100%',
    height: '350px',
    borderRadius: '0.75rem',
    border: '1px solid hsl(var(--border))'
  };

  const onLoad = (map: google.maps.Map) => {
    // Attempt to get user's current location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setPosition(newPos);
          onPositionChange(newPos.lat, newPos.lng);
        },
        () => {
          // Fallback if permission denied
          onPositionChange(position.lat, position.lng);
        }
      );
    } else {
      onPositionChange(position.lat, position.lng);
    }
  };

  const onMarkerDragEnd = (e: google.maps.MapMouseEvent) => {
    if (e.latLng) {
      const newLat = e.latLng.lat();
      const newLng = e.latLng.lng();
      setPosition({ lat: newLat, lng: newLng });
      onPositionChange(newLat, newLng);
    }
  };

  if (!isLoaded) return <div className="h-[350px] w-full bg-muted animate-pulse rounded-xl flex items-center justify-center">Loading Map...</div>;

  return (
    <GoogleMap
      mapContainerStyle={mapContainerStyle}
      center={position}
      zoom={14}
      onLoad={onLoad}
      options={{
        disableDefaultUI: false,
        zoomControl: true,
      }}
    >
      <Marker
        position={position}
        draggable={true}
        onDragEnd={onMarkerDragEnd}
        animation={google.maps.Animation.DROP}
      />
    </GoogleMap>
  );
}