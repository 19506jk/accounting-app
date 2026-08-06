import { inflateSync } from 'node:zlib';

/**
 * Validation for receipt-signer signature images.
 *
 * Signature images are stored directly in settings as canonical PNG/JPEG
 * data URIs — no upload endpoint, no external storage, and the receipt
 * renderers never load remote resources. Validation is structural, not just
 * header-level: PNG chunks are walked with CRC and zlib checks, and JPEG
 * markers are scanned through to the scan data and EOI, so header-only or
 * truncated payloads that would fail in the preview/PDF renderers are
 * rejected before they can be saved.
 */

export const SIGNATURE_MAX_BYTES = 250 * 1024;
export const SIGNATURE_MAX_WIDTH = 1600;
export const SIGNATURE_MAX_HEIGHT = 800;

/**
 * Adam7 pass row starts and strides (PNG spec §8.2). Interlaced images split
 * the rows across seven passes, each carrying its own scanline filter bytes,
 * so the scanline count is the per-pass sum, not the height.
 */
const ADAM7_PASS_ROWS = [
  [0, 8], [0, 8], [4, 8], [0, 4], [2, 4], [0, 2], [1, 2],
] as const;

/**
 * Largest legitimate decompressed PNG for the allowed dimensions: 16-bit
 * RGBA pixels (8 bytes each) plus one filter byte per scanline. The IDAT
 * inflation is capped here so a crafted payload (a header claiming tiny
 * dimensions over a highly compressed stream) cannot exhaust memory during
 * a settings save.
 */
export const MAX_PNG_DECOMPRESSED_BYTES =
  SIGNATURE_MAX_WIDTH * SIGNATURE_MAX_HEIGHT * 8 +
  ADAM7_PASS_ROWS.reduce(
    (sum, [start, step]) => sum + Math.ceil((SIGNATURE_MAX_HEIGHT - start) / step),
    0,
  );

/** Strict data-URI shape: lowercase mime, exactly one comma, base64 payload. */
const DATA_URI_RE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export type SignatureImageResult =
  | { ok: true; canonical: string }
  | { ok: false; error: string };

/** Strict base64 decode: charset + padding + length are all enforced first. */
function strictBase64Decode(input: string): Buffer | null {
  if (!input || input.length % 4 !== 0 || !BASE64_RE.test(input)) return null;
  const bytes = Buffer.from(input, 'base64');
  if (bytes.length === 0) return null;
  return bytes;
}

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = PNG_CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Validates PNG structure and reads the IHDR dimensions: an IHDR first
 * chunk, at least one IDAT chunk whose zlib stream inflates, and a
 * terminating IEND. Every chunk length and CRC is checked, so header-only
 * and truncated payloads are rejected.
 */
function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (!bytes.subarray(0, 8).equals(PNG_MAGIC)) return null;

  let pos = 8;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;
  const idatChunks: Buffer[] = [];
  while (pos + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(pos);
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    if (length > 0x7fffffff || dataEnd + 4 > bytes.length) return null;
    if (crc32(bytes, pos + 4, dataEnd) !== bytes.readUInt32BE(dataEnd)) return null;
    const type = bytes.subarray(pos + 4, pos + 8).toString('ascii');
    if (pos === 8 && type !== 'IHDR') return null; // IHDR must be the first chunk
    if (type === 'IHDR') {
      if (sawIhdr || length !== 13) return null;
      sawIhdr = true;
    } else if (type === 'IDAT') {
      sawIdat = true;
      idatChunks.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      if (length !== 0) return null;
      sawIend = true;
      pos = dataEnd + 4;
      break;
    }
    pos = dataEnd + 4;
  }
  if (!sawIhdr || !sawIdat || !sawIend) return null;
  try {
    // The output cap keeps decompression bombs from allocating unbounded
    // memory; exceeding it (or any zlib error) means the data is not a
    // valid scanline stream for an image of the allowed dimensions.
    inflateSync(Buffer.concat(idatChunks), { maxOutputLength: MAX_PNG_DECOMPRESSED_BYTES });
  } catch {
    return null;
  }
  // IHDR was verified first: width at 16, height at 20 (big-endian).
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

/** Skips entropy-coded scan data to the next marker (FF followed by non-00). */
function skipEntropyData(bytes: Buffer, start: number): number {
  let i = start;
  while (i + 1 < bytes.length) {
    if (bytes[i] === 0xff) {
      if (bytes[i + 1] === 0x00) {
        i += 2; // byte-stuffed data byte
        continue;
      }
      return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * Reads JPEG dimensions by scanning markers with strict bounds checks. The
 * width/height live in the first SOF marker (C0–CF, excluding DHT C4, JPG
 * C8, and DAC CC). A valid image must also contain at least one SOS segment
 * and terminate with EOI — entropy-coded scan data is skipped to the next
 * marker, resuming after restart markers (FFD0–FFD7) — so header-only and
 * truncated payloads are rejected.
 */
function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4) return null;
  if (!bytes.subarray(0, 3).equals(JPEG_MAGIC)) return null;

  let pos = 2; // after the SOI marker (FF D8)
  let dims: { width: number; height: number } | null = null;
  let sawSos = false;
  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) return null; // marker sync lost
    pos += 1;
    while (pos < bytes.length && bytes[pos] === 0xff) pos += 1; // fill bytes
    if (pos >= bytes.length) return null;
    const marker = bytes[pos]!;
    pos += 1;

    // Standalone markers carry no segment length; EOI must close the scan.
    if (
      marker === 0xd8 || marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01
    ) {
      if (marker === 0xd9) return dims && sawSos ? dims : null;
      if (marker >= 0xd0 && marker <= 0xd7) {
        // Restart marker inside scan data: entropy data resumes after it.
        pos = skipEntropyData(bytes, pos);
        if (pos === -1) return null;
      }
      continue;
    }

    if (pos + 2 > bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(pos);
    if (segmentLength < 2 || pos + segmentLength > bytes.length) return null;

    const isSof =
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      // Segment: length(2) + precision(1) + height(2) + width(2) + components(1+).
      if (segmentLength < 7) return null;
      dims = {
        height: bytes.readUInt16BE(pos + 3),
        width: bytes.readUInt16BE(pos + 5),
      };
      pos += segmentLength;
      continue;
    }

    if (marker === 0xda) { // SOS: entropy-coded scan data follows
      sawSos = true;
      pos = skipEntropyData(bytes, pos + segmentLength);
      if (pos === -1) return null; // scan data never reaches the next marker
      continue;
    }

    pos += segmentLength;
  }
  return null; // stream ended without EOI
}

/**
 * Validates one signature image value. Returns the canonical data URI, or a
 * human-readable error for HTTP 400 responses. The parsed dimensions are
 * used only for the bounds checks; callers never need them.
 */
export function validateSignatureImage(value: string): SignatureImageResult {
  const match = DATA_URI_RE.exec(value);
  if (!match) {
    return {
      ok: false,
      error: 'Signature image must be a data URI in PNG or JPEG format',
    };
  }

  const mime = match[1]! === 'png' ? 'image/png' : 'image/jpeg';
  const base64 = match[2]!;
  const bytes = strictBase64Decode(base64);
  if (!bytes) {
    return { ok: false, error: 'Signature image base64 data is invalid' };
  }
  if (bytes.length > SIGNATURE_MAX_BYTES) {
    return { ok: false, error: `Signature image must be ${SIGNATURE_MAX_BYTES / 1024} KB or smaller` };
  }

  let dimensions: { width: number; height: number } | null;
  if (mime === 'image/png') {
    dimensions = pngDimensions(bytes);
  } else {
    dimensions = jpegDimensions(bytes);
  }
  if (!dimensions) {
    return {
      ok: false,
      error: mime === 'image/png'
        ? 'Signature image is not a valid PNG'
        : 'Signature image is not a valid JPEG',
    };
  }
  if (
    !Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height) ||
    dimensions.width < 1 || dimensions.height < 1 ||
    dimensions.width > SIGNATURE_MAX_WIDTH || dimensions.height > SIGNATURE_MAX_HEIGHT
  ) {
    return {
      ok: false,
      error: `Signature image dimensions must be within ${SIGNATURE_MAX_WIDTH}×${SIGNATURE_MAX_HEIGHT} pixels`,
    };
  }

  return { ok: true, canonical: `data:${mime};base64,${bytes.toString('base64')}` };
}
