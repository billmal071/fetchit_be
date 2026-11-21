import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { BadRequestException, UnauthorizedException } from '@/common/exceptions';
import { Prisma } from '@prisma/client';
import { PushService } from './push.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

const mockedWebpush = webpush as unknown as {
  setVapidDetails: jest.Mock;
  sendNotification: jest.Mock;
};

const FULL = { vapidPublicKey: 'pub', vapidPrivateKey: 'priv', vapidSubject: 'mailto:a@b.com' };
const PAYLOAD = { title: 't', body: 'b', url: '/shopper', tag: 'x' };

const sub = (id: string): Record<string, string> => ({
  id,
  userId: 'u1',
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  p256dh: `p-${id}`,
  auth: `a-${id}`,
});

describe('PushService', () => {
  let repo: {
    upsertByEndpoint: jest.Mock;
    findByUserId: jest.Mock;
    deleteByEndpointForUser: jest.Mock;
    deleteById: jest.Mock;
    markUsed: jest.Mock;
  };

  const build = (push: Record<string, string> | undefined = FULL): PushService =>
    new PushService(repo as never, { get: () => push } as unknown as ConfigService);

  beforeEach(() => {
    jest.clearAllMocks();
    repo = {
      upsertByEndpoint: jest.fn().mockResolvedValue({}),
      findByUserId: jest.fn().mockResolvedValue([sub('1'), sub('2')]),
      deleteByEndpointForUser: jest.fn().mockResolvedValue(1),
      deleteById: jest.fn().mockResolvedValue(undefined),
      markUsed: jest.fn().mockResolvedValue(undefined),
    };
    mockedWebpush.sendNotification.mockResolvedValue({ statusCode: 201 });
  });

  describe('configuration', () => {
    it('is enabled with all three VAPID values and exposes the public key', () => {
      const service = build();
      expect(service.getConfig()).toEqual({ enabled: true, publicKey: 'pub' });
    });

    it('is disabled with null key when nothing is set', () => {
      const service = build({ vapidPublicKey: '', vapidPrivateKey: '', vapidSubject: '' });
      expect(service.getConfig()).toEqual({ enabled: false, publicKey: null });
    });

    it('treats a partial configuration as disabled and warns', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const service = build({ vapidPublicKey: 'pub', vapidPrivateKey: '', vapidSubject: '' });
      expect(service.getConfig()).toEqual({ enabled: false, publicKey: null });
      warn.mockRestore();
    });

    it('is disabled when web-push rejects the VAPID details', () => {
      mockedWebpush.setVapidDetails.mockImplementationOnce(() => {
        throw new Error('bad key');
      });
      expect(build().enabled).toBe(false);
    });
  });

  describe('sendToUser', () => {
    it('is a no-op when disabled', async () => {
      const service = build({ vapidPublicKey: '', vapidPrivateKey: '', vapidSubject: '' });
      await service.sendToUser('u1', PAYLOAD);
      expect(repo.findByUserId).not.toHaveBeenCalled();
      expect(mockedWebpush.sendNotification).not.toHaveBeenCalled();
    });

    it('sends the JSON payload to every subscription in parallel', async () => {
      const resolvers: Array<() => void> = [];
      mockedWebpush.sendNotification.mockImplementation(
        () => new Promise<void>((resolve) => resolvers.push(resolve)),
      );

      const done = build().sendToUser('u1', PAYLOAD);
      await new Promise((r) => setImmediate(r));

      // Both calls started before either resolved => parallel.
      expect(mockedWebpush.sendNotification).toHaveBeenCalledTimes(2);
      expect(mockedWebpush.sendNotification.mock.calls[0][0]).toEqual({
        endpoint: 'https://fcm.googleapis.com/fcm/send/1',
        keys: { p256dh: 'p-1', auth: 'a-1' },
      });
      expect(JSON.parse(mockedWebpush.sendNotification.mock.calls[0][1])).toEqual(PAYLOAD);

      resolvers.forEach((resolve) => resolve());
      await done;
    });

    it('updates lastUsedAt on success', async () => {
      await build().sendToUser('u1', PAYLOAD);
      expect(repo.markUsed).toHaveBeenCalledWith('1');
      expect(repo.markUsed).toHaveBeenCalledWith('2');
    });

    it('passes timeout and a 24h TTL to web-push', async () => {
      await build().sendToUser('u1', PAYLOAD);
      expect(mockedWebpush.sendNotification.mock.calls[0][2]).toMatchObject({
        timeout: 10000,
        TTL: 86400,
      });
    });

    it('deletes a stored subscription whose endpoint is no longer allowed and skips it', async () => {
      repo.findByUserId.mockResolvedValue([
        { ...sub('1'), endpoint: 'https://127.0.0.1/x' },
        sub('2'),
      ]);
      await build().sendToUser('u1', PAYLOAD);
      expect(repo.deleteById).toHaveBeenCalledWith('1');
      expect(mockedWebpush.sendNotification).toHaveBeenCalledTimes(1);
      expect(mockedWebpush.sendNotification.mock.calls[0][0].endpoint).toContain('/2');
    });

    it('honours PUSH_ALLOWED_HOSTS when sending', async () => {
      repo.findByUserId.mockResolvedValue([sub('1')]);
      const service = new PushService(
        repo as never,
        {
          get: () => ({ ...FULL, allowedHosts: ['push.example.com'] }),
        } as unknown as ConfigService,
      );
      await service.sendToUser('u1', PAYLOAD);
      expect(repo.deleteById).toHaveBeenCalledWith('1');
      expect(mockedWebpush.sendNotification).not.toHaveBeenCalled();
    });

    it.each([
      'The subscription p256dh value should be 65 bytes long.',
      'The subscription auth key should be at least 16 bytes long',
      'No user auth provided for encryption.',
    ])('deletes the subscription on key error "%s"', async (message) => {
      mockedWebpush.sendNotification
        .mockRejectedValueOnce(new Error(message))
        .mockResolvedValueOnce({});
      await build().sendToUser('u1', PAYLOAD);
      expect(repo.deleteById).toHaveBeenCalledTimes(1);
      expect(repo.deleteById).toHaveBeenCalledWith('1');
    });

    it('keeps the subscription on a network error without statusCode', async () => {
      mockedWebpush.sendNotification.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
      await build().sendToUser('u1', PAYLOAD);
      expect(repo.deleteById).not.toHaveBeenCalled();
    });

    it.each([404, 410])('deletes the subscription on %i and keeps the others', async (code) => {
      mockedWebpush.sendNotification
        .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: code }))
        .mockResolvedValueOnce({});

      await build().sendToUser('u1', PAYLOAD);

      expect(repo.deleteById).toHaveBeenCalledTimes(1);
      expect(repo.deleteById).toHaveBeenCalledWith('1');
      expect(repo.markUsed).toHaveBeenCalledTimes(1);
      expect(repo.markUsed).toHaveBeenCalledWith('2');
    });

    it('swallows other errors without deleting or marking used', async () => {
      mockedWebpush.sendNotification.mockRejectedValue(
        Object.assign(new Error('boom'), { statusCode: 500 }),
      );

      await expect(build().sendToUser('u1', PAYLOAD)).resolves.toBeUndefined();
      expect(repo.deleteById).not.toHaveBeenCalled();
      expect(repo.markUsed).not.toHaveBeenCalled();
    });

    it('swallows repository failures', async () => {
      repo.findByUserId.mockRejectedValue(new Error('db down'));
      await expect(build().sendToUser('u1', PAYLOAD)).resolves.toBeUndefined();
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('upserts by endpoint for the caller', async () => {
      await build().subscribe('u1', {
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        keys: { p256dh: 'p', auth: 'a' },
      });
      expect(repo.upsertByEndpoint).toHaveBeenCalledWith({
        userId: 'u1',
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        p256dh: 'p',
        auth: 'a',
        userAgent: null,
      });
    });

    it.each([
      'https://127.0.0.1/',
      'https://169.254.169.254/latest',
      'https://[::1]/',
      'https://metadata.google.internal/',
      'https://x.com:22/',
      'https://a.b@evil.com/',
      'https://evil.com\\@fcm.googleapis.com/',
      'http://fcm.googleapis.com/x',
    ])('rejects disallowed endpoint %s with 400 and does not store', async (endpoint) => {
      await expect(
        build().subscribe('u1', { endpoint, keys: { p256dh: 'p', auth: 'a' } }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.upsertByEndpoint).not.toHaveBeenCalled();
    });

    it('maps an FK violation (deleted user) to 401', async () => {
      repo.upsertByEndpoint.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' }),
      );
      await expect(
        build().subscribe('u1', {
          endpoint: 'https://fcm.googleapis.com/fcm/send/x',
          keys: { p256dh: 'p', auth: 'a' },
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('unsubscribes scoped to the caller and is idempotent', async () => {
      repo.deleteByEndpointForUser.mockResolvedValue(0);
      await expect(
        build().unsubscribe('u1', { endpoint: 'https://fcm.googleapis.com/fcm/send/x' }),
      ).resolves.toBeUndefined();
      expect(repo.deleteByEndpointForUser).toHaveBeenCalledWith(
        'https://fcm.googleapis.com/fcm/send/x',
        'u1',
      );
    });
  });
});
