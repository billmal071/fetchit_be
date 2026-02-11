import React from 'react';
import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components';
import { Tailwind } from '@react-email/tailwind';

interface EmailVerificationEmailProps {
  username: string;
  verificationUrl: string;
}

export function EmailVerificationEmail({ username, verificationUrl }: EmailVerificationEmailProps) {
  const year = new Date().getFullYear();

  return (
    <Html>
      <Head />
      <Preview>Verify your FetchIt email</Preview>
      <Tailwind>
        <Body className="bg-background font-sans text-gray-900">
          <Container className="mx-auto my-0 max-w-[600px] px-6 py-8">
            <Section className="rounded-t-xl bg-primary px-6 py-6 text-center">
              <Text className="m-0 text-2xl font-bold text-white">Verify Your Email</Text>
            </Section>
            <Section className="bg-white px-6 py-6">
              <Text className="mb-3 text-sm leading-6 text-gray-900">Hi {username},</Text>
              <Text className="mb-3 text-sm leading-6 text-gray-900">
                Thanks for signing up! Please verify your email address by clicking the button
                below:
              </Text>
              <Section className="my-6 text-center">
                <Link
                  href={verificationUrl}
                  className="inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white no-underline"
                >
                  Verify Email
                </Link>
              </Section>
              <Text className="mb-3 text-sm leading-6 text-gray-900">
                This link will expire in 24 hours.
              </Text>
              <Text className="mb-1 text-sm leading-6 text-gray-900">
                Or copy and paste this URL into your browser:
              </Text>
              <Text className="text-xs text-muted break-all">{verificationUrl}</Text>
            </Section>
            <Section className="rounded-b-xl bg-gray-50 px-6 py-4 text-center">
              <Text className="m-0 text-xs text-muted">
                © {year} FetchIt. All rights reserved.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
