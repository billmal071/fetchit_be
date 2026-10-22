import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventsGateway } from './events.gateway';

/**
 * Regression tests for bug #1: any authenticated client could join an
 * arbitrary room (including another user's `user:<id>` room) via `join-room`,
 * and an unauthenticated socket stayed connected indefinitely. The fix
 * removes `join-room`/`leave-room` and disconnects unauthenticated sockets.
 */
describe('EventsGateway', () => {
  let gateway: EventsGateway;
  let jwtService: { verifyAsync: jest.Mock };

  const makeClient = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'socket-1',
    handshake: { headers: {}, auth: {} },
    join: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  });

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue({ secret: 'x' }) } },
      ],
    }).compile();

    gateway = module.get<EventsGateway>(EventsGateway);
  });

  it('disconnects a socket with no auth token instead of accepting it anonymously', async () => {
    const client = makeClient();

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it("joins only the caller's own user:<id> room for a valid token", async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', email: 'a@b.com' });
    const client = makeClient({
      handshake: { headers: { authorization: 'Bearer tok' }, auth: {} },
    });

    await gateway.handleConnection(client as never);

    expect(client.join).toHaveBeenCalledTimes(1);
    expect(client.join).toHaveBeenCalledWith('user:user-1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('has no handler that lets a client join an arbitrary room', () => {
    // The vulnerable surface, named explicitly so re-adding a free-form
    // join-room handler fails this test rather than slipping back in.
    expect((gateway as unknown as Record<string, unknown>).handleJoinRoom).toBeUndefined();
    expect((gateway as unknown as Record<string, unknown>).handleLeaveRoom).toBeUndefined();
  });
});
