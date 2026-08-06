import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  MAX_PNG_DECOMPRESSED_BYTES,
  SIGNATURE_MAX_BYTES,
  validateSignatureImage,
} from '../signatureImage.js';
import {
  TINY_JPEG_DATA_URI,
  TINY_PNG_DATA_URI,
  jpegDataUri,
  jpegBytes,
  pngBytes,
  pngDataUri,
} from '../signatureImageFixtures.js';

/** Table-based CRC32, mirroring the validator's, so crafted PNGs pass the chunk walk. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

describe('validateSignatureImage', () => {
  it('accepts a valid PNG data URI and returns it canonically', () => {
    const result = validateSignatureImage(TINY_PNG_DATA_URI);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.canonical).toBe(TINY_PNG_DATA_URI);
  });

  it('accepts a real decodable JPEG data URI', () => {
    const result = validateSignatureImage(TINY_JPEG_DATA_URI);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.canonical).toBe(TINY_JPEG_DATA_URI);
  });

  it('rejects header-only PNG data with no image payload', () => {
    expect(validateSignatureImage(pngDataUri(10, 10)).ok).toBe(false);
  });

  it('rejects a decompression bomb: tiny IHDR over a stream inflating past the dimension bound', () => {
    // Valid CRCs and a 1×1 IHDR, but the IDAT inflates to ~12 MB — far more
    // than the ~10.2 MB legitimate maximum for the allowed dimensions.
    // Without an output cap the inflation would still be accepted and
    // allocate unbounded memory on every settings save.
    const dimensions = Buffer.alloc(8);
    dimensions.writeUInt32BE(1, 0);
    dimensions.writeUInt32BE(1, 4);
    const ihdr = Buffer.concat([dimensions, Buffer.from([0x08, 0x06, 0x00, 0x00, 0x00])]);
    const bombe = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', deflateSync(Buffer.alloc(12 * 1024 * 1024))), // ~12 KB compressed
      pngChunk('IEND', Buffer.alloc(0)),
    ]);

    expect(validateSignatureImage(`data:image/png;base64,${bombe.toString('base64')}`).ok).toBe(false);
  });

  it('accepts a maximum-size Adam7-interlaced 16-bit RGBA image and rejects anything larger', () => {
    // Adam7 splits the 800 rows across seven passes — 1500 scanlines, not
    // 800 — so a legitimate 1600×800 16-bit RGBA image inflates to
    // 1600×800×8 + 1500 filter bytes, beyond the non-interlaced bound.
    const dimensions = Buffer.alloc(8);
    dimensions.writeUInt32BE(1600, 0);
    dimensions.writeUInt32BE(800, 4);
    const ihdr = Buffer.concat([dimensions, Buffer.from([0x10, 0x06, 0x00, 0x00, 0x01])]); // 16-bit RGBA, Adam7

    const make = (inflatedBytes: number) =>
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', deflateSync(Buffer.alloc(inflatedBytes))),
        pngChunk('IEND', Buffer.alloc(0)),
      ]);

    const atBound = `data:image/png;base64,${make(MAX_PNG_DECOMPRESSED_BYTES).toString('base64')}`;
    const over = `data:image/png;base64,${make(MAX_PNG_DECOMPRESSED_BYTES + 1).toString('base64')}`;
    expect(validateSignatureImage(atBound).ok).toBe(true);
    expect(validateSignatureImage(over).ok).toBe(false);
  });

  it('rejects header-only JPEG data with no scan data or EOI', () => {
    expect(validateSignatureImage(jpegDataUri(10, 10)).ok).toBe(false);
  });

  it('accepts JPEGs whose scan data contains restart markers', () => {
    // SOI + SOF0 (2×2) + SOS + entropy data + RST0 + entropy data + EOI.
    const withRestart = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x02, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
      Buffer.from([0xff, 0xda, 0x00, 0x06, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
      Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44]),
      Buffer.from([0xff, 0xd0]),
      Buffer.from([0x55, 0x66, 0x77]),
      Buffer.from([0xff, 0xd9]),
    ]);
    expect(validateSignatureImage(`data:image/jpeg;base64,${withRestart.toString('base64')}`).ok).toBe(true);
  });

  it('rejects non-data-URI values such as remote URLs', () => {
    const result = validateSignatureImage('https://example.com/signature.png');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/data URI in PNG or JPEG format/);
  });

  it('rejects SVG and GIF data URIs', () => {
    expect(validateSignatureImage('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=').ok).toBe(false);
    expect(validateSignatureImage('data:image/gif;base64,R0lGODlhAQABAAAAACw=').ok).toBe(false);
  });

  it('rejects malformed base64 payloads', () => {
    expect(validateSignatureImage('data:image/png;base64,@@@not-base64@@@').ok).toBe(false);
    expect(validateSignatureImage('data:image/png;base64,AAAAA').ok).toBe(false); // length not a multiple of 4
  });

  it('rejects a declared MIME that disagrees with the decoded magic bytes', () => {
    // Declared PNG but JPEG magic.
    const mismatched = `data:image/png;base64,${jpegBytes(10, 10).toString('base64')}`;
    expect(validateSignatureImage(mismatched).ok).toBe(false);
    // Declared JPEG but PNG magic.
    const mismatchedJpeg = `data:image/jpeg;base64,${pngBytes(10, 10).toString('base64')}`;
    expect(validateSignatureImage(mismatchedJpeg).ok).toBe(false);
  });

  it('rejects truncated PNG headers', () => {
    const truncated = pngBytes(10, 10).subarray(0, 10); // magic but no IHDR
    expect(validateSignatureImage(`data:image/png;base64,${truncated.toString('base64')}`).ok).toBe(false);
  });

  it('rejects JPEG data with no SOF marker', () => {
    // SOI + APP0 + EOI: no SOF to read dimensions from.
    const noSof = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00]),
      Buffer.from([0xff, 0xd9]),
    ]);
    expect(validateSignatureImage(`data:image/jpeg;base64,${noSof.toString('base64')}`).ok).toBe(false);
  });

  it('rejects JPEG data truncated inside a marker segment', () => {
    // Declared segment length beyond the payload.
    const truncated = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00]);
    expect(validateSignatureImage(`data:image/jpeg;base64,${truncated.toString('base64')}`).ok).toBe(false);
  });

  it('rejects images exceeding the decoded byte limit', () => {
    const oversized = Buffer.alloc(SIGNATURE_MAX_BYTES + 1);
    const result = validateSignatureImage(`data:image/png;base64,${oversized.toString('base64')}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/250 KB or smaller/);
  });

  it('rejects zero and oversized dimensions', () => {
    expect(validateSignatureImage(pngDataUri(0, 10)).ok).toBe(false);
    expect(validateSignatureImage(pngDataUri(10, 0)).ok).toBe(false);
    expect(validateSignatureImage(pngDataUri(1700, 100)).ok).toBe(false);
    expect(validateSignatureImage(pngDataUri(100, 900)).ok).toBe(false);
  });
});
