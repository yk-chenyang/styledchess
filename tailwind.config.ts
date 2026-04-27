import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        chess: {
          green: '#769656',
          'green-dark': '#5a7a40',
          'green-light': '#9ab86e',
          light: '#f0d9b5',
          dark: '#b58863',
          bg: '#1a1a2e',
          'bg-card': '#252538',
          'bg-hover': '#2e2e48',
          'text-primary': '#e8e8e8',
          'text-secondary': '#a0a0b8',
          'border': '#3a3a56',
          'accent': '#769656',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
};
export default config;
