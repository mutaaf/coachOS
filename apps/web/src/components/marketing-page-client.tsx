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

  const pipeline = STAGES.filter((s) => s.value !== "lost").map((stage) => ({
    ...stage,
    leads: leads.filter((l) => l.stage === stage.value),
  }));

  async function handleAddLead(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await createLead(new FormData(e.currentTarget));
      toast.success("Lead added");
      setShowAddLead(false);
    } catch {
      toast.error("Failed to add lead");
    }
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
    try {
      await convertLeadToSchool(leadId);
      toast.success("Lead converted to school!");
      setShowActivity(false);
    } catch {
      toast.error("Failed to convert lead");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Marketing Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">{leads.length} leads total</p>
        </div>
        <Button onClick={() => setShowAddLead(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add Lead
        </Button>
      </div>

      {/* Kanban Board */}
      <div className="flex flex-col md:flex-row gap-4 md:overflow-x-auto pb-4">
        {pipeline.map((stage) => (
          <div key={stage.value} className="flex-shrink-0 md:w-64">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-sm">{stage.label}</h3>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {stage.leads.length}
              </span>
            </div>
            <div className="space-y-2">
              {stage.leads.map((lead) => (
                <div
                  key={lead.id}
                  className="rounded-xl border bg-card p-3 cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => openLeadDetail(lead)}
                >
                  <div className="font-medium text-sm">{lead.school_name}</div>
                  {lead.contact_name && (
                    <div className="text-xs text-muted-foreground mt-1">{lead.contact_name}</div>
                  )}
                  {lead.estimated_students && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Users className="h-3 w-3" /> ~{lead.estimated_students} students
                    </div>
                  )}
                  {lead.next_follow_up && (
                    <div className="text-xs mt-2">
                      <span className={`px-1.5 py-0.5 rounded ${new Date(lead.next_follow_up) < new Date() ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                        Follow up: {new Date(lead.next_follow_up).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
              ))}
              {stage.leads.length === 0 && (
                <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                  No leads
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Lead Dialog */}
      <Dialog open={showAddLead} onOpenChange={setShowAddLead}>
        <DialogContent onClose={() => setShowAddLead(false)}>
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
              <Input name="contact_email" type="email" />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input name="address" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Estimated Students</Label>
                <Input name="estimated_students" type="number" />
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
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowAddLead(false)}>Cancel</Button>
              <Button type="submit">Add Lead</Button>
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
                <div className="flex items-center justify-between">
                  <DialogTitle>{selectedLead.school_name}</DialogTitle>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setShowEditLead(true)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDeleteLead(selectedLead.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                {/* Lead Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  {selectedLead.contact_name && <div><span className="text-muted-foreground">Contact:</span> {selectedLead.contact_name}</div>}
                  {selectedLead.contact_phone && <div className="flex items-center gap-1"><Phone className="h-3 w-3" /> {selectedLead.contact_phone}</div>}
                  {selectedLead.contact_email && <div className="flex items-center gap-1"><Mail className="h-3 w-3" /> {selectedLead.contact_email}</div>}
                  {selectedLead.address && <div className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {selectedLead.address}</div>}
                </div>

                {/* Stage Selector */}
                <div className="space-y-2">
                  <Label className="text-xs">Stage</Label>
                  <div className="flex gap-1 flex-wrap">
                    {STAGES.map((s) => (
                      <button
                        key={s.value}
                        className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                          selectedLead.stage === s.value ? s.color + " font-medium" : "bg-muted text-muted-foreground hover:bg-muted/80"
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
                  <Button variant="outline" size="sm" className="w-full" onClick={() => handleConvert(selectedLead.id)}>
                    <CheckCircle className="h-4 w-4 mr-2" /> Convert to School
                  </Button>
                )}

                {/* Add Activity */}
                <form onSubmit={handleAddActivity} className="space-y-2 pt-2 border-t">
                  <Label className="text-xs">Log Activity</Label>
                  <div className="flex gap-2">
                    <Select
                      name="type"
                      options={[
                        { value: "note", label: "Note" },
                        { value: "call", label: "Call" },
                        { value: "email", label: "Email" },
                        { value: "meeting", label: "Meeting" },
                      ]}
                      className="w-28"
                    />
                    <Input name="description" placeholder="Description..." className="flex-1" required />
                    <Button type="submit" size="sm">Add</Button>
                  </div>
                </form>

                {/* Activity Timeline */}
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {activities.map((a) => (
                    <div key={a.id} className="flex gap-3 text-sm">
                      <div className="flex-shrink-0 w-16 text-xs text-muted-foreground pt-0.5">
                        {new Date(a.created_at).toLocaleDateString()}
                      </div>
                      <div>
                        <Badge variant="secondary" className="text-xs mb-0.5">{a.type}</Badge>
                        <p className="text-sm">{a.description}</p>
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
        <DialogContent onClose={() => setShowEditLead(false)}>
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
                <Input name="contact_email" type="email" defaultValue={selectedLead.contact_email || ""} />
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Input name="address" defaultValue={selectedLead.address || ""} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Estimated Students</Label>
                  <Input name="estimated_students" type="number" defaultValue={selectedLead.estimated_students || ""} />
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
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setShowEditLead(false)}>Cancel</Button>
                <Button type="submit">Update Lead</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
