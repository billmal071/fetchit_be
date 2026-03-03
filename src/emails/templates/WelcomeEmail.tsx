import React from 'react';
import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components';
import { Tailwind } from '@react-email/tailwind';
import { emailTailwindConfig } from '../tailwind.email.config';

interface WelcomeEmailProps {
  username: string;
}

export function WelcomeEmail({ username }: WelcomeEmailProps) {
  const year = new Date().getFullYear();

  return (
    <Html>
      <Head />
      <Preview>Welcome to FetchIt!</Preview>
      <Tailwind config={emailTailwindConfig}>
        <Body className="bg-background font-sans text-gray-900">
          <Container className="mx-auto my-0 max-w-[600px] px-6 py-8">
            <Section className="rounded-t-xl bg-primary px-6 py-6 text-center">
              <Text className="m-0 text-2xl font-bold text-white">Welcome to FetchIt!</Text>
            </Section>
            <Section className="bg-white px-6 py-6">
              <Text className="mb-3 text-sm leading-6 text-gray-900">Hi {username},</Text>
              <Text className="mb-3 text-sm leading-6 text-gray-900">
                Welcome to FetchIt! We&apos;re excited to have you on board.
              </Text>
              <Text className="mb-0 text-sm leading-6 text-gray-900">
                Get started by exploring our features and making your first fetch!
              </Text>
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
