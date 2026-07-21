/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          base: "#0a0a0a",
          surface: "#111111",
          elevated: "#161616",
          hover: "#1d1d1d",
        },
        border: {
          DEFAULT: "#242424",
          subtle: "#1c1c1c",
          strong: "#2e2e2e",
        },
        text: {
          primary: "#e5e5e5",
          secondary: "#888888",
          muted: "#555555",
        },
        accent: {
          DEFAULT: "#d4ff3a",
          dim: "#a8cc2e",
          subtle: "rgba(212, 255, 58, 0.08)",
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
        "2xs": "0.6875rem",
      },
      animation: {
        "fade-in": "fadeIn 0.15s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
