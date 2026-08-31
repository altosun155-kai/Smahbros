import type { Config } from 'tailwindcss';

// Tailwind v4 mostly configures via CSS (@theme in the entry stylesheet), but
// still supports this file for the parts that read better as JS -- here,
// mapping Tailwind's color utilities onto the existing CSS custom properties
// in web/app/styles/tokens.css (themselves promoted from web/public/css/style.css)
// so a Tailwind class and a legacy CSS class resolve to the identical value,
// not a second copy of the same color that can drift.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface-1)',
        surface2: 'var(--surface-2)',
        accent: 'var(--accent-gold)',
        muted: 'var(--accent-blue)', // legacy name is a neutral gray, not blue -- see tokens.css
        danger: 'var(--danger)',
        success: 'var(--success)',
        text: 'var(--text)',
        'text-muted': 'var(--text-muted)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
      },
      fontFamily: {
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
      spacing: {
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        5: 'var(--space-5)',
        6: 'var(--space-6)',
        7: 'var(--space-7)',
        8: 'var(--space-8)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        modal: 'var(--shadow-modal)',
        dropdown: 'var(--shadow-dropdown)',
      },
    },
  },
};

export default config;
