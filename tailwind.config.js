module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#c89b3c',
        secondary: '#00d4ff',
        accent: '#ff4444',
        'hud-cyan': '#00F2FF',
        'hud-emerald': '#00FF88',
        'hud-amber': '#FFD600',
        'hud-red': '#FF2D55',
        'hud-bg': '#050505',
        'hud-card': 'rgba(8, 10, 18, 0.65)',
      },
    },
  },
  plugins: [],
}
