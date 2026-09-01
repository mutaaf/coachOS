"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { sendBulkMessages, createMessageTemplate, updateMessageTemplate, deleteMessageTemplate, retryFailedMessage, fetchRecipients } from "@/lib/actions/messages";
import { toast } from "sonner";
import { MessageSquare, Send, Users, Plus, Pencil, Trash2, RefreshCw, CheckCircle, XCircle, Clock, Eye } from "lucide-react";
import type { MessageTemplate } from "@/types/database";

const VARIABLES = ["parent_name", "student_name", "program_name", "school_name", "amount", "date", "time", "month", "schedule", "payment_method", "reason"];

interface MessagingPageClientProps {
  templates: MessageTemplate[];
  log: any[];
  stats: { totalSent: number; pendingCount: number; failedCount: number };
  schools: any[];
  programs: any[];
}

export function MessagingPageClient({ templates, log, stats, schools, programs }: MessagingPageClientProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [recipients, setRecipients] = useState<{ phone: string; name: string }[]>([]);
  const [recipientMode, setRecipientMode] = useState<"all" | "school" | "program">("all");
  const [selectedSchoolOrProgram, setSelectedSchoolOrProgram] = useState("");
  const [sending, setSending] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);

  async function loadRecipients(mode: string, id?: string) {
    const data = await fetchRecipients(mode as "all" | "school" | "program", id);
    setRecipients(data);
  }

  function handleTemplateSelect(templateId: string) {
    setSelectedTemplate(templateId);
    const tmpl = templates.find((t) => t.id === templateId);
    if (tmpl) setMessage(tmpl.body);
  }

  async function handleSend() {
    if (!message || recipients.length === 0) {
      toast.error("Please select recipients and write a message");
      return;
    }
    setSending(true);
    try {
      const result = await sendBulkMessages(recipients, message, selectedTemplate || undefined);
      toast.success(`${result.count} message(s) queued for sending`);
      setMessage("");
      setRecipients([]);
    } catch {
      toast.error("Failed to queue messages");
    } finally {
      setSending(false);
    }
  }

  async function handleCreateTemplate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      if (editingTemplate) {
        await updateMessageTemplate(editingTemplate.id, formData);
        toast.success("Template updated");
      } else {
        await createMessageTemplate(formData);
        toast.success("Template created");
      }
      setShowTemplateForm(false);
      setEditingTemplate(null);
      router.refresh();
    } catch {
      toast.error(editingTemplate ? "Failed to update template" : "Failed to create template");
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Messaging</h1>
          <div className="flex gap-4 mt-1 text-sm text-muted-foreground">
            <span>{stats.totalSent} sent</span>
            <span>{stats.pendingCount} pending</span>
            {stats.failedCount > 0 && <span className="text-red-600">{stats.failedCount} failed</span>}
          </div>
        </div>
      </div>

      <Tabs defaultValue="compose">
        <TabsList>
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="compose">
          <div className="space-y-4">
            {/* Recipient Selection */}
            <div className="rounded-2xl border bg-card p-4 space-y-3">
              <h3 className="font-medium text-sm flex items-center gap-2"><Users className="h-4 w-4" /> Recipients</h3>
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant={recipientMode === "all" ? "default" : "outline"}
                  onClick={() => { setRecipientMode("all"); loadRecipients("all"); }}
                >
                  All Parents
                </Button>
                <Button
                  size="sm"
                  variant={recipientMode === "school" ? "default" : "outline"}
                  onClick={() => setRecipientMode("school")}
                >
                  By School
                </Button>
                <Button
                  size="sm"
                  variant={recipientMode === "program" ? "default" : "outline"}
                  onClick={() => setRecipientMode("program")}
                >
                  By Program
                </Button>
              </div>
              {recipientMode === "school" && (
                <Select
                  placeholder="Select a school"
                  options={schools.map((s: any) => ({ value: s.id, label: s.name }))}
                  value={selectedSchoolOrProgram}
                  onChange={(e) => { setSelectedSchoolOrProgram(e.target.value); loadRecipients("school", e.target.value); }}
                />
              )}
              {recipientMode === "program" && (
                <Select
                  placeholder="Select a program"
                  options={programs.map((p: any) => ({ value: p.id, label: `${p.school?.name ?? ""} — ${p.name}` }))}
                  value={selectedSchoolOrProgram}
                  onChange={(e) => { setSelectedSchoolOrProgram(e.target.value); loadRecipients("program", e.target.value); }}
                />
              )}
              {recipients.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {recipients.slice(0, 10).map((r, i) => (
                    <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">{r.name}</span>
                  ))}
                  {recipients.length > 10 && (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground">+{recipients.length - 10} more</span>
                  )}
                </div>
              )}
            </div>

            {/* Message Composition */}
            <div className="rounded-2xl border bg-card p-4 space-y-3">
              <h3 className="font-medium text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Message</h3>
              <Select
                placeholder="Use a template..."
                options={templates.map((t) => ({ value: t.id, label: `${t.name} (${t.category})` }))}
                value={selectedTemplate}
                onChange={(e) => handleTemplateSelect(e.target.value)}
              />
              <Textarea
                placeholder="Type your message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
              />
              <div className="flex flex-wrap gap-1.5">
                {VARIABLES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="text-xs px-2 py-1 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                    onClick={() => setMessage((m) => m + `{{${v}}}`)}
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{recipients.length} recipient(s)</span>
              <Button onClick={handleSend} disabled={sending || recipients.length === 0 || !message}>
                <Send className="h-4 w-4 mr-2" />
                {sending ? "Sending..." : `Send to ${recipients.length} recipient(s)`}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="templates">
          <div className="flex justify-end mb-4">
            <Button onClick={() => setShowTemplateForm(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add Template
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {templates.map((tmpl) => (
              <div key={tmpl.id} className="rounded-2xl border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{tmpl.name}</h3>
                  <Badge variant="secondary">{tmpl.category}</Badge>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-3">{tmpl.body}</p>
                <div className="flex flex-wrap gap-1">
                  {tmpl.variables.map((v) => (
                    <span key={v} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{`{{${v}}}`}</span>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="ghost" onClick={() => { setMessage(tmpl.body); }}>
                    <Eye className="h-3.5 w-3.5 mr-1" /> Use
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingTemplate(tmpl); setShowTemplateForm(true); }}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => {
                    try {
                      await deleteMessageTemplate(tmpl.id);
                      toast.success("Template deleted");
                      router.refresh();
                    } catch {
                      toast.error("Failed to delete template");
                    }
                  }}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <Dialog open={showTemplateForm} onOpenChange={(open) => { setShowTemplateForm(open); if (!open) setEditingTemplate(null); }}>
            <DialogContent onClose={() => { setShowTemplateForm(false); setEditingTemplate(null); }}>
              <DialogHeader><DialogTitle>{editingTemplate ? "Edit Template" : "New Template"}</DialogTitle></DialogHeader>
              <form onSubmit={handleCreateTemplate} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name *</label>
                  <input name="name" required defaultValue={editingTemplate?.name || ""} key={editingTemplate?.id || "new"} className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Category *</label>
                  <Select name="category" defaultValue={editingTemplate?.category || "reminder"} key={`cat-${editingTemplate?.id || "new"}`} options={[
                    { value: "reminder", label: "Reminder" },
                    { value: "payment", label: "Payment" },
                    { value: "welcome", label: "Welcome" },
                    { value: "cancellation", label: "Cancellation" },
                    { value: "general", label: "General" },
                  ]} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Message Body *</label>
                  <Textarea name="body" required rows={4} placeholder="Hi {{parent_name}}, ..." defaultValue={editingTemplate?.body || ""} key={`body-${editingTemplate?.id || "new"}`} />
                  <div className="flex flex-wrap gap-1">
                    {VARIABLES.map((v) => (
                      <span key={v} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground cursor-default">{`{{${v}}}`}</span>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" variant="outline" onClick={() => { setShowTemplateForm(false); setEditingTemplate(null); }}>Cancel</Button>
                  <Button type="submit">{editingTemplate ? "Update Template" : "Create Template"}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="history">
          {log.length === 0 ? (
            <div className="text-center py-16">
              <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No messages sent yet</h3>
            </div>
          ) : (
            <div className="rounded-2xl border bg-card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Time</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Recipient</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden md:table-cell">Message</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((entry: any) => (
                    <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-4 text-sm">{new Date(entry.sent_at).toLocaleString()}</td>
                      <td className="p-4 text-sm font-medium">{entry.recipient_name || entry.recipient_phone}</td>
                      <td className="p-4 text-sm text-muted-foreground hidden md:table-cell max-w-xs truncate">{entry.message}</td>
                      <td className="p-4">
                        <Badge variant={
                          entry.status === "sent" || entry.status === "delivered" ? "success" :
                          entry.status === "failed" ? "destructive" : "secondary"
                        }>
                          {entry.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
