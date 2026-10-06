"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAction } from "@/lib/use-action";
import { createClient } from "@/lib/supabase/client";
import {
  deletePhoto,
  finishPhotoUpload,
  placePhoto,
  removePlacement,
  reorderSlot,
  startPhotoUpload,
  updatePhoto,
} from "@/lib/actions/site-media";
import {
  ALT_HINT,
  focalFromClick,
  focalPosition,
  publishProblems,
  SITE_MEDIA_BUCKET,
  slotInfo,
  SLOTS,
  sportSlot,
  UPLOAD_TYPES,
} from "@/lib/site-media";
import type { OfferingCard, Photo, Placement } from "@/lib/queries/site-media";
import { ArrowDown, ArrowUp, CheckCircle2, GripVertical, ImagePlus, Loader2, RefreshCw, ShieldAlert, Trash2, UploadCloud, X } from "lucide-react";

/**
 * Website → Photos: the pictures on risingstars.training, changed here with
 * no deploy. Upload (drag and drop, several at once), describe, set the focus
 * point, answer the child-safety question, publish, and put each photo in a
 * place on the site. The site reads public.site_media at runtime.
 */

export interface PhotoLibraryProps {
  photos: Photo[];
  placements: Placement[];
  offerings: OfferingCard[];
  sports: string[];
}

const ACCEPT = Object.keys(UPLOAD_TYPES).join(",");

type Upload = { key: string; name: string; state: "uploading" | "processing" | "done" | "error"; message?: string };

/** Send one file the way the server wants it: ask, upload straight to storage, finish. */
async function sendPhoto(file: File, onStage: (s: Upload["state"]) => void, replaceId?: string, answers?: { contains_identifiable_minors: boolean; photo_release_confirmed: boolean }) {
  const start = await startPhotoUpload({ name: file.name, type: file.type, size: file.size }, replaceId ?? null);
  if (!("success" in start)) throw new Error(start.error);
  const { error } = await createClient().storage.from(SITE_MEDIA_BUCKET).uploadToSignedUrl(start.path, start.token, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  onStage("processing");
  const done = await finishPhotoUpload(start.id, start.path, answers);
  if (!("success" in done)) throw new Error(done.error);
  return done;
}

function statusOf(p: Photo): { label: string; tone: "live" | "draft" | "warn" } {
  if (p.status !== "ready") return { label: "Upload not finished", tone: "warn" };
  const wrong = publishProblems(p);
  if (p.published && wrong.length === 0) return { label: "On the website", tone: "live" };
  if (!p.alt.trim()) return { label: "Needs a description", tone: "warn" };
  if (p.contains_identifiable_minors && !p.photo_release_confirmed) return { label: "Needs a photo release", tone: "warn" };
  return { label: "Not published", tone: "draft" };
}

const toneClass = { live: "bg-emerald-600 text-white", draft: "bg-slate-700 text-white", warn: "bg-amber-400 text-amber-950" };

export function SitePhotos({ photos, placements, offerings, sports }: PhotoLibraryProps) {
  const router = useRouter();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ slot: string; offeringId?: string; label: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const inSlot = (slot: string, offeringId?: string) =>
    placements.filter((pl) => pl.slot === slot && (offeringId ? pl.offering_id === offeringId : true)).sort((a, b) => a.sort_order - b.sort_order);
  const editingPhoto = editing ? byId.get(editing) ?? null : null;

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    const batch = list.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, state: "uploading" as const }));
    setUploads((u) => [...batch, ...u]);
    const set = (key: string, patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    let firstId: string | null = null;
    let ok = 0;
    // Two at a time: quick, without choking a phone's connection.
    const queue = list.map((file, i) => ({ file, key: batch[i].key }));
    async function worker() {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { file, key } = next;
        try {
          const done = await sendPhoto(file, (state) => set(key, { state }));
          set(key, { state: "done", message: done.resized ? undefined : "Saved without resizing" });
          firstId ??= done.id;
          ok++;
        } catch (e) {
          set(key, { state: "error", message: (e as Error).message });
        }
      }
    }
    await Promise.all([worker(), worker()]);
    if (ok) {
      toast.success(`${ok} ${ok === 1 ? "photo" : "photos"} added — describe ${ok === 1 ? "it" : "each one"} to publish`);
      router.refresh();
      if (ok === 1 && firstId) setEditing(firstId);
    }
  }

  return (
    <div className="space-y-8" data-testid="site-photos">
      <p className="flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
        Live on the website within a minute — no deploy. Only published photos with a description show.
      </p>

      {/* Upload */}
      <section aria-labelledby="photos-upload">
        <h2 id="photos-upload" className="sr-only">Add photos</h2>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"}`}
          data-testid="photo-dropzone"
        >
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Drop photos here</p>
          <p className="text-xs text-muted-foreground">JPG, PNG, WebP, AVIF or GIF, up to 15 MB each. Location data is removed and smaller copies are made for phones.</p>
          <Button type="button" className="mt-1 h-11 sm:h-10" onClick={() => input.current?.click()}>
            <ImagePlus className="mr-1 h-4 w-4" /> Choose photos
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            aria-label="Choose photos to upload"
            data-testid="photo-input"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {uploads.length > 0 && (
          <ul className="mt-3 space-y-1" aria-label="Uploads" aria-live="polite">
            {uploads.slice(0, 8).map((u) => (
              <li key={u.key} className="flex items-center gap-2 text-sm">
                {u.state === "done" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                ) : u.state === "error" ? (
                  <X className="h-4 w-4 shrink-0 text-red-600" />
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                )}
                <span className="min-w-0 truncate">{u.name}</span>
                <span className={`shrink-0 text-xs ${u.state === "error" ? "text-red-700" : "text-muted-foreground"}`}>
                  {u.state === "uploading" ? "Uploading…" : u.state === "processing" ? "Making it phone-sized…" : u.state === "done" ? u.message ?? "Added" : u.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Where they show */}
      <section aria-labelledby="photos-places" className="space-y-3">
        <div>
          <h2 id="photos-places" className="text-lg font-semibold">Where photos show</h2>
          <p className="text-sm text-muted-foreground">Places with no photo use the website’s built-in picture.</p>
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {SLOTS.map((s) => (
            <SlotRow
              key={s.slot}
              slot={s.slot}
              items={inSlot(s.slot)}
              byId={byId}
              onPick={() => setPicking({ slot: s.slot, label: s.label })}
              onEdit={setEditing}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="photos-cards" className="space-y-3">
        <div>
          <h2 id="photos-cards" className="text-lg font-semibold">Program cards</h2>
          <p className="text-sm text-muted-foreground">
            A card shows its own photo, else its listing’s picture, else its sport’s photo below. Give a card its own photo to replace an old picture.
          </p>
        </div>
        {offerings.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No current or upcoming sessions.</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {offerings.map((o) => {
              const own = inSlot("offering", o.id)[0];
              const ownPhoto = own ? byId.get(own.media_id) : null;
              const src = ownPhoto?.thumb ?? o.imageUrl;
              return (
                <li key={o.id} className="flex items-center gap-3 p-3" data-testid="offering-photo">
                  <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {src && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt="" className="h-full w-full object-cover" style={ownPhoto ? { objectPosition: focalPosition(ownPhoto.focal_x, ownPhoto.focal_y) } : undefined} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{o.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[o.school, o.onSite ? null : "not on the site now", ownPhoto ? "its own photo" : src ? "an older picture" : "no picture"].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {own && (
                      <Button size="icon" variant="ghost" aria-label={`Remove the photo from ${o.title} at ${o.school}`} onClick={() => removePlacementNow(own.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="outline" className="h-11 sm:h-9" onClick={() => setPicking({ slot: "offering", offeringId: o.id, label: `${o.title} · ${o.school}` })}>
                      {own ? "Change" : "Choose"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {sports.length > 0 && (
          <ul className="grid gap-3 md:grid-cols-2">
            {sports.map((sp) => {
              const slot = sportSlot(sp);
              if (!slot) return null;
              return (
                <SlotRow key={slot} slot={slot} items={inSlot(slot)} byId={byId} onPick={() => setPicking({ slot, label: slotInfo(slot).label })} onEdit={setEditing} />
              );
            })}
          </ul>
        )}
      </section>

      {/* Library */}
      <section aria-labelledby="photos-library" className="space-y-3">
        <h2 id="photos-library" className="text-lg font-semibold">
          Library <span className="text-sm font-normal text-muted-foreground">({photos.length})</span>
        </h2>
        {photos.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No photos yet. Add real photos from practices — they replace the website’s cartoon pictures.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((p) => {
              const st = statusOf(p);
              const where = placements.filter((pl) => pl.media_id === p.id).length;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(p.id)}
                    className="group block w-full overflow-hidden rounded-xl border bg-card text-left"
                    data-testid="library-photo"
                    aria-label={`Edit ${p.alt || p.original_filename || "photo"}`}
                  >
                    <div className="relative aspect-[4/3] bg-muted">
                      {p.thumb && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumb} alt="" className="h-full w-full object-cover" style={{ objectPosition: focalPosition(p.focal_x, p.focal_y) }} loading="lazy" />
                      )}
                      <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneClass[st.tone]}`}>{st.label}</span>
                    </div>
                    <div className="p-2">
                      <p className={`line-clamp-2 text-xs ${p.alt ? "" : "italic text-muted-foreground"}`}>{p.alt || p.original_filename || "No description"}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{where ? `In ${where} ${where === 1 ? "place" : "places"}` : "Not placed"}</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editingPhoto && (
        <PhotoDialog
          photo={editingPhoto}
          placements={placements.filter((pl) => pl.media_id === editingPhoto.id)}
          offerings={offerings}
          sports={sports}
          onClose={() => setEditing(null)}
        />
      )}
      {picking && (
        <PickPhoto
          label={picking.label}
          photos={photos}
          onPick={async (id) => {
            const target = picking;
            setPicking(null);
            const res = await placePhoto(id, target.slot, target.offeringId);
            if ("error" in res && res.error) toast.error("Not placed", { description: res.error });
            else {
              const p = byId.get(id);
              toast.success(p && statusOf(p).tone === "live" ? `On the website: ${target.label}` : `Placed — publish the photo to show it`);
              router.refresh();
            }
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );

  async function removePlacementNow(id: string) {
    const res = await removePlacement(id);
    if ("error" in res && res.error) toast.error("Not removed", { description: res.error });
    else router.refresh();
  }
}

/** One place on the site and the photos in it; the slideshow can be reordered by dragging or with the arrows. */
function SlotRow({
  slot,
  items,
  byId,
  onPick,
  onEdit,
}: {
  slot: string;
  items: Placement[];
  byId: Map<string, Photo>;
  onPick: () => void;
  onEdit: (id: string) => void;
}) {
  const info = slotInfo(slot);
  const router = useRouter();
  const [order, setOrder] = useState<Placement[] | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const list = order ?? items;

  async function commit(next: Placement[]) {
    setOrder(next);
    const res = await reorderSlot(slot, next.map((p) => p.id));
    if ("error" in res && res.error) toast.error("Order not saved", { description: res.error });
    router.refresh();
    setOrder(null);
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    commit(next);
  };

  return (
    <li className="min-w-0 rounded-2xl border bg-card p-3" data-testid={`slot-${slot}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{info.label}</p>
          <p className="text-xs text-muted-foreground">{info.where}</p>
        </div>
        <Button variant="outline" className="h-11 shrink-0 sm:h-9" onClick={onPick} aria-label={`Choose a photo for ${info.label}`}>
          {info.ordered ? "Add" : list.length ? "Change" : "Choose"}
        </Button>
      </div>
      {list.length > 0 && (
        <ol className={`mt-3 ${info.ordered ? "space-y-2" : "flex gap-2"}`} aria-label={`${info.label} photos`}>
          {list.map((pl, i) => {
            const p = byId.get(pl.media_id);
            if (!p) return null;
            const st = statusOf(p);
            return (
              <li
                key={pl.id}
                draggable={info.ordered}
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => info.ordered && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag !== null) move(drag, i);
                  setDrag(null);
                }}
                className={`flex items-center gap-2 ${info.ordered ? "rounded-lg border bg-background p-1.5" : ""} ${drag === i ? "opacity-50" : ""}`}
                data-testid="slot-item"
              >
                {info.ordered && <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />}
                <button type="button" onClick={() => onEdit(p.id)} className="relative h-14 w-20 shrink-0 overflow-hidden rounded-md bg-muted" aria-label={`Edit ${p.alt || "photo"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt="" className="h-full w-full object-cover" style={{ objectPosition: focalPosition(p.focal_x, p.focal_y) }} />
                </button>
                {info.ordered && (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{p.alt || "No description"}</span>
                      {st.tone !== "live" && <span className="text-[11px] font-medium text-amber-700">{st.label}</span>}
                    </span>
                    <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(i, i + 1)}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Take ${p.alt || "this photo"} out of ${info.label}`}
                      onClick={async () => {
                        await removePlacement(pl.id);
                        router.refresh();
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                )}
                {!info.ordered && st.tone !== "live" && <span className="text-[11px] font-medium text-amber-700">{st.label}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
}

function PickPhoto({ label, photos, onPick, onClose }: { label: string; photos: Photo[]; onPick: (id: string) => void; onClose: () => void }) {
  const ready = photos.filter((p) => p.status === "ready");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="pick-photo">
        <DialogHeader className="mb-3 pr-8 text-left">
          <DialogTitle>Photo for {label}</DialogTitle>
        </DialogHeader>
        {ready.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add photos to the library first.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ready.map((p) => {
              const st = statusOf(p);
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => onPick(p.id)} className="block w-full overflow-hidden rounded-lg border text-left hover:ring-2 hover:ring-primary" aria-label={`Use ${p.alt || p.original_filename || "this photo"}`}>
                    <div className="relative aspect-[4/3] bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.thumb} alt="" className="h-full w-full object-cover" style={{ objectPosition: focalPosition(p.focal_x, p.focal_y) }} loading="lazy" />
                      {st.tone !== "live" && <span className={`absolute left-1.5 top-1.5 rounded-full px-1.5 text-[10px] font-semibold ${toneClass[st.tone]}`}>{st.label}</span>}
                    </div>
                    <p className="truncate p-1.5 text-xs">{p.alt || p.original_filename}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Everything about one photo: words, focus point, safety, publish, places, replace, delete. */
function PhotoDialog({
  photo,
  placements,
  offerings,
  sports,
  onClose,
}: {
  photo: Photo;
  placements: Placement[];
  offerings: OfferingCard[];
  sports: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [alt, setAlt] = useState(photo.alt);
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [focal, setFocal] = useState({ x: photo.focal_x, y: photo.focal_y });
  const [minors, setMinors] = useState(photo.contains_identifiable_minors);
  const [release, setRelease] = useState(photo.photo_release_confirmed);
  const [published, setPublished] = useState(photo.published || (photo.status === "ready" && !photo.alt));
  const [replacing, setReplacing] = useState(false);
  const [where, setWhere] = useState("");
  const replaceInput = useRef<HTMLInputElement>(null);
  const wrong = publishProblems({ status: photo.status, alt, contains_identifiable_minors: minors, photo_release_confirmed: release });

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    const ok = await run(
      () => updatePhoto(photo.id, { alt, caption, focal_x: focal.x, focal_y: focal.y, contains_identifiable_minors: minors, photo_release_confirmed: minors && release, published: published && wrong.length === 0 }),
      { success: published && wrong.length === 0 ? "Saved — live on the website within a minute" : "Saved (not on the website)", error: "Not saved" }
    );
    if (ok) onClose();
  }

  async function replace(file: File) {
    setReplacing(true);
    try {
      const done = await sendPhoto(file, () => {}, photo.id, { contains_identifiable_minors: minors, photo_release_confirmed: minors && release });
      toast.success(done.unpublished ? "Replaced — taken off the website until its photo release is confirmed" : "Photo replaced everywhere it shows");
      router.refresh();
    } catch (e) {
      toast.error("Not replaced", { description: (e as Error).message });
    } finally {
      setReplacing(false);
    }
  }

  const options = [
    ...SLOTS.map((s) => ({ value: s.slot, label: s.label })),
    ...sports.map((sp) => sportSlot(sp)).filter((s): s is string => !!s).map((s) => ({ value: s, label: slotInfo(s).label })),
    ...offerings.map((o) => ({ value: `offering:${o.id}`, label: `Card: ${o.title} · ${o.school}` })),
  ].filter((o) => !placements.some((pl) => (pl.slot === "offering" ? `offering:${pl.offering_id}` : pl.slot) === o.value));
  const placeLabel = (pl: Placement) => (pl.slot === "offering" ? `Card: ${offerings.find((o) => o.id === pl.offering_id)?.title ?? "a program"}` : slotInfo(pl.slot).label);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="photo-dialog">
        <DialogHeader className="mb-3 pr-8 text-left">
          <DialogTitle>Photo</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
            <div>
              <p className="mb-1.5 text-sm font-medium" id="focal-label">Tap the most important part</p>
              <button
                type="button"
                aria-labelledby="focal-label"
                className="relative block w-full cursor-crosshair overflow-hidden rounded-xl bg-muted"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setFocal(focalFromClick(e.clientX, e.clientY, rect));
                }}
                data-testid="focal-picker"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.srcset.find((r) => r.w >= 960)?.url ?? photo.thumb} alt={alt} className="block h-auto w-full" />
                <span
                  className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.5)]"
                  style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }}
                  aria-hidden
                />
              </button>
              <p className="mt-1 text-xs text-muted-foreground">
                {photo.width && photo.height ? `${photo.width}×${photo.height}` : "Size unknown"}
                {photo.srcset.length === 0 && photo.status === "ready" ? " · stored without smaller copies" : ""}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">How it’s cropped</p>
              {[
                ["Wide (slideshow)", "aspect-[16/9]"],
                ["Card", "aspect-[4/3]"],
                ["Square", "aspect-square w-2/3"],
              ].map(([label, cls]) => (
                <div key={label}>
                  <div className={`${cls} overflow-hidden rounded-lg bg-muted`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.thumb} alt="" className="h-full w-full object-cover" style={{ objectPosition: focalPosition(focal.x, focal.y) }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="photo-alt">Description (alt text) — required</Label>
            <Textarea id="photo-alt" rows={2} value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={300} aria-describedby="photo-alt-hint" />
            <p id="photo-alt-hint" className="text-xs text-muted-foreground">{ALT_HINT}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="photo-caption">Caption (optional)</Label>
            <Input id="photo-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} placeholder="Shown under the photo where the site has room" />
          </div>

          <fieldset className="space-y-2 rounded-xl border p-3">
            <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
              <ShieldAlert className="h-4 w-4" /> Children in the photo
            </legend>
            <label className="flex min-h-[44px] items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={minors} onChange={(e) => setMinors(e.target.checked)} />
              <span>It shows children who could be recognized (a face, a name on a shirt).</span>
            </label>
            {minors && (
              <label className="flex min-h-[44px] items-start gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-950">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={release} onChange={(e) => setRelease(e.target.checked)} />
                <span>A signed photo release is on file for <strong>every</strong> child who could be recognized. Required before it can go on the website.</span>
              </label>
            )}
          </fieldset>

          <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <div>
              <Label htmlFor="photo-published" className="text-base">On the website</Label>
              <p className="text-xs text-muted-foreground">{wrong.length && published ? wrong[0] : "Live within a minute of saving — no deploy."}</p>
            </div>
            <Switch id="photo-published" checked={published} onCheckedChange={setPublished} />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Where it shows</p>
            {placements.length === 0 && <p className="text-sm text-muted-foreground">Nowhere yet.</p>}
            <ul className="flex flex-wrap gap-2">
              {placements.map((pl) => (
                <li key={pl.id} className="flex items-center gap-1 rounded-full border py-0.5 pl-3 pr-0.5 text-sm">
                  {placeLabel(pl)}
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"
                    aria-label={`Take it out of ${placeLabel(pl)}`}
                    onClick={async () => {
                      await removePlacement(pl.id);
                      router.refresh();
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Label htmlFor="photo-where" className="sr-only">Show it in</Label>
                <Select id="photo-where" value={where} onChange={(e) => setWhere(e.target.value)} options={[{ value: "", label: "Show it in…" }, ...options]} />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0 sm:h-10"
                disabled={!where}
                onClick={async () => {
                  const [slot, offeringId] = where.startsWith("offering:") ? ["offering", where.slice(9)] : [where, undefined];
                  const res = await placePhoto(photo.id, slot, offeringId);
                  if ("error" in res && res.error) toast.error("Not placed", { description: res.error });
                  setWhere("");
                  router.refresh();
                }}
              >
                Add
              </Button>
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-11 flex-1 sm:h-10" disabled={replacing} onClick={() => replaceInput.current?.click()}>
                {replacing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Replace
              </Button>
              <input
                ref={replaceInput}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                aria-label="Choose a photo to replace this one"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) replace(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="ghost"
                className="h-11 text-red-600 sm:h-10"
                onClick={async () => {
                  if (!window.confirm("Delete this photo? It comes off the website everywhere it shows.")) return;
                  const ok = await run(() => deletePhoto(photo.id), { success: "Photo deleted", error: "Not deleted" });
                  if (ok) onClose();
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Delete
              </Button>
            </div>
            <Button type="submit" className="h-11 sm:h-10" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
