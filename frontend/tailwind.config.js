/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          400: "var(--accent-400)",
          500: "var(--accent-500)",
          600: "var(--accent-600)",
          700: "var(--accent-700, var(--accent-600))",
        },
        surface: {
          900: "var(--bg-900)",
          800: "var(--bg-800)",
          750: "var(--bg-750, var(--bg-700))",
          700: "var(--bg-700)",
          600: "var(--bg-600)",
          500: "var(--bg-500)",
          400: "var(--bg-400)",
        },
      },
    },
  },
  plugins: [],
};

