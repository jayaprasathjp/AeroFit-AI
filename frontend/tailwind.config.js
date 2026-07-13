/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // UPS brand palette — "Pullman Brown" + UPS Gold.
        ups: {
          brown: {
            DEFAULT: "#351C15",
            50: "#F5F1EF",
            100: "#E7DED9",
            200: "#C9B7AD",
            300: "#A88E7F",
            400: "#7C5E4C",
            500: "#5A3E28",
            600: "#4B2E1E",
            700: "#3D2418",
            800: "#351C15",
            900: "#26120D",
          },
          gold: {
            DEFAULT: "#FFB500",
            50: "#FFF8E6",
            100: "#FFEFBF",
            200: "#FFDE80",
            300: "#FFCF4D",
            400: "#FFC01F",
            500: "#FFB500",
            600: "#D99A00",
            700: "#B37E00",
          },
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(53, 28, 21, 0.06), 0 4px 16px rgba(53, 28, 21, 0.08)",
        "card-hover":
          "0 2px 4px rgba(53, 28, 21, 0.08), 0 12px 32px rgba(53, 28, 21, 0.12)",
        glow: "0 0 0 3px rgba(255, 181, 0, 0.35)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "bounce-dot": {
          "0%, 80%, 100%": { transform: "scale(0.6)", opacity: "0.4" },
          "40%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.28s ease-out both",
        "bounce-dot": "bounce-dot 1.2s infinite ease-in-out",
      },
    },
  },
  plugins: [],
};
