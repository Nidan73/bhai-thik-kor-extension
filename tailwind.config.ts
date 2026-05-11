import type { Config } from 'tailwindcss';

export default {
  content: ['./src/popup/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        btk: {
          primary: '#6366f1',
          'primary-hover': '#4f46e5',
          dark: '#0f172a',
          'dark-card': '#1e293b',
          'dark-border': '#334155',
          'dark-text': '#e2e8f0',
          'dark-muted': '#94a3b8',
          accent: '#a78bfa',
          success: '#34d399',
          error: '#f87171',
          warning: '#fbbf24',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
