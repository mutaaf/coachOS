"use client";

import { useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { sendBulkMessages, createMessageTemplate, updateMessageTemplate, deleteMessageTemplate, fetchRecipients } from "@/lib/actions/messages";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatPhone } from "@/lib/utils";
import { MessageSquare, Send, Users, Plus, Pencil, Trash2, Eye } from "lucide-react";
import type { MessageTemplate } from "@/types/database";
import { OutboxPanel } from "@/components/outbox-panel";
import { initialSelection, recipientReducer, sendableRecipients, type RecipientMode } from "@/lib/recipient-selection";
import { COMPOSE_VARIABLES, composeFirstName, composeProblem, renderComposed } from "@/lib/compose-message";

// What the automatic messages can fill in, listed for her while she writes a template.
const TEMPLATE_VARIABLES = ["parent_name", "student_name", "program_name", "school_name", "amount", "date", "time", "month", "schedule", "payment_method", "reason"];

interface MessagingPageClientProps {
  templates: MessageTemplate[];
  log: any[];
  stats: { totalSent: number; pendingCount: number; failedCount: number };
  schools: any[];
  programs: any[];
  outbox: { waiting: any[]; done: any[] };
  initialTab?: string;
}

export function MessagingPageClient({ templates, log, stats, schools, programs, outbox, initialTab }: MessagingPageClientProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selection, dispatch] = useReducer(recipientReducer, initialSelection);
  const { mode: recipientMode, selectedId: selectedSchoolOrProgram } = selection;
  // Only the parents loaded for the group on screen; empty while a new one loads.
  const recipients = sendableRecipients(selection);
  const [sending, setSending] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [tab, setTab] = useState(initialTab ?? (outbox.waiting.length > 0 ? "outbox" : "compose"));
  const problem = message ? composeProblem(message) : null;

  async function chooseMode(mode: RecipientMode) {
    dispatch({ type: "mode", mode });
    if (mode === "all") dispatch({ type: "loaded", key: "all", recipients: await fetchRecipients("all") });
  }

  async function chooseGroup(mode: RecipientMode, id: string) {
    dispatch({ type: "select", id });
    if (!id) return;
    dispatch({ type: "loaded", key: `${mode}:${id}`, recipients: await fetchRecipients(mode, id) });
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
      if ("error" in result && result.error) {
        toast.error("Not sent", { description: result.error });
        return;
      }
      toast.success(`${(result as { count: number }).count} message(s) ready in the Outbox`);
      setMessage("");
      dispatch({ type: "clear" });
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

  const tabTrigger = "h-10 px-3 sm:h-8";
  const statusVariant = (status: string) =>
    status === "sent" || status === "delivered" ? "success" : status === "failed" ? "destructive" : "secondary";
  const when = (iso: string) => format(new Date(iso), "MMM d, h:mm a");

  return (
    <div>
      <div className="mb-5 sm:mb-6">
        <h1 className="text-2xl font-bold">Messaging</h1>
        <div className="mt-1 flex gap-4 text-sm tabular-nums text-muted-foreground">
          <span>{stats.totalSent} sent</span>
          <span>{stats.pendingCount} pending</span>
          {stats.failedCount > 0 && <span className="text-red-600">{stats.failedCount} failed</span>}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} defaultValue={tab}>
        {/* Scrolls sideways inside itself on a narrow phone instead of wrapping. */}
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <div data-tour="messaging-tabs" className="w-fit">
            <TabsList className="h-12 sm:h-10">
              <TabsTrigger value="outbox" className={tabTrigger}>
                Outbox{outbox.waiting.length > 0 ? ` (${outbox.waiting.length})` : ""}
              </TabsTrigger>
              <TabsTrigger value="compose" className={tabTrigger}>Compose</TabsTrigger>
              <TabsTrigger value="templates" className={tabTrigger}>Templates</TabsTrigger>
              <TabsTrigger value="history" className={tabTrigger}>History</TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="outbox" className="mt-4">
          <OutboxPanel waiting={outbox.waiting} done={outbox.done} onCompose={() => setTab("compose")} />
        </TabsContent>

        <TabsContent value="compose" className="mt-4">
          <div className="space-y-4">
            {/* Recipient Selection */}
            <div className="rounded-2xl border bg-card p-4 space-y-3">
              <h3 className="font-medium text-sm flex items-center gap-2"><Users className="h-4 w-4" /> Recipients</h3>
              <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                <Button
                  size="sm"
                  className={modeButton}
                  variant={recipientMode === "all" ? "default" : "outline"}
                  onClick={() => chooseMode("all")}
                >
                  All Parents
                </Button>
                <Button
                  size="sm"
                  className={modeButton}
                  variant={recipientMode === "school" ? "default" : "outline"}
                  onClick={() => chooseMode("school")}
                >
                  By School
                </Button>
                <Button
                  size="sm"
                  className={modeButton}
                  variant={recipientMode === "program" ? "default" : "outline"}
                  onClick={() => chooseMode("program")}
                >
                  By Session
                </Button>
              </div>
              {recipientMode === "school" && (
                <Select
                  className={field}
                  placeholder="Select a school"
                  options={schools.map((s: any) => ({ value: s.id, label: s.name }))}
                  value={selectedSchoolOrProgram}
                  onChange={(e) => chooseGroup("school", e.target.value)}
                />
              )}
              {recipientMode === "program" && (
                <Select
                  className={field}
                  placeholder="Select a session"
                  options={programs.map((p: any) => ({ value: p.id, label: `${p.school?.name ?? ""} — ${p.name}` }))}
                  value={selectedSchoolOrProgram}
                  onChange={(e) => chooseGroup("program", e.target.value)}
                />
              )}
              {recipients.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {recipients.slice(0, 10).map((r, i) => (
                    <span key={i} className="max-w-full truncate text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">{r.name}</span>
                  ))}
                  {recipients.length > 10 && (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground tabular-nums">+{recipients.length - 10} more</span>
                  )}
                </div>
              )}
            </div>

            {/* Message Composition */}
            <div className="rounded-2xl border bg-card p-4 space-y-3">
              <h3 className="font-medium text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Message</h3>
              <Select
                className={field}
                placeholder="Use a template..."
                options={templates.map((t) => ({ value: t.id, label: `${t.name} (${t.category})` }))}
                value={selectedTemplate}
                onChange={(e) => handleTemplateSelect(e.target.value)}
              />
              <Textarea
                className="text-base sm:text-sm"
                placeholder="Type your message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
              />
              {/* One sideways-scrolling row on a phone; wraps where there is room. */}
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:gap-1.5 sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
                {COMPOSE_VARIABLES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-lg bg-muted px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/80 active:bg-muted/70 sm:h-7 sm:rounded-md sm:px-2"
                    onClick={() => setMessage((m) => m + `{{${v}}}`)}
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
              {message && (
                <div data-testid="compose-preview" className="rounded-xl border bg-muted/40 p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    What {recipients[0] ? composeFirstName(recipients[0].name) : "a parent"} will get
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{renderComposed(message, recipients[0]?.name)}</p>
                  {problem && <p role="alert" className="mt-2 text-sm text-red-600">{problem}</p>}
                </div>
              )}
            </div>

            {/* Sticks to the bottom of the screen on a phone so Send is always under her thumb. */}
            <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
              <span className="text-sm tabular-nums text-muted-foreground">{recipients.length} recipient(s)</span>
              <Button className="h-11 w-full sm:h-10 sm:w-auto" onClick={handleSend} disabled={sending || recipients.length === 0 || !message || !!problem}>
                <Send className="h-4 w-4 mr-2" />
                {sending ? "Sending..." : `Send to ${recipients.length} recipient(s)`}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">Messages you send often, ready to use in Compose.</p>
            <Button className="h-11 w-full sm:h-10 sm:w-auto" onClick={() => setShowTemplateForm(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add Template
            </Button>
          </div>
          {templates.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
              No templates yet. Add one for a message you send often — a reminder, a welcome, a payment nudge.
            </div>
          ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {templates.map((tmpl) => (
              <div key={tmpl.id} className="flex flex-col rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 font-medium leading-snug [overflow-wrap:anywhere]">{tmpl.name}</h3>
                  <Badge variant="secondary" className="shrink-0">{tmpl.category}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground line-clamp-3 [overflow-wrap:anywhere]">{tmpl.body}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {tmpl.variables.map((v) => (
                    <span key={v} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{`{{${v}}}`}</span>
                  ))}
                </div>
                <div className="mt-auto grid grid-cols-3 gap-2 pt-3 sm:flex">
                  <Button variant="ghost" className={templateAction} onClick={() => { setMessage(tmpl.body); setTab("compose"); }}>
                    <Eye className="h-4 w-4 mr-1.5 sm:h-3.5 sm:w-3.5 sm:mr-1" /> Use
                  </Button>
                  <Button variant="ghost" className={templateAction} onClick={() => { setEditingTemplate(tmpl); setShowTemplateForm(true); }}>
                    <Pencil className="h-4 w-4 mr-1.5 sm:h-3.5 sm:w-3.5 sm:mr-1" /> Edit
                  </Button>
                  <Button variant="ghost" className={`${templateAction} text-red-600 hover:text-red-700`} onClick={async () => {
                    if (!window.confirm(`Delete the "${tmpl.name}" template?`)) return;
                    try {
                      await deleteMessageTemplate(tmpl.id);
                      toast.success("Template deleted");
                      router.refresh();
                    } catch (err) {
                      toast.error("Not deleted", { description: err instanceof Error ? err.message : undefined });
                    }
                  }}>
                    <Trash2 className="h-4 w-4 mr-1.5 sm:h-3.5 sm:w-3.5 sm:mr-1" /> Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
          )}

          <Dialog open={showTemplateForm} onOpenChange={(open) => { setShowTemplateForm(open); if (!open) setEditingTemplate(null); }}>
            <DialogContent className="p-5 sm:p-6" onClose={() => { setShowTemplateForm(false); setEditingTemplate(null); }}>
              <DialogHeader><DialogTitle>{editingTemplate ? "Edit Template" : "New Template"}</DialogTitle></DialogHeader>
              <form onSubmit={handleCreateTemplate} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <label htmlFor="template-name" className="text-sm font-medium">Name *</label>
                  <input id="template-name" name="name" required defaultValue={editingTemplate?.name || ""} key={editingTemplate?.id || "new"} className="flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-base sm:h-10 sm:text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Category *</label>
                  <Select className={field} name="category" defaultValue={editingTemplate?.category || "reminder"} key={`cat-${editingTemplate?.id || "new"}`} options={[
                    { value: "reminder", label: "Reminder" },
                    { value: "payment", label: "Payment" },
                    { value: "welcome", label: "Welcome" },
                    { value: "cancellation", label: "Cancellation" },
                    { value: "general", label: "General" },
                  ]} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Message Body *</label>
                  <Textarea className="text-base sm:text-sm" name="body" required rows={5} placeholder="Hi {{parent_name}}, ..." defaultValue={editingTemplate?.body || ""} key={`body-${editingTemplate?.id || "new"}`} />
                  <div className="flex flex-wrap gap-1">
                    {TEMPLATE_VARIABLES.map((v) => (
                      <span key={v} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground cursor-default">{`{{${v}}}`}</span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end sm:gap-3">
                  <Button type="button" variant="outline" className="h-11 w-full sm:h-10 sm:w-auto" onClick={() => { setShowTemplateForm(false); setEditingTemplate(null); }}>Cancel</Button>
                  <Button type="submit" className="h-11 w-full sm:h-10 sm:w-auto">{editingTemplate ? "Update Template" : "Create Template"}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {log.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-lg font-medium mb-1">No messages sent yet</h3>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                Every message you send from the Outbox is listed here, so you can see who has heard from you.
              </p>
            </div>
          ) : (
            <>
              {/* Phones: one card per message. */}
              <ul className="space-y-2 md:hidden">
                {log.map((entry: any) => (
                  <li key={entry.id} className="rounded-2xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 font-medium leading-snug [overflow-wrap:anywhere]">
                        {entry.recipient_name || formatPhone(entry.recipient_phone)}
                      </p>
                      <Badge variant={statusVariant(entry.status)} className="shrink-0">{entry.status}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{when(entry.sent_at)}</p>
                    <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{entry.message}</p>
                  </li>
                ))}
              </ul>

              <div className="hidden rounded-2xl border bg-card overflow-x-auto md:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-4 text-sm font-medium text-muted-foreground">Time</th>
                      <th className="text-left p-4 text-sm font-medium text-muted-foreground">Recipient</th>
                      <th className="text-left p-4 text-sm font-medium text-muted-foreground">Message</th>
                      <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((entry: any) => (
                      <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="p-4 text-sm whitespace-nowrap tabular-nums">{when(entry.sent_at)}</td>
                        <td className="p-4 text-sm font-medium">{entry.recipient_name || formatPhone(entry.recipient_phone)}</td>
                        <td className="p-4 text-sm text-muted-foreground max-w-xs truncate">{entry.message}</td>
                        <td className="p-4">
                          <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

const field = "h-11 text-base sm:h-10 sm:text-sm";
const modeButton = "h-11 px-2 sm:h-9 sm:px-3";
const templateAction = "h-11 px-2 sm:h-9 sm:px-3";
