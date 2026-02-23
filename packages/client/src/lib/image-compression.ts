/**
 * Client-side image processing: HEIC/HEIF → JPEG conversion + compression.
 *
 * Primary purpose: convert formats the LLM can't consume (HEIC, HEIF, BMP, TIFF)
 * into JPEG. Uses `heic-to` (libheif WASM) for HEIC decoding since browsers
 * don't support HEIC in canvas. Secondary: resize large images to fit Claude's
 * recommended max dimension (1536px) and compress to stay under the 32 MiB
 * WebSocket limit.
 */

import { isHeic, heicTo } from 'heic-to';

// ─── Budget constants ──────────────────────────────────────────────────────────

/** Total base64 budget across all image attachments (bytes). 20 MB leaves plenty
 *  of headroom under the 32 MiB Durable Object WebSocket message limit. */
const TOTAL_BUDGET_BYTES = 20_000_000;

/** Per-image cap (bytes of base64). */
const MAX_PER_IMAGE_BYTES = 4_000_000;

/** Per-image floor so quality doesn't tank when many images are attached. */
const MIN_PER_IMAGE_BYTES = 200_000;

/** Longest side in px — matches Claude's recommended vision input. */
const MAX_DIMENSION = 1536;

/** Absolute floor for dimension scaling. */
const MIN_DIMENSION = 256;

/** Timeout for image decode (ms). Prevents hanging on unsupported formats. */
const LOAD_TIMEOUT_MS = 15_000;

/** MIME types the LLM natively supports. Anything else must be converted. */
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/** Common image extensions for files where file.type is empty. */
const IMAGE_EXTENSIONS = new Set([
  'heic', 'heif',
  'jpg', 'jpeg', 'png', 'gif', 'webp',
  'bmp', 'tiff', 'tif', 'avif',
]);

/** HEIC/HEIF MIME types that need libheif decoding. */
const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif']);

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Calculate the per-image byte budget given how many images are attached.
 */
export function perImageBudget(count: number): number {
  if (count <= 0) return MAX_PER_IMAGE_BYTES;
  return Math.max(MIN_PER_IMAGE_BYTES, Math.min(MAX_PER_IMAGE_BYTES, Math.floor(TOTAL_BUDGET_BYTES / count)));
}

/**
 * Returns true if a file needs processing — either because its format
 * isn't natively supported by the LLM, or because it's too large.
 */
export function needsProcessing(file: File): boolean {
  const mime = effectiveMime(file);
  if (!SUPPORTED_MIME_TYPES.has(mime)) return true;
  return false;
}

/**
 * Returns true if a file's estimated base64 size exceeds the given budget.
 */
export function needsCompression(file: File, maxBase64Bytes: number): boolean {
  return file.size * (4 / 3) > maxBase64Bytes;
}

/**
 * Process an image file: convert unsupported formats to JPEG, resize if larger
 * than MAX_DIMENSION, and compress to fit within `maxBase64Bytes`.
 *
 * Returns a `data:image/jpeg;base64,...` string.
 */
export async function processImage(file: File, maxBase64Bytes: number): Promise<string> {
  const mime = effectiveMime(file);
  const mustConvert = !SUPPORTED_MIME_TYPES.has(mime);
  const mustCompress = needsCompression(file, maxBase64Bytes);

  console.log(`[image] processing: name=${file.name} type="${file.type}" effectiveMime=${mime} size=${file.size} mustConvert=${mustConvert} mustCompress=${mustCompress}`);

  // Fast path: no conversion or compression needed — read as-is
  if (!mustConvert && !mustCompress) {
    return readAsDataUrl(file);
  }

  // Get a browser-decodable blob. For HEIC we try multiple strategies since
  // support varies: heic-to WASM works on desktop, native WebKit decode works
  // on iOS (all iOS browsers use WebKit which handles HEIC natively).
  const imageBlob = await toDecodableBlob(file, mime);

  // Load into Image for canvas resize/compress
  const img = await loadImage(imageBlob);

  return compressViaCanvas(img, maxBase64Bytes);
}

/**
 * Convert a file to a Blob the browser can decode into an <img>.
 * Tries strategies in order: heic-to WASM → native decode (iOS) → raw file.
 */
async function toDecodableBlob(file: File, mime: string): Promise<Blob> {
  const isHeicFormat = HEIC_MIME_TYPES.has(mime) || await isHeicFile(file);

  if (!isHeicFormat) return file;

  // Strategy 1: heic-to (libheif WASM) — works on desktop browsers
  try {
    console.log(`[image] trying heic-to WASM decode: ${file.name}`);
    const jpegBlob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
    console.log(`[image] heic-to succeeded: ${jpegBlob.size} bytes`);
    return jpegBlob;
  } catch (err) {
    console.warn(`[image] heic-to WASM failed, trying native decode:`, err);
  }

  // Strategy 2: pass raw file through — on iOS/macOS, WebKit natively decodes
  // HEIC in <img> and canvas. loadImage will validate this works.
  return file;
}

/**
 * Resize and compress an already-decoded image via canvas to fit within budget.
 */
function compressViaCanvas(img: HTMLImageElement, maxBase64Bytes: number): string {
  let { width, height } = img;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  console.log(`[image] decoded: ${img.naturalWidth}x${img.naturalHeight} -> ${width}x${height}`);

  // Try progressively lower quality settings
  const qualities = [0.85, 0.7, 0.55, 0.4, 0.3, 0.25];

  for (const quality of qualities) {
    const dataUrl = canvasToDataUrl(img, width, height, quality);
    if (dataUrl.length <= maxBase64Bytes) {
      console.log(`[image] compressed: quality=${quality} size=${dataUrl.length}`);
      return dataUrl;
    }
  }

  // If still too large, halve dimensions and retry
  let scaledWidth = width;
  let scaledHeight = height;
  while (scaledWidth > MIN_DIMENSION && scaledHeight > MIN_DIMENSION) {
    scaledWidth = Math.round(scaledWidth / 2);
    scaledHeight = Math.round(scaledHeight / 2);

    for (const quality of [0.5, 0.3, 0.25]) {
      const dataUrl = canvasToDataUrl(img, scaledWidth, scaledHeight, quality);
      if (dataUrl.length <= maxBase64Bytes) {
        console.log(`[image] compressed (scaled): ${scaledWidth}x${scaledHeight} quality=${quality} size=${dataUrl.length}`);
        return dataUrl;
      }
    }
  }

  return canvasToDataUrl(img, Math.max(scaledWidth, MIN_DIMENSION), Math.max(scaledHeight, MIN_DIMENSION), 0.25);
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Determine the effective MIME type, falling back to extension-based detection
 * for files with empty `type` (common for HEIC on some iOS versions).
 */
function effectiveMime(file: File): string {
  if (file.type) return file.type.toLowerCase();

  const ext = fileExtension(file);
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  if (ext === 'jpg') return 'image/jpeg';
  if (ext === 'tif') return 'image/tiff';
  if (IMAGE_EXTENSIONS.has(ext)) return `image/${ext}`;
  return 'image/jpeg';
}

function fileExtension(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

/**
 * Check if a file is an image, accounting for HEIC files with empty type.
 */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(fileExtension(file));
}

/**
 * Check if a file is HEIC by inspecting its bytes (via heic-to's isHeic).
 * Falls back to extension check if byte inspection fails.
 */
async function isHeicFile(file: File): Promise<boolean> {
  try {
    return await isHeic(file);
  } catch {
    const ext = fileExtension(file);
    return ext === 'heic' || ext === 'heif';
  }
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    const timeout = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error(`Image decode timed out after ${LOAD_TIMEOUT_MS}ms`));
    }, LOAD_TIMEOUT_MS);

    img.onload = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to decode image blob (size=${blob.size}, type=${blob.type})`));
    };
    img.src = url;
  });
}

function canvasToDataUrl(img: HTMLImageElement, width: number, height: number, quality: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // White background (for PNG transparency → JPEG conversion)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to read file'));
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
