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

// Mirrors the CHECK constraints in 20260922110000_public_form_rate_limit.sql.
// The database is what enforces these — anyone can skip this file and POST to
// PostgREST with the publishable key. Checking here only means an honest
// visitor sees "Message is too long" instead of a constraint-violation toast.
const LIMITS = { name: 120, email: 254, phone: 32, subject: 200, message: 5000 } as const;
const EMAIL_RE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;
const PHONE_RE = /^[0-9+().\/ -]+$/;

const validateMessage = (f: typeof BLANK): string | null => {
  if (!f.name.trim()) return "Please tell us your name.";
  if (f.name.trim().length > LIMITS.name) return "That name is too long.";
  if (!EMAIL_RE.test(f.email.trim()) || f.email.trim().length > LIMITS.email)
    return "Please enter a valid email address.";
  if (f.phone.trim() && (!PHONE_RE.test(f.phone.trim()) || f.phone.trim().length > LIMITS.phone))
    return "That phone number doesn't look right.";
  if (f.subject.trim().length > LIMITS.subject) return "That subject is too long.";
  if (!f.message.trim()) return "Please write a message.";
  if (f.message.trim().length > LIMITS.message)
    return `Please keep your message under ${LIMITS.message.toLocaleString()} characters.`;
  return null;
};

// PostgREST error bodies carry table, column and constraint names. The rate
// limiter raises PT429, whose message is written for the visitor, so that one
// is passed through; everything else becomes a generic line and the detail
// goes to the console for whoever is debugging.
const publicErrorMessage = (err: any, fallback: string): string => {
  if (err?.code === "PT429" || err?.status === 429) {
    return err.message || "Too many attempts. Please wait a few minutes and try again.";
  }
  console.error("[contact]", err);
  return fallback;
};

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
    const problem = validateMessage(form);
    if (problem) {
      toast({ title: problem, variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.from("contact_messages").insert({
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
      toast({
        title: "Could not send message",
        description: publicErrorMessage(err, "Something went wrong on our side. Please try again, or email us directly."),
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const subscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(subEmail.trim()) || subEmail.trim().length > LIMITS.email) {
      toast({ title: "Please enter a valid email address", variant: "destructive" });
      return;
    }
    if (subName.trim().length > LIMITS.name) {
      toast({ title: "That name is too long", variant: "destructive" });
      return;
    }
    setSubscribing(true);
    try {
      const { error } = await supabase.from("subscribers").insert({
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
      toast({
        title: "Could not subscribe",
        description: publicErrorMessage(err, "Something went wrong on our side. Please try again in a moment."),
        variant: "destructive",
      });
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
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Sizzling Spices</h1>
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
                    maxLength={LIMITS.name}
                    value={subName}
                    onChange={(e) => setSubName(e.target.value)}
                  />
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    maxLength={LIMITS.email}
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
                      <Input id="name" maxLength={LIMITS.name} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Your full name" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email *</Label>
                      <Input id="email" type="email" maxLength={LIMITS.email} value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="phone">Phone</Label>
                      <Input id="phone" maxLength={LIMITS.phone} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Optional" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="subject">Subject</Label>
                      <Input id="subject" maxLength={LIMITS.subject} value={form.subject} onChange={(e) => set("subject", e.target.value)} placeholder="What's this about?" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="message">Message *</Label>
                    <Textarea id="message" rows={5} maxLength={LIMITS.message} value={form.message} onChange={(e) => set("message", e.target.value)} placeholder="How can we help you?" />
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
