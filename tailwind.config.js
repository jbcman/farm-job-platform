/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        farm: {
          green:  '#2d8a4e',
          light:  '#e8f5e9',
          mint:   '#a8d5b5',
          yellow: '#f59e0b',
          orange: '#ea580c',
          earth:  '#78350f',
          bg:     '#f7fdf9',
          ai:     '#6366f1',
        },
      },
      fontSize: {
        '2xs': '0.65rem',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
};
