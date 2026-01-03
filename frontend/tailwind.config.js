/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#E44C2A",   // naranja principal (logo)
          600: "#CC4326",
          700: "#B43B22",
        },
        ink: {
          DEFAULT: "#0B0B0B",   // casi negro
          800: "#111111"
        }
      },
      boxShadow: {
        soft: "0 8px 30px rgba(0,0,0,0.08)"
      }
    },
  },
  plugins: [],
}
