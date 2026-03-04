import React from 'react';
import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components';
import { Tailwind } from '@react-email/tailwind';
import { emailTailwindConfig } from '../tailwind.email.config';

interface PasswordResetEmailProps {
  username: string;
  resetUrl: string;
}

export function PasswordResetEmail({ username, resetUrl }: PasswordResetEmailProps) {
  const year = new Date().getFullYear();

  return (
    <Html>
      <Head />
      <Preview>Reset your FetchIt password</Preview>
      <Tailwind config={emailTailwindConfig}>
        <Body className="bg-background font-sans text-gray-900">
          <Container className="mx-auto my-0 max-w-[600px] px-6 py-8">
            <Section className="rounded-t-xl bg-primary px-6 py-6 text-center">
              <Text className="m-0 text-2xl font-bold text-white">Reset Your Password</Text>
            </Section>
            <Section className="bg-white px-6 py-6">
              <Text className="mb-3 text-sm leading-6 text-gray-900">Hi {username},</Text>
              <Text className="mb-3 text-sm leading-6 text-gray-900">
                We received a request to reset your password. Click the button below to create a new
                password:
              </Text>
              <Section className="my-6 text-center">
                <Link
                  href={resetUrl}
                  className="inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white no-underline"
                >
                  Reset Password
                </Link>
              </Section>
              <Text className="mb-3 text-sm leading-6 text-gray-900">
                If you didn&apos;t request this, you can safely ignore this email. The link will
                expire in 1 hour.
              </Text>
              <Text className="mb-1 text-sm leading-6 text-gray-900">
                Or copy and paste this URL into your browser:
              </Text>
              <Text className="text-xs text-muted break-all">{resetUrl}</Text>
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
