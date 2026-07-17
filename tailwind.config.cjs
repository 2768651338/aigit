/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          base: "#0a0a0a",
          surface: "#141414",
          elevated: "#1a1a1a",
          hover: "#222222",
        },
        border: {
          DEFAULT: "#262626",
          subtle: "#1f1f1f",
          strong: "#333333",
        },
        text: {
          primary: "#e5e5e5",
          secondary: "#888888",
          muted: "#555555",
        },
        accent: {
          DEFAULT: "#d4ff3a",
          dim: "#a8cc2e",
          glow: "rgba(212, 255, 58, 0.15)",
        },
        danger: "#ff4757",
        warning: "#ffa502",
        success: "#2ed573",
        info: "#54a0ff",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Code", "monospace"],
      },
      fontSize: {
        "2xs": "0.625rem",
      },
      animation: {
        "fade-in": "fadeIn 0.15s ease-out",
        "slide-up": "slideUp 0.2s ease-out",
        "pulse-dot": "pulseDot 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseDot: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
    },
  },
  plugins: [],
};
