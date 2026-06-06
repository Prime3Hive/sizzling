import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Inbox, Mail, MailOpen, Reply, Archive, Trash2, Search, Loader2, Users,
  Download, Phone, CornerUpLeft, BellRing,
} from "lucide-react";
import { safeFormat } from "@/lib/safeDate";

interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  source: string;
  status: "new" | "read" | "replied" | "archived";
  created_at: string;
}

interface Subscriber {
  id: string;
  email: string;
  name: string | null;
  source: string;
  status: "active" | "unsubscribed";
  subscribed_at: string;
}

const statusBadge: Record<string, string> = {
  new:      "bg-blue-100 text-blue-700 border-blue-200",
  read:     "bg-slate-100 text-slate-600 border-slate-200",
  replied:  "bg-green-100 text-green-700 border-green-200",
  archived: "bg-gray-100 text-gray-500 border-gray-200",
};

export default function Messages() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "read" | "replied" | "archived">("all");
  const [selected, setSelected] = useState<ContactMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactMessage | null>(null);

  // ── Queries ──
  const { data: messages = [], isLoading } = useQuery<ContactMessage[]>({
    queryKey: ["contact-messages"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("contact_messages")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: subscribers = [], isLoading: loadingSubs } = useQuery<Subscriber[]>({
    queryKey: ["subscribers"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("subscribers")
        .select("*")
        .order("subscribed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // ── Mutations ──
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ContactMessage["status"] }) => {
      const { error } = await (supabase as any)
        .from("contact_messages")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contact-messages"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMsg = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("contact_messages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-messages"] });
      toast({ title: "Message deleted" });
      setDeleteTarget(null);
      setSelected(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleSub = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Subscriber["status"] }) => {
      const { error } = await (supabase as any)
        .from("subscribers")
        .update({
          status,
          unsubscribed_at: status === "unsubscribed" ? new Date().toISOString() : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subscribers"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Derived ──
  const unreadCount = messages.filter((m) => m.status === "new").length;
  const filtered = messages.filter((m) => {
    const matchesStatus = statusFilter === "all" || m.status === statusFilter;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      m.name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      (m.subject ?? "").toLowerCase().includes(q) ||
      m.message.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  const openMessage = (m: ContactMessage) => {
    setSelected(m);
    if (m.status === "new") setStatus.mutate({ id: m.id, status: "read" });
  };

  const replyHref = (m: ContactMessage) =>
    `mailto:${m.email}?subject=${encodeURIComponent("Re: " + (m.subject || "Your message to Sizzling Spices"))}`;

  const exportSubscribersCsv = () => {
    const active = subscribers.filter((s) => s.status === "active");
    const rows = [
      ["Email", "Name", "Source", "Status", "Subscribed At"],
      ...subscribers.map((s) => [
        s.email, s.name ?? "", s.source, s.status, s.subscribed_at,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `Exported ${subscribers.length} subscriber${subscribers.length === 1 ? "" : "s"}`, description: `${active.length} active` });
  };

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Inbox className="h-6 w-6" /> Messages
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Contact form submissions and mailing-list subscribers.
        </p>
      </div>

      <Tabs defaultValue="inbox" className="space-y-4">
        <TabsList>
          <TabsTrigger value="inbox" className="gap-2">
            <Mail className="h-4 w-4" /> Inbox
            {unreadCount > 0 && (
              <Badge className="ml-1 bg-blue-600 text-white text-[10px] h-5 min-w-5 px-1">{unreadCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="subscribers" className="gap-2">
            <Users className="h-4 w-4" /> Subscribers
            <Badge variant="secondary" className="ml-1 text-[10px]">{subscribers.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── Inbox ── */}
        <TabsContent value="inbox" className="space-y-4">
          <div className="flex gap-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search messages…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-1 flex-wrap">
              {(["all", "new", "read", "replied", "archived"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={statusFilter === s ? "default" : "outline"}
                  className="capitalize h-9"
                  onClick={() => setStatusFilter(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
                <Inbox className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-muted-foreground">No messages found.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((m) => (
                <Card
                  key={m.id}
                  className={`cursor-pointer transition-shadow hover:shadow-sm ${m.status === "new" ? "border-blue-200 bg-blue-50/40 dark:bg-blue-900/10" : ""}`}
                  onClick={() => openMessage(m)}
                >
                  <CardContent className="py-3 flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {m.status === "new"
                        ? <Mail className="h-4 w-4 text-blue-600" />
                        : <MailOpen className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm ${m.status === "new" ? "font-semibold" : "font-medium"}`}>{m.name}</span>
                        <span className="text-xs text-muted-foreground truncate">{m.email}</span>
                        <Badge variant="outline" className={`text-[10px] ${statusBadge[m.status]}`}>{m.status}</Badge>
                      </div>
                      {m.subject && <p className="text-sm truncate">{m.subject}</p>}
                      <p className="text-xs text-muted-foreground truncate">{m.message}</p>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">
                      {safeFormat(m.created_at, "MMM d, HH:mm")}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Subscribers ── */}
        <TabsContent value="subscribers" className="space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <p className="text-sm text-muted-foreground">
              {subscribers.filter((s) => s.status === "active").length} active · {subscribers.length} total
            </p>
            <Button variant="outline" size="sm" className="gap-2" onClick={exportSubscribersCsv} disabled={subscribers.length === 0}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>

          {loadingSubs ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : subscribers.length === 0 ? (
            <Card>
              <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
                <BellRing className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-muted-foreground">No subscribers yet.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Subscribed</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subscribers.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.email}</TableCell>
                        <TableCell>{s.name || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{safeFormat(s.subscribed_at, "MMM d, yyyy")}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={s.status === "active" ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"}>
                            {s.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm" variant="ghost" className="text-xs"
                            onClick={() => toggleSub.mutate({ id: s.id, status: s.status === "active" ? "unsubscribed" : "active" })}
                          >
                            {s.status === "active" ? "Unsubscribe" : "Re-activate"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Message detail dialog ── */}
      <AlertDialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <AlertDialogContent className="max-w-lg">
          {selected && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center justify-between gap-2 flex-wrap">
                  <span>{selected.subject || "Message"}</span>
                  <Badge variant="outline" className={`text-[10px] ${statusBadge[selected.status]}`}>{selected.status}</Badge>
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3 pt-2 text-foreground">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{selected.name}</span>
                      <a href={`mailto:${selected.email}`} className="hover:underline flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {selected.email}
                      </a>
                      {selected.phone && (
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {selected.phone}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Received {safeFormat(selected.created_at, "MMM d, yyyy 'at' HH:mm")} · via {selected.source}
                    </p>
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap text-foreground">
                      {selected.message}
                    </div>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex-wrap gap-2 sm:justify-between">
                <div className="flex gap-2 flex-wrap">
                  <a href={replyHref(selected)} onClick={() => setStatus.mutate({ id: selected.id, status: "replied" })}>
                    <Button size="sm" className="gap-1.5"><Reply className="h-3.5 w-3.5" /> Reply by email</Button>
                  </a>
                  {selected.status !== "archived" ? (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setStatus.mutate({ id: selected.id, status: "archived" })}>
                      <Archive className="h-3.5 w-3.5" /> Archive
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setStatus.mutate({ id: selected.id, status: "read" })}>
                      <CornerUpLeft className="h-3.5 w-3.5" /> Unarchive
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="gap-1.5 text-destructive" onClick={() => setDeleteTarget(selected)}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
                <AlertDialogCancel className="mt-0">Close</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete confirm ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              The message from {deleteTarget?.name} ({deleteTarget?.email}) will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMsg.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
