import { ShoppingOrderListener } from './shopping-order.listener';
import { ShoppingOfferAcceptedEvent, ShoppingOrderCancelledEvent } from '@/common/events';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { PushService } from '@/modules/push/push.service';

describe('ShoppingOrderListener', () => {
  let notifications: { create: jest.Mock };
  let push: { sendToUser: jest.Mock };
  let listener: ShoppingOrderListener;
  const event = new ShoppingOfferAcceptedEvent(
    'order-1',
    'SO-ABC23456',
    'req-1',
    'SR-ABC23456',
    'winner',
    ['loser-1', 'loser-2'],
  );

  beforeEach(() => {
    notifications = { create: jest.fn().mockResolvedValue(undefined) };
    push = { sendToUser: jest.fn().mockResolvedValue(undefined) };
    listener = new ShoppingOrderListener(
      notifications as unknown as NotificationsService,
      push as unknown as PushService,
    );
  });

  it('notifies the winner in-app, linking to the order, and pushes to them', async () => {
    await listener.handleOfferAccepted(event);

    expect(notifications.create).toHaveBeenCalledWith('winner', {
      type: 'shopping.order.assigned',
      title: 'You won SR-ABC23456',
      body: 'Your offer was accepted. Order SO-ABC23456 is ready for you to accept.',
      href: '/shopper/orders/order-1',
      data: { orderId: 'order-1', requestId: 'req-1' },
    });
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(push.sendToUser).toHaveBeenCalledWith('winner', {
      title: 'You won SR-ABC23456',
      body: 'Your offer was accepted. Order SO-ABC23456 is ready for you to accept.',
      url: '/shopper/orders/order-1',
      tag: 'shopping-order-order-1',
    });
  });

  it('tells each losing shopper in-app only, with no push', async () => {
    await listener.handleOfferAccepted(event);

    for (const userId of ['loser-1', 'loser-2']) {
      expect(notifications.create).toHaveBeenCalledWith(userId, {
        type: 'shopping.offer.rejected',
        title: 'Offer not selected',
        body: 'The customer chose another shopper for SR-ABC23456.',
        href: '/shopper/offers',
        data: { requestId: 'req-1' },
      });
    }
    expect(push.sendToUser).not.toHaveBeenCalledWith('loser-1', expect.anything());
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('never throws if the push fails, and still notifies the losers', async () => {
    push.sendToUser.mockRejectedValue(new Error('nope'));
    await expect(listener.handleOfferAccepted(event)).resolves.toBeUndefined();
    expect(notifications.create).toHaveBeenCalledTimes(3);
  });

  describe('order cancelled', () => {
    it.each([
      ['CUSTOMER', 'The customer cancelled it before you accepted.'],
      ['SYSTEM', 'It was cancelled because it was not accepted in time.'],
    ] as const)(
      'tells the shopper in-app and by push when %s cancelled',
      async (cancelledBy, body) => {
        await listener.handleOrderCancelled(
          new ShoppingOrderCancelledEvent(
            'order-1',
            'SO-ABC23456',
            'req-1',
            'SR-ABC23456',
            'shopper-user',
            cancelledBy,
          ),
        );
        expect(notifications.create).toHaveBeenCalledWith('shopper-user', {
          type: 'shopping.order.cancelled',
          title: 'Order SO-ABC23456 cancelled',
          body,
          href: '/shopper/orders/order-1',
          data: { orderId: 'order-1', requestId: 'req-1', cancelledBy },
        });
        expect(push.sendToUser).toHaveBeenCalledWith('shopper-user', {
          title: 'Order SO-ABC23456 cancelled',
          body,
          url: '/shopper/orders/order-1',
          tag: 'shopping-order-order-1',
        });
      },
    );

    it('never throws if the push fails', async () => {
      push.sendToUser.mockRejectedValue(new Error('nope'));
      await expect(
        listener.handleOrderCancelled(
          new ShoppingOrderCancelledEvent(
            'order-1',
            'SO-ABC23456',
            'req-1',
            'SR-ABC23456',
            'shopper-user',
            'SYSTEM',
          ),
        ),
      ).resolves.toBeUndefined();
      expect(notifications.create).toHaveBeenCalledTimes(1);
    });
  });
});
