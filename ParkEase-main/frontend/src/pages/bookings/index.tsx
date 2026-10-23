import { useListBookings } from "@workspace/api-client-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Calendar, Clock, MapPin, IndianRupee, Car } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";

export default function Bookings() {
  const { user } = useAuth();
  // Bookings of the logged-in user (this used to be hardcoded to user 1).
  const { data: bookings, isLoading } = useListBookings({ userId: String(user?.id ?? "") });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'bg-green-500 hover:bg-green-600 text-white';
      case 'pending': return 'bg-yellow-500 hover:bg-yellow-600 text-white';
      case 'cancelled': return 'bg-red-500 hover:bg-red-600 text-white';
      case 'completed': return 'bg-blue-500 hover:bg-blue-600 text-white';
      default: return 'bg-gray-500 hover:bg-gray-600 text-white';
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">My Bookings</h1>
        <p className="text-muted-foreground">
          Manage your past and upcoming parking reservations.{" "}
          <Link href="/dashboard" className="font-medium text-foreground underline underline-offset-4">See your parking insights</Link>
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : bookings?.length === 0 ? (
        <div className="text-center py-20 bg-muted/20 border border-dashed rounded-xl">
          <Calendar className="h-12 w-12 mx-auto text-muted-foreground opacity-50 mb-4" />
          <h3 className="text-xl font-bold mb-2">No bookings yet</h3>
          <p className="text-muted-foreground mb-6">You haven't made any parking reservations yet.</p>
          <Link href="/spots">
            <Button>Find Parking</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings?.map((booking) => (
            <Link key={booking.id} href={`/bookings/${booking.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 overflow-hidden" 
                    style={{ borderLeftColor: booking.status === 'confirmed' ? 'hsl(var(--primary))' : undefined }}>
                <CardContent className="p-0 sm:p-6 sm:flex items-center gap-6">
                  {/* Mobile header (hidden on sm+) */}
                  <div className="sm:hidden p-4 border-b bg-muted/10 flex justify-between items-center">
                    <Badge className={getStatusColor(booking.status)}>{booking.status.toUpperCase()}</Badge>
                    <span className="font-bold text-lg">₹{booking.totalAmount}</span>
                  </div>

                  <div className="p-4 sm:p-0 flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-xl font-bold">{booking.spotName}</h3>
                      <div className="hidden sm:block">
                        <Badge className={getStatusColor(booking.status)}>{booking.status.toUpperCase()}</Badge>
                      </div>
                    </div>
                    
                    <div className="grid sm:grid-cols-2 gap-y-2 gap-x-4 mt-4">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <Calendar className="h-4 w-4 mr-2" />
                        {format(new Date(booking.startTime), 'MMM d, yyyy')}
                      </div>
                      <div className="flex items-center text-sm text-muted-foreground">
                        <Clock className="h-4 w-4 mr-2" />
                        {format(new Date(booking.startTime), 'h:mm a')} - {format(new Date(booking.endTime), 'h:mm a')}
                      </div>
                      <div className="flex items-center text-sm text-muted-foreground">
                        <Car className="h-4 w-4 mr-2" />
                        {booking.vehicleNumber} ({booking.vehicleType})
                      </div>
                      <div className="flex items-center text-sm text-muted-foreground font-medium text-primary hidden sm:flex">
                        <IndianRupee className="h-4 w-4 mr-1" />
                        {booking.totalAmount}
                      </div>
                    </div>
                  </div>

                  <div className="hidden sm:flex items-center border-l pl-6 h-full text-muted-foreground">
                    <Button variant="ghost" size="sm">View Details</Button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}