import type { TailwindConfig } from '@react-email/tailwind';

// Tailwind config scoped for React Email templates only.
export const emailTailwindConfig: TailwindConfig = {
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#4F46E5',
        },
        muted: '#6b7280',
        background: '#f3f4f6',
        surface: '#ffffff',
      },
      borderRadius: {
        xl: '0.75rem',
        full: '9999px',
      },
    },
  },
};
