/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: '#0A0A0A',
        well: '#000000',
        carbon: '#161616',
        aluminium: '#8A8A8A',
        chalk: '#FAFAFA',
        signal: '#D71921',
      },
      fontFamily: {
        dot: ['"LED Counter 7"', 'monospace'],
        sans: ['"Geist Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', '"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '6px',
        well: '8px',
      },
      boxShadow: {
        active: '0 0 24px rgba(250,250,250,0.12)',
        signal: '0 0 20px rgba(215,25,33,0.30)',
      },
      backgroundImage: {
        dotgrid: 'radial-gradient(rgba(138,138,138,0.06) 1px, transparent 1px)',
      },
      backgroundSize: {
        dotgrid: '8px 8px',
      },
      letterSpacing: {
        label: '0.06em',
      },
    },
  },
  plugins: [],
};
