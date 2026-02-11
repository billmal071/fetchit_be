interface IConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any[]; // Tailwind content can be very complex, keeping as any[] for simplicity here
  theme: {
    extend: {
      colors: Record<string, string | Record<string, string>>;
      borderRadius: Record<string, string>;
    };
  };
}

// Tailwind config scoped for React Email templates only.
export const emailTailwindConfig: IConfig = {
  content: [],
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
