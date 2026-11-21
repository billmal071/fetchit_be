import {
  isAllowedPushEndpoint,
  isValidAllowedHostEntry,
  parseAllowedHosts,
} from './push-endpoint.util';

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:443/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://foo.push.services.mozilla.com/x',
    'https://db5p.notify.windows.com/w/?token=1',
    'https://web.push.apple.com/abc',
    'https://x.push.apple.com/abc',
    'https://FCM.GoogleAPIs.com/fcm/send/abc',
    'https://fcm.googleapis.com./fcm/send/abc',
  ])('allows %s', (url) => expect(isAllowedPushEndpoint(url)).toBe(true));

  it.each([
    'https://127.0.0.1/',
    'https://169.254.169.254/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://2130706433/',
    'https://metadata.google.internal/',
    'https://x.com:22/',
    'https://fcm.googleapis.com:8443/',
    'https://a.b@evil.com/',
    'https://user:pw@fcm.googleapis.com/',
    'https://evil.com\\@fcm.googleapis.com/',
    'https://fcm.googleapis.com\\@evil.com/',
    'http://fcm.googleapis.com/x',
    'ftp://fcm.googleapis.com/x',
    'https://evilfcm.googleapis.com/',
    'https://fcm.googleapis.com.evil.com/',
    'https://notify.windows.com/',
    'https://evilpush.apple.com.attacker.io/',
    'https://xpush.apple.com/',
    'not a url',
    '',
  ])('rejects %s', (url) => expect(isAllowedPushEndpoint(url)).toBe(false));

  it('uses PUSH_ALLOWED_HOSTS entries instead of defaults when given', () => {
    const hosts = ['push.example.com', '.corp.example.org'];
    expect(isAllowedPushEndpoint('https://push.example.com/x', hosts)).toBe(true);
    expect(isAllowedPushEndpoint('https://a.corp.example.org/x', hosts)).toBe(true);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/x', hosts)).toBe(false);
    expect(isAllowedPushEndpoint('https://127.0.0.1/', ['127.0.0.1'])).toBe(false);
  });
});

describe('PUSH_ALLOWED_HOSTS parsing', () => {
  it('normalises case, whitespace and empties', () => {
    expect(parseAllowedHosts(' A.com, ,.B.org ,')).toEqual(['a.com', '.b.org']);
    expect(parseAllowedHosts(undefined)).toEqual([]);
  });

  it.each(['a.com', '.a.com', 'x.y.example.org'])('accepts entry %s', (e) =>
    expect(isValidAllowedHostEntry(e)).toBe(true),
  );
  it.each([
    '127.0.0.1',
    '::1',
    'https://a.com',
    'a.com:443',
    'a.com/x',
    'localhost',
    '.',
    '*.a.com',
  ])('rejects entry %s', (e) => expect(isValidAllowedHostEntry(e)).toBe(false));
});
