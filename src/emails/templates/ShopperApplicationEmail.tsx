import React from 'react';
import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components';
import { Tailwind } from '@react-email/tailwind';
import { emailTailwindConfig } from '../tailwind.email.config';

interface ShopperApplicationEmailProps {
  outcome: 'approved' | 'needs-update';
  username: string;
  /** The admin's reason; only shown when the application is sent back. */
  reason?: string;
}

export function ShopperApplicationEmail({
  outcome,
  username,
  reason,
}: ShopperApplicationEmailProps) {
  const year = new Date().getFullYear();
  const approved = outcome === 'approved';

  return (
    <Html>
      <Head />
      <Preview>
        {approved
          ? 'Your FetchIt shopper application is approved'
          : 'Your FetchIt shopper application needs an update'}
      </Preview>
      <Tailwind config={emailTailwindConfig}>
        <Body className="bg-background font-sans text-gray-900">
          <Container className="mx-auto my-0 max-w-[600px] px-6 py-8">
            <Section className="rounded-t-xl bg-primary px-6 py-6 text-center">
              <Text className="m-0 text-2xl font-bold text-white">
                {approved ? 'You&apos;re Approved!' : 'Application Update Needed'}
              </Text>
            </Section>
            <Section className="bg-white px-6 py-6">
              <Text className="mb-3 text-sm leading-6 text-gray-900">Hi {username},</Text>
              {approved ? (
                <Text className="mb-3 text-sm leading-6 text-gray-900">
                  Your shopper application has been approved. You can now go online and start
                  receiving shopping requests.
                </Text>
              ) : (
                <>
                  <Text className="mb-3 text-sm leading-6 text-gray-900">
                    Your shopper application needs a few changes before we can approve it. Here is
                    what our team said:
                  </Text>
                  <Text className="mb-3 rounded-lg bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-900">
                    {reason}
                  </Text>
                  <Text className="mb-3 text-sm leading-6 text-gray-900">
                    Update your application in the app and resubmit it for review.
                  </Text>
                </>
              )}
            </Section>
            <Section className="rounded-b-xl bg-gray-50 px-6 py-4 text-center">
              <Text className="m-0 text-xs text-muted">© {year} FetchIt. All rights reserved.</Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
