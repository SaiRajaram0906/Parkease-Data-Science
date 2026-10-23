/**
 * Admin console: manage every user's role and every listing.
 * Only admins can open this page, and the server refuses these calls for
 * anyone else.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { getListSpotsQueryKey, useDeleteSpot, useUpdateSpot } from "@workspace/api-client-react";
import { CalendarCheck, ParkingSquare, ShieldCheck, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { changeUserRole, listAllSpots, listAllUsers } from "@/lib/auth-api";
import { ChartCard, StatTile } from "@/components/ds/ChartKit";

const ROLES = ["driver", "owner", "admin"] as const;

export default function Admin() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: listAllUsers });
  const spots = useQuery({ queryKey: ["admin", "spots"], queryFn: listAllSpots });
  const updateSpot = useUpdateSpot();
  const deleteSpot = useDeleteSpot();

  const refreshSpots = () => {
    queryClient.invalidateQueries({ queryKey: ["admin"] });
    queryClient.invalidateQueries({ queryKey: getListSpotsQueryKey() });
  };

  const setRole = async (id: number, name: string, role: string) => {
    try {
      await changeUserRole(id, role);
      toast({ title: "Role updated", description: `${name} is now ${role === "admin" ? "an admin" : role === "owner" ? "an owner" : "a driver"}.` });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    } catch (error) {
      toast({ title: "Could not change the role", description: (error as Error).message, variant: "destructive" });
    }
  };

  const toggleSpot = (id: number, name: string, isActive: boolean) =>
    updateSpot.mutate({ id, data: { isActive: !isActive } }, {
      onSuccess: () => {
        toast({ title: isActive ? "Listing deactivated" : "Listing activated", description: name });
        refreshSpots();
      },
      onError: () => toast({ title: "Could not update the listing", variant: "destructive" }),
    });

  const removeSpot = (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    deleteSpot.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Listing deleted", description: name });
        refreshSpots();
      },
      onError: () => toast({ title: "Could not delete the listing", variant: "destructive" }),
    });
  };

  const userRows = users.data ?? [];
  const spotRows = spots.data ?? [];

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <ShieldCheck className="h-7 w-7 text-primary" />
          Admin console
        </h1>
        <p className="mt-1 text-muted-foreground">Manage every account and every listing on ParkEase.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Users" value={users.isLoading ? "…" : userRows.length} icon={Users}
          hint={`${userRows.filter((u) => u.role === "owner").length} owners, ${userRows.filter((u) => u.role === "admin").length} admins`} />
        <StatTile label="Listings" value={spots.isLoading ? "…" : spotRows.length} icon={ParkingSquare}
          hint={`${spotRows.filter((s) => !s.isActive).length} deactivated`} />
        <StatTile label="Bookings made" value={users.isLoading ? "…" : userRows.reduce((sum, u) => sum + u.bookings, 0)} icon={CalendarCheck} />
        <StatTile label="Platform figures" value={<Link href="/dashboard" className="text-base underline underline-offset-4">Open dashboard</Link>} />
      </div>

      <Tabs defaultValue="users">
        <TabsList className="mb-5">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="listings">Listings</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <ChartCard title="Users and roles" description="Change what an account is allowed to do.">
            {users.isLoading ? <Skeleton className="h-64 w-full" /> : users.isError ? (
              <p className="text-sm text-destructive">{(users.error as Error).message}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="rounded-tl-lg px-4 py-2.5">User</th>
                      <th className="px-4 py-2.5">Email</th>
                      <th className="px-4 py-2.5 text-right">Listings</th>
                      <th className="px-4 py-2.5 text-right">Bookings</th>
                      <th className="rounded-tr-lg px-4 py-2.5">Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userRows.map((u) => (
                      <tr key={u.id} className="border-b border-border/50">
                        <td className="px-4 py-2.5 font-medium">
                          {u.name}
                          {u.id === me?.id && <Badge variant="secondary" className="ml-2">You</Badge>}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{u.email}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{u.listings}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{u.bookings}</td>
                        <td className="px-4 py-2">
                          <Select value={u.role} onValueChange={(role) => setRole(u.id, u.name, role)} disabled={u.id === me?.id}>
                            <SelectTrigger className="h-8 w-[120px] capitalize" aria-label={`Role of ${u.name}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ROLES.map((role) => <SelectItem key={role} value={role} className="capitalize">{role}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>
        </TabsContent>

        <TabsContent value="listings">
          <ChartCard title="All listings" description="Includes deactivated listings, which drivers cannot see or book.">
            {spots.isLoading ? <Skeleton className="h-64 w-full" /> : spots.isError ? (
              <p className="text-sm text-destructive">{(spots.error as Error).message}</p>
            ) : spotRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No listings yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="rounded-tl-lg px-4 py-2.5">Listing</th>
                      <th className="px-4 py-2.5">Owner</th>
                      <th className="px-4 py-2.5 text-right">Price</th>
                      <th className="px-4 py-2.5 text-right">Spaces</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="rounded-tr-lg px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spotRows.map((s) => (
                      <tr key={s.id} className="border-b border-border/50">
                        <td className="px-4 py-2.5 font-medium">
                          <Link href={`/spots/${s.id}`} className="hover:underline">{s.name}</Link>
                          <span className="block text-xs font-normal text-muted-foreground">{s.city}</span>
                        </td>
                        <td className="px-4 py-2.5">{s.ownerName ?? "–"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">₹{Number(s.pricePerHour)}/h</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{s.totalSlots}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={s.isActive ? "default" : "secondary"}>{s.isActive ? "Active" : "Deactivated"}</Badge>
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <Button variant="outline" size="sm" className="h-8" onClick={() => toggleSpot(s.id, s.name, s.isActive)}>
                            {s.isActive ? "Deactivate" : "Activate"}
                          </Button>
                          <Button variant="ghost" size="icon" className="ml-1 h-8 w-8 text-destructive hover:text-destructive"
                            aria-label={`Delete ${s.name}`} onClick={() => removeSpot(s.id, s.name)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
