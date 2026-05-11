/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // espresso → cream gradient palette
        roast: {
          950: "#0f0a07",
          900: "#1a1410",
          800: "#241a14",
          700: "#2e2218",
          600: "#3a2a1c",
          500: "#4a3624",
        },
        cream: {
          50: "#fbf3e2",
          100: "#f4e8d0",
          200: "#e8d4b0",
          300: "#d9be8c",
          400: "#c5a26a",
        },
        crema: {
          400: "#e89556",
          500: "#d97f3c",
          600: "#b8652a",
          700: "#8a4a1f",
        },
        signal: {
          500: "#7fb069",
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        pixel: ['"Departure Mono"', '"VT323"', 'ui-monospace', 'monospace'],
        display: ['"Pixelify Sans"', '"Departure Mono"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        pixel: "2px 2px 0 0 rgba(0,0,0,0.5)",
        "pixel-lg": "4px 4px 0 0 rgba(0,0,0,0.5)",
        "crema-glow": "0 0 20px rgba(217,127,60,0.35), 0 0 4px rgba(217,127,60,0.6)",
        "inset-pixel": "inset 0 0 0 1px rgba(244,232,208,0.08)",
      },
      backgroundImage: {
        "pour": "linear-gradient(180deg, #1a1410 0%, #241a14 35%, #3a2a1c 65%, #c5a26a 100%)",
        "scanlines":
          "repeating-linear-gradient(0deg, rgba(0,0,0,0.12) 0px, rgba(0,0,0,0.12) 1px, transparent 1px, transparent 3px)",
      },
      animation: {
        steam: "steam 3.5s ease-in-out infinite",
        spin: "spin 3s linear infinite",
        "pulse-slow": "pulse 2.4s ease-in-out infinite",
        blink: "blink 1.2s steps(2, end) infinite",
      },
      keyframes: {
        steam: {
          "0%, 100%": { transform: "translateY(0) translateX(0) scale(1)", opacity: "0.6" },
          "50%": { transform: "translateY(-8px) translateX(2px) scale(1.05)", opacity: "0.95" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};
