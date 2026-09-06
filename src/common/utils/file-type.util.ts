/**
 * Content-type sniffing for uploads.
 *
 * A client-supplied MIME type and filename extension are both attacker
 * controlled and prove nothing about the bytes. Everything that decides how a
 * file is stored or served must come from the bytes themselves, so this module
 * inspects magic numbers and returns a canonical type or nothing at all.
 */

export interface ISniffedFileType {
  /** Canonical MIME type derived from the file's magic bytes. */
  mimeType: string;
  /** Canonical, dot-less extension for the detected type. */
  extension: string;
}

type Matcher = (buffer: Buffer) => boolean;

const startsWith =
  (bytes: number[]): Matcher =>
  (buffer: Buffer): boolean =>
    buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);

const SIGNATURES: Array<ISniffedFileType & { match: Matcher }> = [
  {
    mimeType: 'application/pdf',
    extension: 'pdf',
    // "%PDF-"
    match: startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]),
  },
  {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    match: startsWith([0xff, 0xd8, 0xff]),
  },
  {
    mimeType: 'image/png',
    extension: 'png',
    match: startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    mimeType: 'image/webp',
    extension: 'webp',
    // "RIFF" .... "WEBP"
    match: (buffer: Buffer): boolean =>
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP',
  },
];

/** MIME types this application is willing to accept for uploads. */
export const ALLOWED_UPLOAD_MIME_TYPES: readonly string[] = SIGNATURES.map(
  (signature) => signature.mimeType,
);

/**
 * Identify a buffer by its magic bytes.
 *
 * @returns the detected type, or `null` when the bytes match nothing on the
 *   allowlist — which callers must treat as a rejection, not as "unknown".
 */
export function sniffFileType(buffer: Buffer): ISniffedFileType | null {
  const signature = SIGNATURES.find((candidate) => candidate.match(buffer));
  return signature ? { mimeType: signature.mimeType, extension: signature.extension } : null;
}

/**
 * Reduce a client-supplied filename to something safe to store and display.
 * The result is never used to build a storage key — only kept as a label.
 */
export function sanitizeFileName(fileName: string | undefined, fallback: string): string {
  if (!fileName) return fallback;

  // Strip any directory component before touching the rest: a name like
  // "../../etc/passwd" must not survive as a path.
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- control characters are exactly what we are stripping
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);

  return cleaned || fallback;
}
