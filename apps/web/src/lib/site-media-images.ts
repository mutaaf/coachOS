import { renditionWidths, UPLOAD_TYPES } from "@/lib/site-media";

/**
 * Turning an uploaded photo into what the website serves. A plain server
 * module (not "use server"): it is reached only from the guarded actions in
 * lib/actions/site-media.ts.
 *
 * With `sharp` (bundled with Next's Node runtime, and a dependency of web):
 *   - the photo is turned upright from its EXIF orientation;
 *   - all metadata is dropped — phone photos carry the GPS position of where
 *     they were taken, which for a photo of children at a school must never
 *     reach a public URL;
 *   - WebP copies are made 480, 960 and 1600 wide (never wider than the
 *     original), and the width and height recorded.
 * Without sharp (it failed to load), the original is kept exactly as uploaded
 * with no sizes; width and height stay unknown. The page says so.
 */

export interface Processed {
  original: { data: Buffer; contentType: string; ext: string };
  width: number | null;
  height: number | null;
  renditions: { w: number; data: Buffer }[];
  resized: boolean;
}

type SharpFn = typeof import("sharp");

let sharpLoader: Promise<SharpFn | null> | null = null;
async function loadSharp(): Promise<SharpFn | null> {
  sharpLoader ??= import("sharp")
    .then((m) => ((m as unknown as { default?: SharpFn }).default ?? (m as unknown as SharpFn)))
    .catch((e) => {
      console.error("sharp is unavailable; photos are stored without resizing:", e?.message ?? e);
      return null;
    });
  return sharpLoader;
}

export async function processPhoto(input: Buffer, contentType: string): Promise<Processed> {
  const ext = UPLOAD_TYPES[contentType] ?? "bin";
  const sharp = await loadSharp();
  if (!sharp) return { original: { data: input, contentType, ext }, width: null, height: null, renditions: [], resized: false };

  // Animated GIFs keep their frames in the WebP copies.
  const animated = contentType === "image/gif" || contentType === "image/webp";
  const base = () => sharp(input, { animated, failOn: "error" }).rotate();

  // The original, upright and without metadata, in its own format.
  const cleaned = base();
  const cleanedOut =
    contentType === "image/jpeg"
      ? cleaned.jpeg({ quality: 90, mozjpeg: true })
      : contentType === "image/png"
        ? cleaned.png()
        : contentType === "image/webp"
          ? cleaned.webp({ quality: 90 })
          : contentType === "image/avif"
            ? cleaned.avif({ quality: 70 })
            : cleaned.gif();
  const { data: original, info } = await cleanedOut.toBuffer({ resolveWithObject: true });
  const width = info.width;
  // For an animated image sharp reports the height of all frames stacked.
  const height = info.pageHeight ?? info.height;

  const renditions: Processed["renditions"] = [];
  for (const w of renditionWidths(width)) {
    const data = await base().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    renditions.push({ w, data });
  }
  return { original: { data: original, contentType, ext }, width, height, renditions, resized: true };
}
