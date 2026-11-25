import type { ReactElement } from 'react';
import { render } from '@react-email/render';
import { EmailTemplateService } from './email-template.service';
import { ShopperApplicationEmail } from './templates/ShopperApplicationEmail';

// @react-email/render uses a dynamic import that jest cannot run without
// --experimental-vm-modules, so it is stubbed and the element handed to it is
// inspected instead.
jest.mock('@react-email/render', () => ({ render: jest.fn().mockResolvedValue('<html/>') }));

describe('EmailTemplateService shopper templates', () => {
  const service = new EmailTemplateService();
  const renderMock = render as jest.Mock;

  const renderedElement = (): ReactElement => renderMock.mock.calls[0][0] as ReactElement;

  beforeEach(() => renderMock.mockClear());

  it('renders the approval email', async () => {
    await expect(service.renderTemplate('shopper-approved', { username: 'amaka' })).resolves.toBe(
      '<html/>',
    );

    expect(renderedElement().type).toBe(ShopperApplicationEmail);
    expect(renderedElement().props).toEqual({ outcome: 'approved', username: 'amaka' });
  });

  it('passes the admin reason to the send-back email', async () => {
    await service.renderTemplate('shopper-needs-update', {
      username: 'amaka',
      reason: 'Please add a market you know well.',
    });

    expect(renderedElement().type).toBe(ShopperApplicationEmail);
    expect(renderedElement().props).toEqual({
      outcome: 'needs-update',
      username: 'amaka',
      reason: 'Please add a market you know well.',
    });
  });
});
