import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Catppuccin Mocha palette
        rosewater: 'hsl(var(--ctp-rosewater))',
        flamingo: 'hsl(var(--ctp-flamingo))',
        pink: 'hsl(var(--ctp-pink))',
        mauve: 'hsl(var(--ctp-mauve))',
        red: 'hsl(var(--ctp-red))',
        maroon: 'hsl(var(--ctp-maroon))',
        peach: 'hsl(var(--ctp-peach))',
        yellow: 'hsl(var(--ctp-yellow))',
        green: 'hsl(var(--ctp-green))',
        teal: 'hsl(var(--ctp-teal))',
        sky: 'hsl(var(--ctp-sky))',
        sapphire: 'hsl(var(--ctp-sapphire))',
        blue: 'hsl(var(--ctp-blue))',
        lavender: 'hsl(var(--ctp-lavender))',
        text: 'hsl(var(--ctp-text))',
        subtext1: 'hsl(var(--ctp-subtext1))',
        subtext0: 'hsl(var(--ctp-subtext0))',
        overlay2: 'hsl(var(--ctp-overlay2))',
        overlay1: 'hsl(var(--ctp-overlay1))',
        overlay0: 'hsl(var(--ctp-overlay0))',
        surface2: 'hsl(var(--ctp-surface2))',
        surface1: 'hsl(var(--ctp-surface1))',
        surface0: 'hsl(var(--ctp-surface0))',
        base: 'hsl(var(--ctp-base))',
        mantle: 'hsl(var(--ctp-mantle))',
        crust: 'hsl(var(--ctp-crust))',
        
        // Theme mappings
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-soft': 'pulse-soft 3s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;