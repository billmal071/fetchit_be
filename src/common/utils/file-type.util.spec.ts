import { sniffFileType, sanitizeFileName, ALLOWED_UPLOAD_MIME_TYPES } from './file-type.util';

const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(8)]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x20, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 '),
]);

describe('sniffFileType', () => {
  it.each([
    [pdf, 'application/pdf', 'pdf'],
    [jpeg, 'image/jpeg', 'jpg'],
    [png, 'image/png', 'png'],
    [webp, 'image/webp', 'webp'],
  ])('identifies an allowlisted type by its magic bytes', (buffer, mimeType, extension) => {
    expect(sniffFileType(buffer)).toEqual({ mimeType, extension });
  });

  it.each([
    ['a Windows executable', Buffer.from([0x4d, 0x5a, 0x90, 0x00])],
    ['an ELF binary', Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
    ['a ZIP/Office container', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ['an SVG (scriptable)', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />')],
    ['a truncated RIFF header', Buffer.from('RIFF')],
    ['an empty buffer', Buffer.alloc(0)],
  ])('rejects %s', (_label, buffer) => {
    expect(sniffFileType(buffer)).toBeNull();
  });

  it('ignores what the client claimed: a renamed executable is still rejected', () => {
    // The bytes are all that matter — this is the whole point of sniffing.
    expect(sniffFileType(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
  });

  it('exposes the allowlist it enforces', () => {
    expect(ALLOWED_UPLOAD_MIME_TYPES).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });
});

describe('sanitizeFileName', () => {
  it.each([
    ['../../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\id card.pdf', 'id_card.pdf'],
    ['..\\..\\evil.png', 'evil.png'],
    ['....//..//x.pdf', 'x.pdf'],
    ['normal-name_1.PNG', 'normal-name_1.PNG'],
  ])('strips path components from %s', (input, expected) => {
    expect(sanitizeFileName(input, 'fallback.pdf')).toBe(expected);
  });

  it.each([undefined, '', '/', '...', '???'])(
    'falls back when nothing usable is left (%s)',
    (input) => {
      expect(sanitizeFileName(input, 'fallback.pdf')).toBe(
        input === '???' ? '___' : 'fallback.pdf',
      );
    },
  );

  it('caps the length', () => {
    expect(sanitizeFileName(`${'a'.repeat(500)}.pdf`, 'fallback.pdf')).toHaveLength(200);
  });
});
