import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0a0a0a",
          soft: "#1a1a1a",
        },
        cream: {
          50: "#fbf8f3",
          100: "#f5f0e8",
          200: "#ede5d5",
          300: "#e1d5bd",
        },
        gold: {
          DEFAULT: "#c9a96e",
          light: "#d9bf8a",
          dark: "#a88a52",
        },
      },
      fontFamily: {
        display: ["var(--font-cinzel)", "serif"],
        serif: ["var(--font-playfair)", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "luxury-gradient":
          "linear-gradient(135deg, #f5f0e8 0%, #ede5d5 50%, #e1d5bd 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
