// ABOUTME: Tailwind CSS v3 configuration for the dashboard.
// ABOUTME: Defines dark theme colors and custom utilities.

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/dashboard/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        background: "#0d1117",
        foreground: "#e4e4e7",
        card: {
          DEFAULT: "rgba(255, 255, 255, 0.03)",
          foreground: "#e4e4e7",
        },
        popover: {
          DEFAULT: "#1a1a2e",
          foreground: "#e4e4e7",
        },
        primary: {
          DEFAULT: "#2dd4bf",
          foreground: "#0d1117",
        },
        secondary: {
          DEFAULT: "rgba(255, 255, 255, 0.05)",
          foreground: "#e4e4e7",
        },
        muted: {
          DEFAULT: "rgba(255, 255, 255, 0.05)",
          foreground: "#71717a",
        },
        accent: {
          DEFAULT: "#06b6d4",
          foreground: "#0d1117",
        },
        destructive: {
          DEFAULT: "#ef4444",
          foreground: "#fef2f2",
        },
        border: "rgba(255, 255, 255, 0.1)",
        input: "rgba(255, 255, 255, 0.1)",
        ring: "#2dd4bf",
        // Status colors
        status: {
          idle: "#4ade80",
          working: "#60a5fa",
          starting: "#facc15",
        },
        // Linear state colors
        state: {
          planning: "#2dd4bf",
          building: "#60a5fa",
          feedback: "#fbbf24",
          review: "#2dd4bf",
          done: "#4ade80",
        },
      },
      fontFamily: {
        mono: ["SF Mono", "Monaco", "Menlo", "Inconsolata", "Consolas", "monospace"],
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.25rem",
      },
      animation: {
        "pulse-dot": "pulse-dot 1.5s ease-in-out infinite",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.5", transform: "scale(0.8)" },
        },
      },
    },
  },
  plugins: [],
};
