/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic design tokens (RGB triplets in CSS vars → opacity modifiers work)
        base: "rgb(var(--c-base) / <alpha-value>)",
        card: "rgb(var(--c-card) / <alpha-value>)",
        panel: "rgb(var(--c-panel) / <alpha-value>)",
        edge: "rgb(var(--c-edge) / <alpha-value>)",
        hi: "rgb(var(--c-ink-hi) / <alpha-value>)",
        mid: "rgb(var(--c-ink-mid) / <alpha-value>)",
        lo: "rgb(var(--c-ink-lo) / <alpha-value>)",
        cyan: "rgb(var(--c-cyan) / <alpha-value>)",
        green: "rgb(var(--c-green) / <alpha-value>)",
        rose: "rgb(var(--c-rose) / <alpha-value>)",
        violet: "rgb(var(--c-violet) / <alpha-value>)",
        amber: "rgb(var(--c-amber) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        display: ["Orbitron", "Inter", "sans-serif"],
      },
      boxShadow: {
        "glow-cyan": "0 0 24px rgb(var(--c-cyan) / 0.18)",
        "glow-violet": "0 0 24px rgb(var(--c-violet) / 0.22)",
        "glow-green": "0 0 24px rgb(var(--c-green) / 0.18)",
        "glow-rose": "0 0 24px rgb(var(--c-rose) / 0.18)",
      },
      keyframes: {
        "pulse-soft": { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.45" } },
        "shimmer": { "0%": { backgroundPosition: "-400px 0" }, "100%": { backgroundPosition: "400px 0" } },
        rise: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
        rise: "rise 0.35s ease both",
      },
    },
  },
  plugins: [],
};
