import { useGetUser, getGetUserQueryKey, useUpdateUser } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { User, Phone, Mail, Car, CreditCard, Settings, LogOut, Loader2, Smartphone, Trash2, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "wouter";
import { EmailSettingsCard } from "@/components/notifications/EmailSettingsCard";

export default function Profile() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logout, user: authUser } = useAuth();
  // Profile of the logged-in user (this used to be hardcoded to user 1).
  const userId = authUser?.id ?? 0;
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [activeModal, setActiveModal] = useState<"vehicles" | "payments" | "preferences" | null>(null);
  const [vehicles, setVehicles] = useState<any[]>(() => {
    const saved = localStorage.getItem("parkease_vehicles");
    return saved ? JSON.parse(saved) : [];
  });
  const [paymentMethods, setPaymentMethods] = useState<any[]>(() => {
    const saved = localStorage.getItem("parkease_payments");
    return saved ? JSON.parse(saved) : [];
  });
  const [editingVehicleId, setEditingVehicleId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ make: "", plate: "", type: "car" });

  const [isAddingPayment, setIsAddingPayment] = useState(false);
  const [newPaymentType, setNewPaymentType] = useState<"card" | "upi">("card");
  const [newCardForm, setNewCardForm] = useState({ number: "", expiry: "", cvc: "" });
  const [newUpiId, setNewUpiId] = useState("");
  const [preferences, setPreferences] = useState(() => {
    const saved = localStorage.getItem("parkease_preferences");
    return saved ? JSON.parse(saved) : { emailAlerts: true, smsAlerts: false, defaultPayment: true };
  });

  useEffect(() => {
    localStorage.setItem("parkease_vehicles", JSON.stringify(vehicles));
  }, [vehicles]);

  useEffect(() => {
    localStorage.setItem("parkease_payments", JSON.stringify(paymentMethods));
  }, [paymentMethods]);

  useEffect(() => {
    localStorage.setItem("parkease_preferences", JSON.stringify(preferences));
  }, [preferences]);

  const handleAddVehicle = () => {
    setVehicles([...vehicles, { id: Date.now(), make: "Toyota Camry", plate: "CA-123-ABC", type: "car" }]);
    toast({ title: "Vehicle Added", description: "Successfully added dummy vehicle." });
  };

  const handleEditClick = (vehicle: any) => {
    setEditingVehicleId(vehicle.id);
    setEditForm({ make: vehicle.make, plate: vehicle.plate, type: vehicle.type || "car" });
  };

  const handleSaveEdit = () => {
    setVehicles(vehicles.map(v => v.id === editingVehicleId ? { ...v, ...editForm } : v));
    setEditingVehicleId(null);
    toast({ title: "Vehicle Updated", description: "Your vehicle details have been saved." });
  };
  
  const handleSetDefaultPayment = (id: number) => {
    setPaymentMethods(prev => prev.map(p => ({ ...p, isDefault: p.id === id })));
    toast({ title: "Default Set", description: "Updated your default payment method." });
  };

  const handleRemovePayment = (id: number) => {
    setPaymentMethods(prev => {
      const filtered = prev.filter(p => p.id !== id);
      if (prev.find(p => p.id === id)?.isDefault && filtered.length > 0) {
        filtered[0].isDefault = true;
      }
      return filtered;
    });
    toast({ title: "Payment Method Removed", description: "Successfully removed card." });
  };

  const handleSaveNewPayment = () => {
    const isFirst = paymentMethods.length === 0;
    if (newPaymentType === "card") {
      setPaymentMethods([...paymentMethods, { 
        id: Date.now(), 
        type: "card", 
        title: `Visa ending in ${newCardForm.number.slice(-4) || '4242'}`, 
        details: `Expires ${newCardForm.expiry || '12/26'}`,
        isDefault: isFirst
      }]);
    } else {
      setPaymentMethods([...paymentMethods, { 
        id: Date.now(), 
        type: "upi", 
        title: "UPI Method", 
        details: newUpiId || "example@upi",
        isDefault: isFirst
      }]);
    }
    toast({ title: "Payment Added", description: "Your new payment method is ready." });
    setIsAddingPayment(false);
    setNewCardForm({ number: "", expiry: "", cvc: "" });
    setNewUpiId("");
  };
  const { data: user, isLoading } = useGetUser(userId, {
    query: {
      enabled: !!userId,
      queryKey: getGetUserQueryKey(userId),
    }
  });

  const updateUser = useUpdateUser();

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setPhone(user.phone || "");
    }
  }, [user]);

  const handleSave = () => {
    updateUser.mutate({
      id: userId,
      data: { name, phone }
    }, {
      onSuccess: (updatedUser) => {
        toast({ title: "Profile Updated", description: "Your changes have been saved." });
        queryClient.setQueryData(getGetUserQueryKey(userId), updatedUser);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update profile.", variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Skeleton className="h-64 w-full mb-8" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Account Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your profile and preferences.</p>
        </div>
        <Button onClick={() => { logout(); setLocation("/login"); }} variant="destructive" className="gap-2 bg-destructive/10 text-destructive hover:bg-destructive/20 border-none shadow-none">
          <LogOut className="h-4 w-4" /> Sign Out
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-1 space-y-6">
          <Card className="border-none shadow-md overflow-hidden">
            <div className="h-24 bg-primary/20 w-full" />
            <CardContent className="px-6 pb-6 pt-0 flex flex-col items-center text-center">
              <Avatar className="h-24 w-24 border-4 border-background -mt-12 mb-4 bg-muted">
                <AvatarImage src={user.avatarUrl || ''} />
                <AvatarFallback className="text-2xl font-bold">{user.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <h2 className="text-xl font-bold truncate w-full px-2">{user.name}</h2>
              <p className="text-sm text-muted-foreground mb-4 truncate w-full px-2" title={user.email}>{user.email}</p>
              <div className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
                {user.role} Account
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardContent className="p-2">
              <nav className="flex flex-col space-y-1">
                <Button variant="ghost" className="justify-start bg-muted font-medium">
                  <User className="mr-3 h-4 w-4" /> Personal Info
                </Button>
                <Button variant="ghost" onClick={() => setActiveModal("vehicles")} className="justify-start text-muted-foreground hover:bg-[#84cc16]/10 hover:text-[#84cc16] transition-colors">
                  <Car className="mr-3 h-4 w-4" /> My Vehicles
                </Button>
                <Button variant="ghost" onClick={() => setActiveModal("payments")} className="justify-start text-muted-foreground hover:bg-[#84cc16]/10 hover:text-[#84cc16] transition-colors">
                  <CreditCard className="mr-3 h-4 w-4" /> Payment Methods
                </Button>
                <Button variant="ghost" onClick={() => setActiveModal("preferences")} className="justify-start text-muted-foreground hover:bg-[#84cc16]/10 hover:text-[#84cc16] transition-colors">
                  <Settings className="mr-3 h-4 w-4" /> Preferences
                </Button>
              </nav>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2">
          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle>Personal Information</CardTitle>
              <CardDescription>Update your contact details and basic information.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input 
                      id="name" 
                      value={name} 
                      onChange={(e) => setName(e.target.value)} 
                      className="pl-10" 
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input 
                      id="phone" 
                      value={phone} 
                      onChange={(e) => setPhone(e.target.value)} 
                      placeholder="+91" 
                      className="pl-10" 
                    />
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input id="email" defaultValue={user.email} disabled className="pl-10 bg-muted/50" />
                </div>
                <p className="text-xs text-muted-foreground">Email address cannot be changed.</p>
              </div>

              <Button onClick={handleSave} disabled={updateUser.isPending} className="mt-4">
                {updateUser.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save Changes
              </Button>
            </CardContent>
          </Card>

          <div className="mt-8"><EmailSettingsCard email={user.email} /></div>
        </div>
      </div>

      <Dialog open={activeModal !== null} onOpenChange={(open) => !open && setActiveModal(null)}>
        <DialogContent className="sm:max-w-[425px] bg-background/95 backdrop-blur-md border border-primary/20 shadow-2xl shadow-[#84cc16]/5 sm:rounded-2xl">
          {activeModal === "vehicles" && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">My Vehicles</DialogTitle>
                <DialogDescription>Manage your saved vehicles for quick bookings.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {vehicles.map((vehicle) => (
                  <div key={vehicle.id} className="p-3 rounded-xl border bg-card hover:border-[#84cc16]/50 transition-colors shadow-sm">
                    {editingVehicleId === vehicle.id ? (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Make & Model</Label>
                          <Input value={editForm.make} onChange={e => setEditForm({...editForm, make: e.target.value})} className="h-8 text-sm" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">License Plate</Label>
                            <Input value={editForm.plate} onChange={e => setEditForm({...editForm, plate: e.target.value})} className="h-8 text-sm placeholder:text-muted-foreground" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Type</Label>
                            <Input value={editForm.type} onChange={e => setEditForm({...editForm, type: e.target.value})} className="h-8 text-sm placeholder:text-muted-foreground" />
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end pt-2">
                          <Button variant="ghost" size="sm" onClick={() => setEditingVehicleId(null)} className="h-7 text-xs">Cancel</Button>
                          <Button size="sm" onClick={handleSaveEdit} className="h-7 text-xs bg-[#84cc16] hover:bg-[#65a30d] text-white">Save</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-[#84cc16]/10 rounded-full text-[#84cc16] leading-none">
                            <Car className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{vehicle.make} <span className="text-xs opacity-50 ml-1 font-normal capitalize">({vehicle.type || 'car'})</span></p>
                            <p className="text-xs text-muted-foreground">{vehicle.plate}</p>
                          </div>
                        </div>
                        <Button onClick={() => handleEditClick(vehicle)} variant="ghost" size="sm" className="h-8 text-xs text-[#84cc16] hover:bg-[#84cc16]/10">Edit</Button>
                      </div>
                    )}
                  </div>
                ))}
                <Button onClick={handleAddVehicle} className="w-full bg-[#84cc16] hover:bg-[#65a30d] text-white shadow-md rounded-xl mt-2 transition-transform active:scale-[0.98]">
                  <Car className="mr-2 h-4 w-4" /> Add New Vehicle
                </Button>
              </div>
            </>
          )}

          {activeModal === "payments" && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">{isAddingPayment ? 'Add Payment Method' : 'Payment Methods'}</DialogTitle>
                <DialogDescription>{isAddingPayment ? 'Enter your details below securely.' : 'Manage your cards for seamless checkout.'}</DialogDescription>
              </DialogHeader>
              <div className="py-4">
                {isAddingPayment ? (
                  <div className="space-y-4 slide-in-from-right-4 animate-in">
                    <div className="flex gap-2">
                       <Button variant={newPaymentType === "card" ? "default" : "outline"} onClick={() => setNewPaymentType("card")} className={`flex-1 ${newPaymentType === "card" ? 'bg-[#84cc16] hover:bg-[#65a30d] text-white' : ''}`}>
                         <CreditCard className="mr-2 h-4 w-4" /> Card
                       </Button>
                       <Button variant={newPaymentType === "upi" ? "default" : "outline"} onClick={() => setNewPaymentType("upi")} className={`flex-1 ${newPaymentType === "upi" ? 'bg-[#84cc16] hover:bg-[#65a30d] text-white' : ''}`}>
                         <Smartphone className="mr-2 h-4 w-4" /> UPI
                       </Button>
                    </div>

                    {newPaymentType === "card" ? (
                      <div className="space-y-3 mt-4">
                        <div className="space-y-1">
                           <Label className="text-xs">Card Number</Label>
                           <Input placeholder="0000 0000 0000 0000" value={newCardForm.number} onChange={e => setNewCardForm({...newCardForm, number: e.target.value})} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                           <div className="space-y-1">
                             <Label className="text-xs">Expiry Date</Label>
                             <Input placeholder="MM/YY" value={newCardForm.expiry} onChange={e => setNewCardForm({...newCardForm, expiry: e.target.value})} />
                           </div>
                           <div className="space-y-1">
                             <Label className="text-xs">CVC</Label>
                             <Input type="password" placeholder="***" value={newCardForm.cvc} onChange={e => setNewCardForm({...newCardForm, cvc: e.target.value})} />
                           </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 mt-4">
                        <div className="space-y-1">
                           <Label className="text-xs">UPI ID</Label>
                           <Input placeholder="name@bank" value={newUpiId} onChange={e => setNewUpiId(e.target.value)} />
                        </div>
                      </div>
                    )}
                    
                    <div className="flex gap-2 pt-2">
                      <Button variant="ghost" className="flex-1" onClick={() => setIsAddingPayment(false)}>Cancel</Button>
                      <Button className="flex-1 bg-[#84cc16] hover:bg-[#65a30d] text-white" onClick={handleSaveNewPayment}>Add Method</Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 fade-in animate-in">
                    {paymentMethods.length === 0 ? (
                      <div className="text-center py-6 border border-dashed rounded-xl bg-card">
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                           <CreditCard className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-medium">No payment methods</p>
                        <p className="text-xs text-muted-foreground mb-4">Add a card or UPI ID to get started.</p>
                      </div>
                    ) : (
                      paymentMethods.map((payment) => (
                        <div key={payment.id} className={`flex items-start justify-between p-3 rounded-xl border bg-card transition-colors shadow-sm ${payment.isDefault ? 'border-[#84cc16]/50 bg-[#84cc16]/5' : 'hover:border-[#84cc16]/30'}`}>
                          <div className="flex items-start gap-3">
                            <div className={`p-2 rounded-full leading-none mt-1 flex-shrink-0 ${payment.isDefault ? 'bg-[#84cc16]/10 text-[#84cc16]' : 'bg-muted text-muted-foreground'}`}>
                              {payment.type === 'card' ? <CreditCard className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm">{payment.title}</p>
                                {payment.isDefault && <span className="px-2 py-0.5 rounded-full bg-[#84cc16]/10 text-[#84cc16] text-[10px] uppercase font-bold tracking-wider">Default</span>}
                              </div>
                              <p className="text-xs text-muted-foreground">{payment.details}</p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {!payment.isDefault && (
                              <Button variant="ghost" size="sm" onClick={() => handleSetDefaultPayment(payment.id)} className="h-6 text-[10px] px-2 text-muted-foreground hover:text-[#84cc16]">Set as Default</Button>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => handleRemovePayment(payment.id)} className="h-6 text-[10px] px-2 text-destructive hover:bg-destructive/10 hover:text-destructive">
                              <Trash2 className="h-3 w-3 mr-1" /> Delete
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                    <Button onClick={() => setIsAddingPayment(true)} className="w-full bg-[#84cc16] hover:bg-[#65a30d] text-white shadow-md rounded-xl mt-2 transition-transform active:scale-[0.98]">
                      <Plus className="mr-2 h-4 w-4" /> Add Payment Method
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}

          {activeModal === "preferences" && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">Preferences</DialogTitle>
                <DialogDescription>Customize your app experience.</DialogDescription>
              </DialogHeader>
              <div className="space-y-6 py-4">
                <div className="flex items-center justify-between space-x-2">
                  <Label htmlFor="email-alerts" className="flex flex-col space-y-1 cursor-pointer">
                    <span className="font-medium">Email Notifications</span>
                    <span className="font-normal text-xs text-muted-foreground">Receive booking confirmations via email</span>
                  </Label>
                  <Switch id="email-alerts" checked={preferences.emailAlerts} onCheckedChange={(c) => setPreferences({ ...preferences, emailAlerts: c })} className="data-[state=checked]:bg-[#84cc16]" />
                </div>
                <div className="flex items-center justify-between space-x-2">
                  <Label htmlFor="sms-alerts" className="flex flex-col space-y-1 cursor-pointer">
                    <span className="font-medium">SMS Alerts</span>
                    <span className="font-normal text-xs text-muted-foreground">Receive reminders 15 mins before parking</span>
                  </Label>
                  <Switch id="sms-alerts" checked={preferences.smsAlerts} onCheckedChange={(c) => setPreferences({ ...preferences, smsAlerts: c })} className="data-[state=checked]:bg-[#84cc16]" />
                </div>
                <div className="flex items-center justify-between space-x-2">
                  <Label htmlFor="default-payment" className="flex flex-col space-y-1 cursor-pointer">
                    <span className="font-medium">Auto-Select Default Payment</span>
                    <span className="font-normal text-xs text-muted-foreground">Speed up checkout using primary card</span>
                  </Label>
                  <Switch id="default-payment" checked={preferences.defaultPayment} onCheckedChange={(c) => setPreferences({ ...preferences, defaultPayment: c })} className="data-[state=checked]:bg-[#84cc16]" />
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}