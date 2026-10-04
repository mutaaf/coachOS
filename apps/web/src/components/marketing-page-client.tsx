"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createLead, updateLead, updateLeadStage, addLeadActivity, convertLeadToSchool, deleteLead, fetchLeadActivities } from "@/lib/actions/leads";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Target, Plus, Phone, Mail, MapPin, Users, ArrowRight, MessageSquare, CheckCircle, Pencil, Trash2 } from "lucide-react";
import type { Lead } from "@/types/database";
import { formatDateOnly, isPastDue } from "@/lib/dates";
import { useAction } from "@/lib/use-action";

const STAGES = [
  { value: "identified", label: "Identified", color: "bg-gray-100 text-gray-700" },
  { value: "contacted", label: "Contacted", color: "bg-blue-100 text-blue-700" },
  { value: "meeting", label: "Meeting", color: "bg-purple-100 text-purple-700" },
  { value: "proposal", label: "Proposal", color: "bg-orange-100 text-orange-700" },
  { value: "signed", label: "Signed", color: "bg-green-100 text-green-700" },
  { value: "lost", label: "Lost", color: "bg-red-100 text-red-700" },
];

interface MarketingPageClientProps {
  leads: Lead[];
}

export function MarketingPageClient({ leads }: MarketingPageClientProps) {
  const router = useRouter();
  const [showAddLead, setShowAddLead] = useState(false);
  const [showEditLead, setShowEditLead] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [activities, setActivities] = useState<any[]>([]);
  // Phones show one stage at a time (or all of them), picked from a row of chips.
  const [stageFilter, setStageFilter] = useState<string>("all");

  const pipeline = STAGES.filter((s) => s.value !== "lost").map((stage) => ({
    ...stage,
    leads: leads.filter((l) => l.stage === stage.value),
  }));

  // One at a time: a double tap on Add Lead or Convert used to make two.
  const { run, pending } = useAction();

  async function handleAddLead(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const ok = await run(() => createLead(formData), { success: "Lead added", error: "The lead wasn't added" });
    if (ok) setShowAddLead(false);
  }

  async function handleStageChange(leadId: string, newStage: string) {
    try {
      await updateLeadStage(leadId, newStage);
      toast.success(`Stage updated to ${newStage}`);
    } catch {
      toast.error("Failed to update stage");
    }
  }

  async function openLeadDetail(lead: Lead) {
    setSelectedLead(lead);
    setShowActivity(true);
    const data = await fetchLeadActivities(lead.id);
    setActivities(data);
  }

  async function handleAddActivity(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedLead) return;
    try {
      await addLeadActivity(selectedLead.id, new FormData(e.currentTarget));
      toast.success("Activity logged");
      const data = await fetchLeadActivities(selectedLead.id);
      setActivities(data);
    } catch {
      toast.error("Failed to log activity");
    }
  }

  async function handleEditLead(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedLead) return;
    try {
      await updateLead(selectedLead.id, new FormData(e.currentTarget));
      toast.success("Lead updated");
      setShowEditLead(false);
      router.refresh();
    } catch {
      toast.error("Failed to update lead");
    }
  }

  async function handleDeleteLead(leadId: string) {
    if (!window.confirm("Delete this lead and all its activities?")) return;
    try {
      await deleteLead(leadId);
      toast.success("Lead deleted");
      setShowActivity(false);
      setSelectedLead(null);
      router.refresh();
    } catch {
      toast.error("Failed to delete lead");
    }
  }

  async function handleConvert(leadId: string) {
    const ok = await run(() => convertLeadToSchool(leadId), {
      success: "Lead converted to school!",
      error: "The lead wasn't converted",
    });
    if (ok) setShowActivity(false);
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Marketing Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">{leads.length} leads total</p>
        </div>
        <Button className="h-11 w-full sm:h-10 sm:w-auto" onClick={() => setShowAddLead(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add Lead
        </Button>
      </div>

      {/* Stage picker (phones): one row that scrolls sideways */}
      <div
        className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Show stage"
      >
        {[
          { value: "all", label: "All", count: pipeline.reduce((n, st) => n + st.leads.length, 0) },
          ...pipeline.map((st) => ({ value: st.value, label: st.label, count: st.leads.length })),
        ].map((chip) => (
          <button
            key={chip.value}
            type="button"
            aria-pressed={stageFilter === chip.value}
            onClick={() => setStageFilter(chip.value)}
            className={`inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium ${
              stageFilter === chip.value ? "border-foreground bg-foreground text-background" : "bg-white text-foreground"
            }`}
          >
            {chip.label}
            <span className={`tabular-nums text-xs ${stageFilter === chip.value ? "opacity-80" : "text-muted-foreground"}`}>
              {chip.count}
            </span>
          </button>
        ))}
      </div>

      {/* Kanban Board */}
      <div className="flex flex-col md:flex-row gap-4 md:overflow-x-auto pb-4">
        {pipeline.map((stage) => (
          <div
            key={stage.value}
            className={`flex-shrink-0 md:block md:w-64 ${stageFilter === "all" || stageFilter === stage.value ? "" : "hidden"}`}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-sm">{stage.label}</h3>
              <span className="text-xs tabular-nums text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {stage.leads.length}
              </span>
            </div>
            <div className="space-y-2">
              {stage.leads.map((lead) => (
                <div
                  key={lead.id}
                  role="button"
                  tabIndex={0}
                  className="min-h-11 rounded-xl border bg-card p-3 cursor-pointer hover:shadow-md transition-shadow active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => openLeadDetail(lead)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openLeadDetail(lead);
                    }
                  }}
                >
                  <div className="font-medium text-sm break-words">{lead.school_name}</div>
                  {lead.contact_name && (
                    <div className="text-xs text-muted-foreground mt-1 truncate">{lead.contact_name}</div>
                  )}
                  {lead.estimated_students && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Users className="h-3 w-3" /> ~{lead.estimated_students} students
                    </div>
                  )}
                  {lead.next_follow_up && (
                    <div className="text-xs mt-2">
                      <span className={`px-1.5 py-0.5 rounded ${isPastDue(lead.next_follow_up) ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                        Follow up: {formatDateOnly(lead.next_follow_up)}
                      </span>
                    </div>
                  )}
                </div>
              ))}
              {stage.leads.length === 0 && (
                <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                  No leads
                  {stageFilter === stage.value && (
                    <span className="mt-1 block">Move a lead here from its details, or tap Add Lead.</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Lead Dialog */}
      <Dialog open={showAddLead} onOpenChange={setShowAddLead}>
        <DialogContent onClose={() => setShowAddLead(false)} className="pb-0">
          <DialogHeader><DialogTitle>Add Lead</DialogTitle></DialogHeader>
          <form onSubmit={handleAddLead} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>School Name *</Label>
              <Input name="school_name" required />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Contact Name</Label>
                <Input name="contact_name" />
              </div>
              <div className="space-y-2">
                <Label>Contact Phone</Label>
                <Input name="contact_phone" type="tel" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Contact Email</Label>
              <Input name="contact_email" type="email" inputMode="email" />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input name="address" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Estimated Students</Label>
                <Input name="estimated_students" type="number" inputMode="numeric" />
              </div>
              <div className="space-y-2">
                <Label>Next Follow-up</Label>
                <Input name="next_follow_up" type="date" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea name="notes" />
            </div>
            <div className="sticky bottom-0 -mx-6 flex gap-2 border-t bg-background px-6 py-4 sm:justify-end sm:gap-3">
              <Button type="button" variant="outline" className="h-11 flex-1 sm:h-10 sm:flex-none" onClick={() => setShowAddLead(false)}>Cancel</Button>
              <Button type="submit" className="h-11 flex-1 sm:h-10 sm:flex-none" disabled={pending}>{pending ? "Adding..." : "Add Lead"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Lead Detail / Activity Dialog */}
      <Dialog open={showActivity} onOpenChange={(open) => { setShowActivity(open); if (!open) setSelectedLead(null); }}>
        <DialogContent onClose={() => setShowActivity(false)} className="max-w-lg">
          {selectedLead && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between gap-2 pr-8 text-left">
                  <DialogTitle className="min-w-0 break-words pt-2.5 leading-snug">{selectedLead.school_name}</DialogTitle>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="ghost" size="icon" aria-label="Edit lead" className="h-11 w-11" onClick={() => setShowEditLead(true)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete lead"
                      className="h-11 w-11 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteLead(selectedLead.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                {/* Lead Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {selectedLead.contact_name && (
                    <div className="flex min-h-10 items-center break-words">
                      <span className="text-muted-foreground mr-1">Contact:</span> {selectedLead.contact_name}
                    </div>
                  )}
                  {selectedLead.contact_phone && (
                    <a href={`tel:${selectedLead.contact_phone}`} className="flex min-h-10 items-center gap-2 text-primary hover:underline">
                      <Phone className="h-4 w-4 shrink-0" /> <span className="tabular-nums">{selectedLead.contact_phone}</span>
                    </a>
                  )}
                  {selectedLead.contact_email && (
                    <a href={`mailto:${selectedLead.contact_email}`} className="flex min-h-10 min-w-0 items-center gap-2 text-primary hover:underline">
                      <Mail className="h-4 w-4 shrink-0" /> <span className="min-w-0 break-all">{selectedLead.contact_email}</span>
                    </a>
                  )}
                  {selectedLead.address && (
                    <div className="flex min-h-10 items-center gap-2 break-words">
                      <MapPin className="h-4 w-4 shrink-0" /> {selectedLead.address}
                    </div>
                  )}
                </div>

                {/* Stage Selector */}
                <div className="space-y-2">
                  <Label className="text-xs">Stage</Label>
                  <div className="flex flex-wrap gap-2">
                    {STAGES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        aria-pressed={selectedLead.stage === s.value}
                        className={`h-10 text-sm px-3.5 rounded-full transition-colors ${
                          selectedLead.stage === s.value ? s.color + " font-semibold ring-2 ring-inset ring-current" : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                        onClick={() => handleStageChange(selectedLead.id, s.value)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Convert Button */}
                {selectedLead.stage !== "signed" && selectedLead.stage !== "lost" && (
                  <Button variant="outline" className="h-11 w-full" disabled={pending} onClick={() => handleConvert(selectedLead.id)}>
                    <CheckCircle className="h-4 w-4 mr-2" /> Convert to School
                  </Button>
                )}

                {/* Add Activity */}
                <form onSubmit={handleAddActivity} className="space-y-2 pt-2 border-t">
                  <Label className="text-xs">Log Activity</Label>
                  <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                    <Select
                      name="type"
                      options={[
                        { value: "note", label: "Note" },
                        { value: "call", label: "Call" },
                        { value: "email", label: "Email" },
                        { value: "meeting", label: "Meeting" },
                      ]}
                      className="h-11 w-28 shrink-0"
                    />
                    <Input name="description" placeholder="Description..." className="h-11 min-w-0 flex-1" required />
                    <Button type="submit" className="h-11 w-full sm:w-auto">Add</Button>
                  </div>
                </form>

                {/* Activity Timeline */}
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {activities.map((a) => (
                    <div key={a.id} className="flex gap-3 text-sm">
                      <div className="flex-shrink-0 w-20 text-xs tabular-nums text-muted-foreground pt-0.5">
                        {new Date(a.created_at).toLocaleDateString()}
                      </div>
                      <div className="min-w-0">
                        <Badge variant="secondary" className="text-xs mb-0.5">{a.type}</Badge>
                        <p className="text-sm break-words">{a.description}</p>
                      </div>
                    </div>
                  ))}
                  {activities.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">No activities yet</p>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Lead Dialog */}
      <Dialog open={showEditLead} onOpenChange={setShowEditLead}>
        <DialogContent onClose={() => setShowEditLead(false)} className="pb-0">
          <DialogHeader><DialogTitle>Edit Lead</DialogTitle></DialogHeader>
          {selectedLead && (
            <form onSubmit={handleEditLead} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>School Name *</Label>
                <Input name="school_name" required defaultValue={selectedLead.school_name} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Contact Name</Label>
                  <Input name="contact_name" defaultValue={selectedLead.contact_name || ""} />
                </div>
                <div className="space-y-2">
                  <Label>Contact Phone</Label>
                  <Input name="contact_phone" type="tel" defaultValue={selectedLead.contact_phone || ""} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Contact Email</Label>
                <Input name="contact_email" type="email" inputMode="email" defaultValue={selectedLead.contact_email || ""} />
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Input name="address" defaultValue={selectedLead.address || ""} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Estimated Students</Label>
                  <Input name="estimated_students" type="number" inputMode="numeric" defaultValue={selectedLead.estimated_students || ""} />
                </div>
                <div className="space-y-2">
                  <Label>Next Follow-up</Label>
                  <Input name="next_follow_up" type="date" defaultValue={selectedLead.next_follow_up || ""} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea name="notes" defaultValue={selectedLead.notes || ""} />
              </div>
              <div className="sticky bottom-0 -mx-6 flex gap-2 border-t bg-background px-6 py-4 sm:justify-end sm:gap-3">
                <Button type="button" variant="outline" className="h-11 flex-1 sm:h-10 sm:flex-none" onClick={() => setShowEditLead(false)}>Cancel</Button>
                <Button type="submit" className="h-11 flex-1 sm:h-10 sm:flex-none">Update Lead</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
