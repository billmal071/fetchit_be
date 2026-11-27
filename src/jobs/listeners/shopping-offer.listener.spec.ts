import { ShoppingOfferListener } from './shopping-offer.listener';
import { ShoppingOfferSubmittedEvent } from '@/common/events';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { PushService } from '@/modules/push/push.service';

describe('ShoppingOfferListener', () => {
  let notifications: { create: jest.Mock };
  let push: { sendToUser: jest.Mock };
  let listener: ShoppingOfferListener;
  const event = new ShoppingOfferSubmittedEvent(
    'cust-1',
    'req-1',
    'SR-ABC23456',
    'offer-1',
    'Amaka O.',
    1500,
    12345,
  );

  beforeEach(() => {
    notifications = { create: jest.fn().mockResolvedValue(undefined) };
    push = { sendToUser: jest.fn().mockResolvedValue(undefined) };
    listener = new ShoppingOfferListener(
      notifications as unknown as NotificationsService,
      push as unknown as PushService,
    );
  });

  it('creates an in-app notification for the customer that links to the request', async () => {
    await listener.handleOfferSubmitted(event);

    expect(notifications.create).toHaveBeenCalledWith('cust-1', {
      type: 'shopping.offer.received',
      title: 'New offer on SR-ABC23456',
      body: 'Amaka O. offered to shop for ₦12,345 total (shopper fee ₦1,500).',
      href: '/customer/shopping-requests/req-1',
      data: { requestId: 'req-1', offerId: 'offer-1' },
    });
  });

  it('pushes to the customer, collapsing repeats per request', async () => {
    await listener.handleOfferSubmitted(event);

    expect(push.sendToUser).toHaveBeenCalledWith('cust-1', {
      title: 'New offer on SR-ABC23456',
      body: 'Amaka O. offered to shop for ₦12,345 total (shopper fee ₦1,500).',
      url: '/customer/shopping-requests/req-1',
      tag: 'shopping-request-req-1',
    });
  });

  it('never throws if the push service does, and still created the in-app notification', async () => {
    push.sendToUser.mockRejectedValue(new Error('nope'));

    await expect(listener.handleOfferSubmitted(event)).resolves.toBeUndefined();
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });
});
