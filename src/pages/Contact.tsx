import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Phone, MapPin, Send, Loader2, CheckCircle2, BellRing } from "lucide-react";

const BLANK = { name: "", email: "", phone: "", subject: "", message: "" };

export default function Contact() {
  const { toast } = useToast();
  const [form, setForm] = useState(BLANK);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const [subEmail, setSubEmail] = useState("");
  const [subName, setSubName] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  const set = (k: keyof typeof BLANK, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submitMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      toast({ title: "Please fill in your name, email and message", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const { error } = await (supabase as any).from("contact_messages").insert({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        subject: form.subject.trim() || null,
        message: form.message.trim(),
        source: "website",
      });
      if (error) throw error;
      setSent(true);
      setForm(BLANK);
    } catch (err: any) {
      toast({ title: "Could not send message", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const subscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subEmail.trim()) {
      toast({ title: "Enter your email to subscribe", variant: "destructive" });
      return;
    }
    setSubscribing(true);
    try {
      const { error } = await (supabase as any).from("subscribers").insert({
        email: subEmail.trim().toLowerCase(),
        name: subName.trim() || null,
        source: "website",
      });
      if (error) {
        // Unique violation → already subscribed
        if (error.code === "23505") {
          setSubscribed(true);
          return;
        }
        throw error;
      }
      setSubscribed(true);
      setSubEmail(""); setSubName("");
    } catch (err: any) {
      toast({ title: "Could not subscribe", description: err.message, variant: "destructive" });
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      {/* Header */}
      <header className="bg-gradient-to-r from-primary to-secondary text-white">
        <div className="max-w-4xl mx-auto px-4 py-10 text-center">
          <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center p-2">
            <img src="/favicon.png" alt="Sizzling Spices" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Sizzling Spices</h1>
          <p className="text-white/90 mt-1">Delectable finger foods, spices and more.</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Contact info */}
        <aside className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Get in touch</CardTitle>
              <CardDescription>We'd love to hear from you. Reach us directly or send a message.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span>No 4 Ogbu E.O, Kado Estate, Abuja, Nigeria</span>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <a href="mailto:sizzlingspicesng@gmail.com" className="hover:underline break-all">
                  sizzlingspicesng@gmail.com
                </a>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span>07011000453 / 08127575751</span>
              </div>
            </CardContent>
          </Card>

          {/* Newsletter */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BellRing className="h-4 w-4 text-secondary" /> Join our mailing list
              </CardTitle>
              <CardDescription>Get updates, offers and new menu announcements.</CardDescription>
            </CardHeader>
            <CardContent>
              {subscribed ? (
                <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" /> You're on the list — thank you!
                </div>
              ) : (
                <form onSubmit={subscribe} className="space-y-3">
                  <Input
                    placeholder="Your name (optional)"
                    value={subName}
                    onChange={(e) => setSubName(e.target.value)}
                  />
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={subEmail}
                    onChange={(e) => setSubEmail(e.target.value)}
                  />
                  <Button type="submit" variant="secondary" className="w-full gap-2" disabled={subscribing}>
                    {subscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                    Subscribe
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </aside>

        {/* Contact form */}
        <section className="lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Send us a message</CardTitle>
              <CardDescription>Fill the form and we'll get back to you as soon as possible.</CardDescription>
            </CardHeader>
            <CardContent>
              {sent ? (
                <div className="py-10 flex flex-col items-center text-center gap-3">
                  <div className="h-14 w-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <h3 className="font-semibold text-lg">Message sent!</h3>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Thank you for reaching out. We've received your message and will respond shortly.
                  </p>
                  <Button variant="outline" onClick={() => setSent(false)}>Send another message</Button>
                </div>
              ) : (
                <form onSubmit={submitMessage} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="name">Name *</Label>
                      <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Your full name" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email *</Label>
                      <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="phone">Phone</Label>
                      <Input id="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Optional" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="subject">Subject</Label>
                      <Input id="subject" value={form.subject} onChange={(e) => set("subject", e.target.value)} placeholder="What's this about?" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="message">Message *</Label>
                    <Textarea id="message" rows={5} value={form.message} onChange={(e) => set("message", e.target.value)} placeholder="How can we help you?" />
                  </div>
                  <Button type="submit" className="w-full gap-2" disabled={sending}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send Message
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="text-center text-xs text-muted-foreground py-8">
        © {new Date().getFullYear()} Sizzling Spices. All rights reserved.
      </footer>
    </div>
  );
}
