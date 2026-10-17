/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: 'class',
    content: [
        "./src/**/*.{html,ts}",
    ],
    theme: {
        extend: {
            colors: {
                // ═══════════════════════════════════════════════════════════
                // DIE LINKE BRAND COLORS
                // ═══════════════════════════════════════════════════════════

                // Primary Red
                'linke': {
                    DEFAULT: '#FF0000',
                    light: '#FF5050',
                    dark: '#6F003C',          // Dunkelrot
                    darker: '#1A000F',        // Very dark for dark mode backgrounds
                },

                // Dunkelgrün / Türkis pair
                'teal': {
                    DEFAULT: '#00B19C',       // Türkis (light)
                    light: '#00B19C',
                    dark: '#004B5B',          // Dunkelgrün
                    darker: '#001519',        // Very dark for dark mode
                },

                // Violett / Rosa pair
                'violet': {
                    DEFAULT: '#8100A1',       // Violett (dark)
                    light: '#D675D8',         // Rosa
                    dark: '#8100A1',
                    darker: '#1A0021',        // Very dark for dark mode
                },

                // Blau / Hellblau pair
                'blue': {
                    DEFAULT: '#2E4FC4',       // Blau (dark)
                    light: '#D4D4FF',         // Hellblau
                    dark: '#2E4FC4',
                    darker: '#0A1133',        // Very dark for dark mode
                },

                // ═══════════════════════════════════════════════════════════
                // THEME-AWARE SEMANTIC COLORS
                // ═══════════════════════════════════════════════════════════

                'primary': 'var(--color-primary)',
                'surface': {
                    DEFAULT: 'var(--color-surface)',
                    raised: 'var(--color-surface-raised)',
                    overlay: 'var(--color-surface-overlay)',
                },
                'foreground': {
                    DEFAULT: 'var(--color-text)',
                    muted: 'var(--color-text-muted)',
                },
            },
            keyframes: {
                blob: {
                    "0%": {
                        transform: "translate(0px, 0px) scale(1)",
                    },
                    "33%": {
                        transform: "translate(30px, -50px) scale(1.1)",
                    },
                    "66%": {
                        transform: "translate(-20px, 20px) scale(0.9)",
                    },
                    "100%": {
                        transform: "translate(0px, 0px) scale(1)",
                    },
                },
                'fadein-up': {
                    '0%': {
                        opacity: '0',
                        transform: 'translateY(20px)'
                    },
                    '100%': {
                        opacity: '1',
                        transform: 'translateY(0)'
                    },
                }
            },
            animation: {
                blob: "blob 7s infinite",
                'fadein-up': 'fadein-up 0.8s ease-out forwards',
            },
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
}
