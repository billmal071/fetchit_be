import { ShopperEventsListener } from './shopper-events.listener';
import { ShopperApprovedEvent, ShopperSentBackEvent } from '@/common/events';
import { EmailService } from '../services';

describe('ShopperEventsListener', () => {
  let emailService: { sendEmail: jest.Mock };
  let listener: ShopperEventsListener;

  beforeEach(() => {
    emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    listener = new ShopperEventsListener(emailService as unknown as EmailService);
  });

  it('emails the shopper when approved', async () => {
    await listener.handleShopperApproved(
      new ShopperApprovedEvent('u1', 'p1', 'amaka@example.com', 'amaka'),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith({
      to: 'amaka@example.com',
      subject: 'Your FetchIt Shopper Application is Approved!',
      template: 'shopper-approved',
      context: { username: 'amaka' },
    });
  });

  it('emails the shopper the admin reason when sent back', async () => {
    await listener.handleShopperSentBack(
      new ShopperSentBackEvent('u1', 'p1', 'amaka@example.com', 'amaka', 'Add a market.'),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith({
      to: 'amaka@example.com',
      subject: 'Your FetchIt Shopper Application Needs an Update',
      template: 'shopper-needs-update',
      context: { username: 'amaka', reason: 'Add a market.' },
    });
  });

  it('swallows email failures', async () => {
    emailService.sendEmail.mockRejectedValue(new Error('resend down'));

    await expect(
      listener.handleShopperApproved(new ShopperApprovedEvent('u1', 'p1', 'a@b.com', 'a')),
    ).resolves.toBeUndefined();
    await expect(
      listener.handleShopperSentBack(new ShopperSentBackEvent('u1', 'p1', 'a@b.com', 'a', 'r')),
    ).resolves.toBeUndefined();
  });
});
