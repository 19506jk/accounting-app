/**
 * Test-only signature image fixtures.
 *
 * `pngBytes`/`jpegBytes` craft minimal files with declared dimensions — enough
 * for the validator, which reads only magic bytes and header fields. The
 * `TINY_*_DATA_URI` constants are real, decodable 1×1 images for PDF tests.
 */

/** Real 1×1 transparent PNG. */
export const TINY_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Real 1×1 JPEG (progressive-less baseline). */
export const TINY_JPEG_DATA_URI =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5OUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

/** PNG bytes with the given declared dimensions (CRC not validated). */
export function pngBytes(width: number, height: number): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const length = Buffer.from([0x00, 0x00, 0x00, 0x0d]);
  const type = Buffer.from('IHDR');
  const dimensions = Buffer.alloc(8);
  dimensions.writeUInt32BE(width, 0);
  dimensions.writeUInt32BE(height, 4);
  const fields = Buffer.from([0x08, 0x06, 0x00, 0x00, 0x00]); // depth, color, compression, filter, interlace
  const crc = Buffer.alloc(4); // not validated
  return Buffer.concat([header, length, type, dimensions, fields, crc]);
}

export function pngDataUri(width: number, height: number): string {
  return `data:image/png;base64,${pngBytes(width, height).toString('base64')}`;
}

/**
 * JPEG bytes with the given declared dimensions: SOI + a minimal SOF0
 * segment + EOI. Enough for the validator's marker scan; not decodable.
 */
export function jpegBytes(width: number, height: number): Buffer {
  const prefix = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  const dimensions = Buffer.alloc(4);
  dimensions.writeUInt16BE(height, 0);
  dimensions.writeUInt16BE(width, 2);
  const components = Buffer.from([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([prefix, dimensions, components, Buffer.from([0xff, 0xd9])]);
}

export function jpegDataUri(width: number, height: number): string {
  return `data:image/jpeg;base64,${jpegBytes(width, height).toString('base64')}`;
}
