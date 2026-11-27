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

  it('reads both windows from the config: stale means assigned before now - accept window, reopen = now + offer window', async () => {
    await service.sweep({ customerId: 'cust-1' });
    expect(orders.expireStale).toHaveBeenCalledWith(
      { customerId: 'cust-1' },
      new Date('2026-11-25T09:40:00Z'),
      new Date('2026-11-25T10:45:00Z'),
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
      new Date('2026-11-25T10:10:00Z'),
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
});
