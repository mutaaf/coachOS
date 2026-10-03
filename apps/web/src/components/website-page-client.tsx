"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/lib/use-action";
import {
  deleteListing,
  deletePartnership,
  deleteTestimonial,
  saveListing,
  savePartnership,
  saveTestimonial,
  uploadWebsiteImage,
} from "@/lib/actions/website";
import {
  AGE_GROUPS,
  SITE_URL,
  dateRangeText,
  imageUrl,
  listingFromProgram,
  staleness,
  type Listing,
  type ProgramForListing,
} from "@/lib/website";
import type { Partnership, Testimonial } from "@/lib/queries/website";
import { AlertTriangle, ExternalLink, ImagePlus, Link2, Pencil, Plus, Star, Trash2 } from "lucide-react";

/**
 * Website: what parents see at risingstars.training, edited here. Saves are
 * live on the site at once — there's no publish step.
 */
export function WebsitePageClient(props: {
  listings: Listing[];
  testimonials: Testimonial[];
  partnerships: Partnership[];
  programs: ProgramForListing[];
  today: string;
}) {
  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Website</h1>
          <p className="text-muted-foreground">
            What parents see at risingstars.training. Changes are on the site as soon as you save.
          </p>
        </div>
        <a
          href={SITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-2 self-start rounded-lg border bg-white px-3 text-sm font-medium hover:bg-muted"
        >
          Open the website <ExternalLink className="h-4 w-4" />
        </a>
      </div>
      <Tabs defaultValue="programs">
        <div className="mb-4 overflow-x-auto">
          <TabsList data-tour="website-tabs">
            <TabsTrigger value="programs">Programs ({props.listings.length})</TabsTrigger>
            <TabsTrigger value="testimonials">Testimonials ({props.testimonials.length})</TabsTrigger>
            <TabsTrigger value="partnerships">Partnerships ({props.partnerships.length})</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="programs">
          <Listings listings={props.listings} programs={props.programs} today={props.today} />
        </TabsContent>
        <TabsContent value="testimonials">
          <Testimonials items={props.testimonials} />
        </TabsContent>
        <TabsContent value="partnerships">
          <Partnerships items={props.partnerships} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Program listings                                                          */
/* ------------------------------------------------------------------------- */

type Filter = "all" | "current" | "upcoming" | "attention";

function Listings({ listings, programs, today }: { listings: Listing[]; programs: ProgramForListing[]; today: string }) {
  const { run, pending } = useAction();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Listing | "new" | null>(null);
  const programById = useMemo(() => new Map(programs.map((p) => [p.id, p])), [programs]);
  const needs = listings.filter((l) => staleness(l, today) || !l.ops_program_id);
  const shown = listings.filter((l) =>
    filter === "all" ? true : filter === "attention" ? needs.includes(l) : l.type === filter
  );

  const chip = (f: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(f)}
      aria-pressed={filter === f}
      className={`h-9 rounded-full border px-3 text-sm ${filter === f ? "border-foreground bg-foreground text-background" : "bg-white"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {chip("all", `All ${listings.length}`)}
        {chip("current", "Current")}
        {chip("upcoming", "Upcoming")}
        {chip("attention", `Needs a look ${needs.length}`)}
        <Button className="ml-auto" onClick={() => setEditing("new")} data-testid="add-listing">
          <Plus className="mr-1 h-4 w-4" /> Add a listing
        </Button>
      </div>

      {shown.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {listings.length === 0 ? "No programs on the website yet. Add one from a CoachOS program." : "Nothing here."}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((l) => {
          const linked = l.ops_program_id ? programById.get(l.ops_program_id) : null;
          const stale = staleness(l, today);
          const src = imageUrl(l.image);
          return (
            <article key={l.id} data-testid="listing" className="flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card">
              <div className="relative aspect-[16/9] bg-muted">
                <ListingImage src={src} />
                <span
                  className={`absolute left-3 top-3 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    l.type === "current" ? "bg-emerald-600 text-white" : "bg-sky-600 text-white"
                  }`}
                >
                  {l.type === "current" ? "Current" : "Upcoming"}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <h3 className="font-semibold leading-snug">{l.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {[l.date_range || dateRangeText(l.start_date, l.end_date), l.location].filter(Boolean).join(" · ") || "No dates or place yet"}
                </p>
                <p className="text-sm">
                  {l.price || "No price shown"}
                  {linked && linked.seats_remaining != null
                    ? ` · ${linked.seats_remaining} of ${linked.capacity} places left (live)`
                    : l.slots
                      ? ` · ${l.slots}`
                      : ""}
                </p>
                {stale && (
                  <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
                    <AlertTriangle className="h-3.5 w-3.5" /> {stale}
                  </p>
                )}
                <p className={`flex items-center gap-1.5 text-xs ${linked ? "text-emerald-700" : "text-muted-foreground"}`}>
                  <Link2 className="h-3.5 w-3.5" />
                  {linked
                    ? `Linked to ${linked.name}${linked.school_name ? ` · ${linked.school_name}` : ""} — sign-ups go straight into CoachOS`
                    : "Not linked — sign-ups go to the old form, not CoachOS"}
                </p>
                <div className="mt-auto flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(l)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    disabled={pending}
                    aria-label={`Delete ${l.title}`}
                    onClick={() => {
                      if (!window.confirm(`Take "${l.title}" off the website? This can't be undone.`)) return;
                      run(() => deleteListing(l.id), { success: "Taken off the website", error: "It wasn't removed" });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {editing && (
        <ListingDialog
          listing={editing === "new" ? null : editing}
          programs={programs}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** The listing's picture, or why there isn't one (the site would show a stock photo). */
function ListingImage({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {src ? "Picture missing — the site shows a stock photo. Edit to upload one." : "No picture yet"}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" onError={() => setBroken(true)} />;
}

function ListingDialog({ listing, programs, onClose }: { listing: Listing | null; programs: ProgramForListing[]; onClose: () => void }) {
  const { run, pending } = useAction();
  const blank: Omit<Listing, "id"> = {
    title: "", description: "", type: "current", date_range: "", start_date: null, end_date: null, location: "",
    image: "", price: "", slots: "", age_groups: [], registration_date: null, ops_program_id: null,
  };
  const [v, setV] = useState<Omit<Listing, "id">>(listing ?? blank);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((x) => ({ ...x, [k]: value }));
  const program = programs.find((p) => p.id === v.ops_program_id) ?? null;

  function fillFrom(p: ProgramForListing) {
    const f = listingFromProgram(p);
    setV((x) => ({ ...x, ...f, description: f.description || x.description }));
    toast.success(`Filled in from ${p.name} — check it over`);
  }

  async function upload(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadWebsiteImage(fd);
    setUploading(false);
    if ("error" in res && res.error) return toast.error("Picture not uploaded", { description: res.error });
    set("image", (res as { url: string }).url);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    if (listing) fd.set("id", listing.id);
    for (const [k, val] of Object.entries(v)) {
      if (k === "age_groups") (val as string[]).forEach((a) => fd.append("age_groups", a));
      else fd.set(k, val == null ? "" : String(val));
    }
    const ok = await run(() => saveListing(fd), {
      success: listing ? "Saved — it's on the site now" : "Added to the website",
      error: "Not saved",
    });
    if (ok) onClose();
  }

  const preview = imageUrl(v.image);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="listing-dialog">
        <DialogHeader>
          <DialogTitle>{listing ? "Edit listing" : "Add a listing"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="rounded-xl bg-muted/50 p-3">
            <Label htmlFor="listing-program">CoachOS program</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  id="listing-program"
                  value={v.ops_program_id ?? ""}
                  onChange={(e) => {
                    const p = programs.find((x) => x.id === e.target.value);
                    set("ops_program_id", e.target.value || null);
                    // A new listing fills itself in; an existing one asks first (the button).
                    if (p && !listing) fillFrom(p);
                  }}
                  options={[
                    { value: "", label: "Not linked (sign-ups go to the old form)" },
                    ...programs.map((p) => ({ value: p.id, label: `${p.name}${p.school_name ? ` · ${p.school_name}` : ""}` })),
                  ]}
                />
              </div>
              {program && listing && (
                <Button type="button" variant="outline" onClick={() => fillFrom(program)}>
                  Update from program
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Linked listings show live open places on the site, and Register signs families up straight into CoachOS.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <div className="space-y-1.5">
              <Label htmlFor="listing-title">Title</Label>
              <Input id="listing-title" value={v.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="listing-type">Shown under</Label>
              <Select
                id="listing-type"
                value={v.type}
                onChange={(e) => set("type", e.target.value as Listing["type"])}
                options={[
                  { value: "current", label: "Current programs" },
                  { value: "upcoming", label: "Upcoming programs" },
                ]}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="listing-description">Description</Label>
            <Textarea id="listing-description" rows={3} value={v.description} onChange={(e) => set("description", e.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="listing-start">Starts</Label>
              <Input
                id="listing-start"
                type="date"
                value={v.start_date ?? ""}
                onChange={(e) => setV((x) => ({ ...x, start_date: e.target.value || null, date_range: dateRangeText(e.target.value || null, x.end_date) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="listing-end">Ends</Label>
              <Input
                id="listing-end"
                type="date"
                value={v.end_date ?? ""}
                onChange={(e) => setV((x) => ({ ...x, end_date: e.target.value || null, date_range: dateRangeText(x.start_date, e.target.value || null) }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="listing-dates-text">Dates as parents see them</Label>
              <Input id="listing-dates-text" value={v.date_range} onChange={(e) => set("date_range", e.target.value)} placeholder="September 8 – December 11, 2026" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="listing-location">Where</Label>
              <Input id="listing-location" value={v.location} onChange={(e) => set("location", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="listing-price">Price</Label>
              <Input id="listing-price" value={v.price} onChange={(e) => set("price", e.target.value)} placeholder="$120/month" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="listing-slots">Spots {program ? "(the site shows live places instead)" : ""}</Label>
              <Input id="listing-slots" value={v.slots} onChange={(e) => set("slots", e.target.value)} placeholder="12 spots" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="listing-registration">Registration note (optional)</Label>
              <Input id="listing-registration" value={v.registration_date ?? ""} onChange={(e) => set("registration_date", e.target.value || null)} placeholder="Registration opens May 15" />
            </div>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Ages</legend>
            <div className="flex flex-wrap gap-2">
              {[...new Set([...AGE_GROUPS, ...v.age_groups])].map((a) => {
                const on = v.age_groups.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set("age_groups", on ? v.age_groups.filter((x) => x !== a) : [...v.age_groups, a])}
                    className={`h-9 rounded-full border px-3 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "bg-white"}`}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="listing-image-file">Picture</Label>
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-20 w-32 overflow-hidden rounded-lg bg-muted">
                {preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 text-sm font-medium hover:bg-muted">
                <ImagePlus className="h-4 w-4" /> {uploading ? "Uploading…" : preview ? "Change picture" : "Upload a picture"}
                <input
                  id="listing-image-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                />
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || uploading}>
              {pending ? "Saving…" : listing ? "Save" : "Add to website"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- */
/* Testimonials and partnerships                                             */
/* ------------------------------------------------------------------------- */

function Testimonials({ items }: { items: Testimonial[] }) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState<Testimonial | "new" | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus className="mr-1 h-4 w-4" /> Add a testimonial
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((t) => (
          <article key={t.id} className="rounded-2xl border bg-card p-4" data-testid="testimonial">
            <div className="flex items-center gap-1 text-amber-500" aria-label={`${t.stars} stars`}>
              {Array.from({ length: t.stars }, (_, i) => (
                <Star key={i} className="h-4 w-4 fill-current" />
              ))}
            </div>
            <p className="mt-2">&ldquo;{t.quote}&rdquo;</p>
            <p className="mt-2 text-sm font-semibold">
              {t.name} <span className="font-normal text-muted-foreground">· {t.relationship}</span>
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600"
                disabled={pending}
                aria-label={`Delete ${t.name}'s testimonial`}
                onClick={() => {
                  if (!window.confirm(`Take ${t.name}'s testimonial off the website?`)) return;
                  run(() => deleteTestimonial(t.id), { success: "Removed", error: "It wasn't removed" });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <SimpleDialog
          title={editing === "new" ? "Add a testimonial" : "Edit testimonial"}
          onClose={() => setEditing(null)}
          onSave={(fd) => saveTestimonial(fd)}
          id={editing === "new" ? null : editing.id}
          fields={[
            { name: "name", label: "Name", value: editing === "new" ? "" : editing.name },
            { name: "relationship", label: "Who they are", value: editing === "new" ? "" : editing.relationship, placeholder: "Parent of a Rising Star" },
            { name: "quote", label: "What they said", value: editing === "new" ? "" : editing.quote, long: true },
            { name: "stars", label: "Stars (1–5)", value: editing === "new" ? "5" : String(editing.stars), type: "number" },
            { name: "avatar", label: "Photo address (optional)", value: editing === "new" ? "" : editing.avatar ?? "" },
          ]}
        />
      )}
    </div>
  );
}

function Partnerships({ items }: { items: Partnership[] }) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState<Partnership | "new" | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus className="mr-1 h-4 w-4" /> Add a partnership
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((p) => (
          <article key={p.id} className="rounded-2xl border bg-card p-4" data-testid="partnership">
            <h3 className="font-semibold">
              <span aria-hidden="true">{p.icon}</span> {p.type}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
            {p.benefits.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {p.benefits.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600"
                disabled={pending}
                aria-label={`Delete ${p.type}`}
                onClick={() => {
                  if (!window.confirm(`Take "${p.type}" off the website?`)) return;
                  run(() => deletePartnership(p.id), { success: "Removed", error: "It wasn't removed" });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <SimpleDialog
          title={editing === "new" ? "Add a partnership" : "Edit partnership"}
          onClose={() => setEditing(null)}
          onSave={(fd) => savePartnership(fd)}
          id={editing === "new" ? null : editing.id}
          fields={[
            { name: "type", label: "Name", value: editing === "new" ? "" : editing.type, placeholder: "Schools" },
            { name: "icon", label: "Icon (an emoji)", value: editing === "new" ? "🤝" : editing.icon },
            { name: "description", label: "Description", value: editing === "new" ? "" : editing.description, long: true },
            { name: "benefits", label: "Benefits (one per line)", value: editing === "new" ? "" : editing.benefits.join("\n"), long: true },
          ]}
        />
      )}
    </div>
  );
}

function SimpleDialog(props: {
  title: string;
  id: string | null;
  fields: { name: string; label: string; value: string; long?: boolean; type?: string; placeholder?: string }[];
  onSave: (fd: FormData) => Promise<{ error?: string; success?: boolean } | unknown>;
  onClose: () => void;
}) {
  const { run, pending } = useAction();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (props.id) fd.set("id", props.id);
    const ok = await run(() => props.onSave(fd) as Promise<{ error?: string }>, { success: "Saved — it's on the site now", error: "Not saved" });
    if (ok) props.onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {props.fields.map((f) => (
            <div key={f.name} className="space-y-1.5">
              <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
              {f.long ? (
                <Textarea id={`f-${f.name}`} name={f.name} defaultValue={f.value} rows={3} placeholder={f.placeholder} />
              ) : (
                <Input id={`f-${f.name}`} name={f.name} defaultValue={f.value} type={f.type ?? "text"} placeholder={f.placeholder} min={f.type === "number" ? 1 : undefined} max={f.type === "number" ? 5 : undefined} />
              )}
            </div>
          ))}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button type="button" variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
