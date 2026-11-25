import { ShopperNotificationListener } from './shopper-notification.listener';
import { ShopperApprovedEvent, ShopperSentBackEvent } from '@/common/events';
import { NotificationsService } from '@/modules/notifications/notifications.service';

describe('ShopperNotificationListener', () => {
  let notifications: { create: jest.Mock };
  let listener: ShopperNotificationListener;

  beforeEach(() => {
    notifications = { create: jest.fn().mockResolvedValue(null) };
    listener = new ShopperNotificationListener(notifications as unknown as NotificationsService);
  });

  it('creates an approval notification', async () => {
    await listener.handleShopperApproved(new ShopperApprovedEvent('u1', 'p1', 'a@b.com', 'a'));
    expect(notifications.create).toHaveBeenCalledWith('u1', {
      type: 'shopper.approved',
      title: 'Application approved',
      body: 'You can now go online and start receiving requests.',
      href: '/shopper',
      data: { shopperProfileId: 'p1' },
    });
  });

  it('creates a send-back notification carrying the admin reason', async () => {
    await listener.handleShopperSentBack(
      new ShopperSentBackEvent('u1', 'p1', 'a@b.com', 'a', 'Add a market.'),
    );
    expect(notifications.create).toHaveBeenCalledWith('u1', {
      type: 'shopper.sent_back',
      title: 'Application needs changes',
      body: 'Add a market.',
      href: '/shopper/onboarding',
      data: { shopperProfileId: 'p1' },
    });
  });

  it('truncates a long reason to 200 characters', async () => {
    await listener.handleShopperSentBack(
      new ShopperSentBackEvent('u1', 'p1', 'a@b.com', 'a', 'x'.repeat(500)),
    );
    const { body } = notifications.create.mock.calls[0][1] as { body: string };
    expect(body).toHaveLength(200);
    expect(body.endsWith('…')).toBe(true);
  });
});
