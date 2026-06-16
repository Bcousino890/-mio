import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        sidebar: {
          bg: '#0f1117',
          border: '#1e2130',
          hover: '#1a1f2e',
          active: '#1e2a45',
          text: '#8892a4',
          'text-active': '#e2e8f0',
        },
        brand: {
          DEFAULT: '#3b82f6',
          dim: '#1d4ed8',
        },
      },
    },
  },
  plugins: [],
}

export default config
