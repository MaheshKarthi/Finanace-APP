/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#4f46e5', light: '#818cf8', dark: '#3730a3' },
      },
    },
  },
  plugins: [],
};

