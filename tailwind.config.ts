import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Palette Stoniz
        cream: 'var(--cream)',
        'cream-soft': 'var(--cream-soft)',
        yellow: 'var(--yellow)',
        'grey-text': 'var(--grey-text)',
        'grey-line': 'var(--grey-line)',
        accent: {
          DEFAULT: 'var(--yellow)',
          dark: 'var(--color-accent-dark)',
          light: 'var(--color-accent-light)',
        },
        stoniz: {
          black: 'var(--black)',
          cream: 'var(--cream)',
          yellow: 'var(--yellow)',
          gray: {
            50: 'var(--color-gray-50)',
            100: 'var(--color-gray-100)',
            200: 'var(--color-gray-200)',
            300: 'var(--color-gray-300)',
            400: 'var(--color-gray-400)',
            500: 'var(--color-gray-500)',
            600: 'var(--color-gray-600)',
            700: 'var(--color-gray-700)',
            800: '#1A1A1A',
          },
        },
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
        info: 'var(--color-info)',
        phase: {
          onboarding: 'var(--phase-onboarding)',
          sourcing: 'var(--phase-sourcing)',
          design: 'var(--phase-design)',
          travaux: 'var(--phase-travaux)',
          livraison: 'var(--phase-livraison)',
          location: 'var(--phase-mise_en_location)',
          termine: 'var(--phase-termine)',
        },
      },
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
        sans: ['var(--font-body)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: '24px',
      },
      letterSpacing: {
        tightest: '-0.03em',
        tighter: '-0.025em',
        tight: '-0.02em',
        wide: '0.13em',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
