import { useGetDashboardStats, useGetRecentBookings, useGetCityBreakdown, useGetTopSpots } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { IndianRupee, Car, Calendar, Users, MapPin, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import { DriverAnalytics } from "@/components/ds/DriverAnalytics";
import { OwnerInsights } from "@/components/ds/OwnerInsights";
import { RewardsCard } from "@/components/rewards/RewardsCard";

/**
 * Dashboard. What it shows depends on the role:
 *   driver  Parking rewards and My parking insights
 *   owner   My listings (slot performance, demand forecast, pricing)
 *   admin   Platform overview (all revenue, users and bookings) + the two above
 * The platform figures are for admins only; the server refuses them otherwise.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isOwner = user?.role === "owner" || isAdmin;
  const isDriver = user?.role === "driver" || isAdmin;
  const firstTab = isAdmin ? "platform" : isOwner ? "listings" : "insights";

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          {isAdmin
            ? "Platform-wide figures, plus your own listings and parking activity."
            : isOwner
              ? "How your listings perform, what demand to expect, and what to charge."
              : "Your parking activity at a glance."}
        </p>
      </div>
      <Tabs defaultValue={firstTab} key={firstTab}>
        {/* Only an admin has more than one section, so only an admin needs tabs. */}
        {isAdmin && (
          <div className="-mx-4 mb-6 overflow-x-auto px-4">
            <TabsList className="h-auto w-max">
              <TabsTrigger value="platform">Platform overview</TabsTrigger>
              <TabsTrigger value="listings">My listings</TabsTrigger>
              <TabsTrigger value="insights">My parking insights</TabsTrigger>
            </TabsList>
          </div>
        )}
        {isAdmin && <TabsContent value="platform"><PlatformOverview /></TabsContent>}
        {isOwner && <TabsContent value="listings"><OwnerInsights userId={user?.id} /></TabsContent>}
        {isDriver && (
          <TabsContent value="insights">
            <div className="mb-6"><RewardsCard /></div>
            <DriverAnalytics userId={user?.id} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// /dashboard/top-spots returns two aggregates that the generated type omits.
type TopSpot = { id: number; name: string; city: string; totalRevenue?: string | null; completedBookings?: number };

/** The original ParkEase dashboard: platform-wide metrics from live data. */
function PlatformOverview() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: recentBookings, isLoading: bookingsLoading } = useGetRecentBookings();
  const { data: cityBreakdown, isLoading: citiesLoading } = useGetCityBreakdown();
  const { data: topSpots, isLoading: spotsLoading } = useGetTopSpots();

  const primaryColor = "hsl(var(--primary))";

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">Platform overview</h2>
        <p className="text-muted-foreground">Live metrics across all ParkEase spots and bookings.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[
          { title: "Total Revenue", value: `₹${stats?.totalRevenue || 0}`, icon: IndianRupee, loading: statsLoading },
          { title: "Active Bookings", value: stats?.activeBookings || 0, icon: Calendar, loading: statsLoading },
          { title: "Total Spots", value: stats?.totalSpots || 0, icon: Car, loading: statsLoading },
          { title: "Total Users", value: stats?.totalUsers || 0, icon: Users, loading: statsLoading }
        ].map((stat, i) => (
          <Card key={i} className="border-none shadow-md bg-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              {stat.loading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-3xl font-bold">{stat.value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Chart */}
        <Card className="lg:col-span-2 shadow-md border-none">
          <CardHeader>
            <CardTitle>Revenue by City</CardTitle>
            <CardDescription>Completed-booking revenue across locations, all time</CardDescription>
          </CardHeader>
          <CardContent>
            {citiesLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <div className="h-[300px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cityBreakdown} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="city" tickLine={false} axisLine={false} tick={{fill: 'hsl(var(--muted-foreground))'}} />
                    <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `₹${value}`} tick={{fill: 'hsl(var(--muted-foreground))'}} />
                    <Tooltip 
                      cursor={{fill: 'hsl(var(--muted)/0.5)'}}
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                      formatter={(value) => [`₹${value}`, 'Revenue']}
                    />
                    <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                      {cityBreakdown?.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={primaryColor} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Spots */}
        <Card className="shadow-md border-none">
          <CardHeader>
            <CardTitle className="flex items-center">
              <TrendingUp className="h-5 w-5 mr-2 text-primary" />
              Top Performing Spots
            </CardTitle>
          </CardHeader>
          <CardContent>
            {spotsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : (
              <div className="space-y-6">
                {(topSpots as TopSpot[] | undefined)?.slice(0, 5).map((spot, i) => (
                  <div key={spot.id} className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary shrink-0">
                      #{i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{spot.name}</p>
                      <p className="text-xs text-muted-foreground truncate flex items-center">
                        <MapPin className="h-3 w-3 mr-1" /> {spot.city}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-primary">₹{spot.totalRevenue || '0'}</p>
                      <p className="text-xs text-muted-foreground">{spot.completedBookings || 0} bookings</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Bookings Table */}
        <Card className="lg:col-span-3 shadow-md border-none">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest bookings across all locations</CardDescription>
          </CardHeader>
          <CardContent>
            {bookingsLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-muted-foreground uppercase bg-muted/50">
                    <tr>
                      <th className="px-6 py-3 rounded-tl-lg">ID</th>
                      <th className="px-6 py-3">Spot</th>
                      <th className="px-6 py-3">Vehicle</th>
                      <th className="px-6 py-3">Time</th>
                      <th className="px-6 py-3">Amount</th>
                      <th className="px-6 py-3 rounded-tr-lg">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentBookings?.map((booking) => (
                      <tr key={booking.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-6 py-4 font-mono font-medium">#{booking.id}</td>
                        <td className="px-6 py-4 font-medium">{booking.spotName}</td>
                        <td className="px-6 py-4">
                          {booking.vehicleNumber} <span className="text-muted-foreground">({booking.vehicleType})</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {format(new Date(booking.startTime), 'MMM d, HH:mm')}
                        </td>
                        <td className="px-6 py-4 font-semibold text-primary">₹{booking.totalAmount}</td>
                        <td className="px-6 py-4">
                          <Badge variant={
                            booking.status === 'confirmed' ? 'default' : 
                            booking.status === 'pending' ? 'secondary' : 
                            booking.status === 'cancelled' ? 'destructive' : 'outline'
                          }>
                            {booking.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}