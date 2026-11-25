import { isValidElement, type ReactNode } from 'react';
import { ShopperApplicationEmail } from './ShopperApplicationEmail';

/**
 * Every text node in the element tree the component returns. Rendering to
 * markup is not an option here: the Tailwind wrapper suspends under
 * synchronous rendering.
 */
const textNodes = (node: ReactNode): string[] => {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textNodes);
  if (isValidElement<{ children?: ReactNode }>(node)) return textNodes(node.props.children);
  return [];
};

const textOf = (props: Parameters<typeof ShopperApplicationEmail>[0]): string[] =>
  textNodes(ShopperApplicationEmail(props));

describe('ShopperApplicationEmail', () => {
  it('uses a real apostrophe in the approval heading, not an HTML entity', () => {
    const text = textOf({ outcome: 'approved', username: 'amaka' });

    // A JS string containing "&apos;" is escaped by React to "&amp;apos;", so the
    // reader would see the literal characters "&apos;".
    expect(text).toContain("You're Approved!");
    expect(text.some((t) => t.includes('&apos;'))).toBe(false);
  });

  it('shows the admin reason only when the application is sent back', () => {
    const sentBack = textOf({
      outcome: 'needs-update',
      username: 'amaka',
      reason: 'Add a market.',
    });
    const approved = textOf({ outcome: 'approved', username: 'amaka', reason: 'Add a market.' });

    expect(sentBack).toContain('Add a market.');
    expect(sentBack).toContain('Application Update Needed');
    expect(approved).not.toContain('Add a market.');
  });
});
