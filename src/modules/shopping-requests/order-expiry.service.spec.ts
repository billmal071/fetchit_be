import { Logger } from '@nestjs/common';
import { OrderExpiryService } from './order-expiry.service';
import { EVENTS } from '@common/constants';
import { ShoppingOrderCancelledEvent } from '@common/events';
import { RULES, makeCustomerOrder } from './testing/fixtures';

describe('OrderExpiryService', () => {
  let orders: { expireStale: jest.Mock };
  let config: { getRules: jest.Mock };
  let events: { emit: jest.Mock };
  let service: OrderExpiryService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-25T10:00:00Z') });
    orders = { expireStale: jest.fn(async () => []) };
    config = {
      getRules: jest.fn(async () => ({
        ...RULES,
        shopperAcceptWindowMinutes: 20,
        offerWindowMinutes: 45,
      })),
    };
    events = { emit: jest.fn() };
    service = new OrderExpiryService(orders as never, config as never, events as never);
  });
  afterEach(() => jest.useRealTimers());

  it('reads both windows from the config: stale means assigned before now - accept window, reopen = the offer window in minutes', async () => {
    await service.sweep({ customerId: 'cust-1' });
    expect(orders.expireStale).toHaveBeenCalledWith(
      { customerId: 'cust-1' },
      new Date('2026-11-25T09:40:00Z'),
      45,
    );
  });

  it('follows a changed config', async () => {
    config.getRules.mockResolvedValue({
      ...RULES,
      shopperAcceptWindowMinutes: 5,
      offerWindowMinutes: 10,
    });
    await service.sweep({ orderId: 'o' });
    expect(orders.expireStale).toHaveBeenCalledWith(
      { orderId: 'o' },
      new Date('2026-11-25T09:55:00Z'),
      10,
    );
  });

  it('tells the shopper of each order it cancelled, once, without any customer text', async () => {
    orders.expireStale.mockResolvedValue([
      {
        order: makeCustomerOrder(),
        shopperUserId: 'shopper-user',
        requestReference: 'SR-ABC23456',
        cancelledBy: 'SYSTEM',
      },
    ]);
    await service.sweep({ orderId: 'order-1' });

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(
      EVENTS.SHOPPING_ORDER_CANCELLED,
      new ShoppingOrderCancelledEvent(
        'order-1',
        'SO-ABC23456',
        'req-1',
        'SR-ABC23456',
        'shopper-user',
        'SYSTEM',
      ),
    );
  });

  it('emits nothing when nothing was stale', async () => {
    await service.sweep({ shopperProfileId: 'prof-1' });
    expect(events.emit).not.toHaveBeenCalled();
  });

  describe('windows read once, and the targeted accept-expiry cancel', () => {
    const cancelled = {
      outcome: 'cancelled',
      order: makeCustomerOrder({ state: 'CANCELLED' }),
      shopperUserId: 'shopper-user',
      requestReference: 'SR-ABC23456',
      cancelledBy: 'SYSTEM',
    };
    const cutoff = new Date('2026-11-25T09:40:00Z');

    beforeEach(() => {
      (orders as Record<string, jest.Mock>).cancelOrder = jest.fn();
    });

    it('reads the config once for both windows, and a sweep given them reads nothing more', async () => {
      const windows = await service.windows();
      expect(windows).toEqual({ acceptWindowMinutes: 20, offerWindowMinutes: 45 });
      config.getRules.mockClear();

      await service.sweep({ orderId: 'o' }, { acceptWindowMinutes: 3, offerWindowMinutes: 4 });
      expect(config.getRules).not.toHaveBeenCalled();
      expect(orders.expireStale).toHaveBeenCalledWith(
        { orderId: 'o' },
        new Date('2026-11-25T09:57:00Z'),
        4,
      );
    });

    it('cancels the TARGET order as SYSTEM with the very cutoff it was given, and announces it', async () => {
      (orders as Record<string, jest.Mock>).cancelOrder.mockResolvedValue(cancelled);
      expect(await service.cancelAfterAcceptTimeout('order-1', cutoff, 45)).toBe(
        'CANCELLED_BY_SYSTEM',
      );
      expect((orders as Record<string, jest.Mock>).cancelOrder).toHaveBeenCalledWith({
        orderId: 'order-1',
        actor: { kind: 'SYSTEM' },
        assignedBefore: cutoff,
        reopenWindowMinutes: 45,
      });
      expect(events.emit).toHaveBeenCalledTimes(1);
    });

    it('says who cancelled first when the order was already cancelled, announcing nothing', async () => {
      const cancelOrder = (orders as Record<string, jest.Mock>).cancelOrder;
      cancelOrder.mockResolvedValueOnce({
        outcome: 'already_cancelled',
        order: makeCustomerOrder({ state: 'CANCELLED', cancelledBy: 'CUSTOMER' }),
      });
      expect(await service.cancelAfterAcceptTimeout('order-1', cutoff, 45)).toBe(
        'CANCELLED_BY_CUSTOMER',
      );
      cancelOrder.mockResolvedValueOnce({
        outcome: 'already_cancelled',
        order: makeCustomerOrder({ state: 'CANCELLED', cancelledBy: 'SYSTEM' }),
      });
      expect(await service.cancelAfterAcceptTimeout('order-1', cutoff, 45)).toBe(
        'CANCELLED_BY_SYSTEM',
      );
      expect(events.emit).not.toHaveBeenCalled();
    });

    it.each([['not_stale'], ['not_found'], ['conflict']])(
      'reports NOT_CANCELLED when the cancel matched nothing (%s)',
      async (outcome) => {
        (orders as Record<string, jest.Mock>).cancelOrder.mockResolvedValue({
          outcome,
          state: 'ASSIGNED',
        });
        expect(await service.cancelAfterAcceptTimeout('order-1', cutoff, 45)).toBe('NOT_CANCELLED');
        expect(events.emit).not.toHaveBeenCalled();
      },
    );

    it('reports NOT_CANCELLED, and logs, when the cancel throws (it rolled back)', async () => {
      (orders as Record<string, jest.Mock>).cancelOrder.mockRejectedValue(
        new Error('lock timeout'),
      );
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        expect(await service.cancelAfterAcceptTimeout('order-1', cutoff, 45)).toBe('NOT_CANCELLED');
        expect(String(logged.mock.calls[0][0])).toContain('lock timeout');
        expect(events.emit).not.toHaveBeenCalled();
      } finally {
        logged.mockRestore();
      }
    });
  });
});
