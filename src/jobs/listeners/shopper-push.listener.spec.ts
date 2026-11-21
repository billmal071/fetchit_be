import { ShopperPushListener } from './shopper-push.listener';
import { ShopperApprovedEvent, ShopperSentBackEvent } from '@/common/events';
import { PushService } from '@/modules/push/push.service';

describe('ShopperPushListener', () => {
  let push: { sendToUser: jest.Mock };
  let listener: ShopperPushListener;

  beforeEach(() => {
    push = { sendToUser: jest.fn().mockResolvedValue(undefined) };
    listener = new ShopperPushListener(push as unknown as PushService);
  });

  it('pushes the approval to the shopper', async () => {
    await listener.handleShopperApproved(new ShopperApprovedEvent('u1', 'p1', 'a@b.com', 'a'));

    expect(push.sendToUser).toHaveBeenCalledWith('u1', {
      title: 'Application approved',
      body: 'You can now go online and start receiving requests.',
      url: '/shopper',
      tag: 'shopper-application',
    });
  });

  it('pushes the admin reason when sent back', async () => {
    await listener.handleShopperSentBack(
      new ShopperSentBackEvent('u1', 'p1', 'a@b.com', 'a', 'Add a market.'),
    );

    expect(push.sendToUser).toHaveBeenCalledWith('u1', {
      title: 'Application needs changes',
      body: 'Add a market.',
      url: '/shopper/onboarding',
      tag: 'shopper-application',
    });
  });

  it('truncates a long reason to 120 characters', async () => {
    await listener.handleShopperSentBack(
      new ShopperSentBackEvent('u1', 'p1', 'a@b.com', 'a', 'x'.repeat(500)),
    );

    const { body } = push.sendToUser.mock.calls[0][1] as { body: string };
    expect(body).toHaveLength(120);
    expect(body.endsWith('…')).toBe(true);
  });

  it('never throws if the push service does', async () => {
    push.sendToUser.mockRejectedValue(new Error('nope'));
    await expect(
      listener.handleShopperApproved(new ShopperApprovedEvent('u1', 'p1', 'a@b.com', 'a')),
    ).resolves.toBeUndefined();
    await expect(
      listener.handleShopperSentBack(new ShopperSentBackEvent('u1', 'p1', 'a@b.com', 'a', 'r')),
    ).resolves.toBeUndefined();
  });
});
