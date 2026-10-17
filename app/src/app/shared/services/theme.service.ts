import { Injectable, signal, effect } from '@angular/core';

export type Theme = 'light' | 'dark';

/**
 * Service to manage the application theme (light/dark mode)
 * Persists preference to localStorage and syncs with system preference
 */
@Injectable({
    providedIn: 'root',
})
export class ThemeService {
    private readonly STORAGE_KEY = 'theme';

    /** Current theme signal */
    readonly theme = signal<Theme>(this.getInitialTheme());

    /** Whether dark mode is active */
    readonly isDark = signal<boolean>(this.theme() === 'dark');

    constructor() {
        // Apply theme whenever it changes
        effect(() => {
            const currentTheme = this.theme();
            this.applyTheme(currentTheme);
            this.isDark.set(currentTheme === 'dark');
            localStorage.setItem(this.STORAGE_KEY, currentTheme);
        });
    }

    /**
     * Toggle between light and dark mode
     */
    toggle(): void {
        this.theme.update(t => (t === 'dark' ? 'light' : 'dark'));
    }

    /**
     * Set a specific theme
     */
    setTheme(theme: Theme): void {
        this.theme.set(theme);
    }

    /**
     * Get the initial theme from storage or system preference
     */
    private getInitialTheme(): Theme {
        // Check localStorage first
        const stored = localStorage.getItem(this.STORAGE_KEY) as Theme | null;
        if (stored === 'light' || stored === 'dark') {
            return stored;
        }

        // Fall back to system preference
        if (typeof window !== 'undefined') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
            return prefersDark.matches ? 'dark' : 'dark'; // Default to dark
        }

        return 'dark'; // Default
    }

    /**
     * Apply theme class to document
     */
    private applyTheme(theme: Theme): void {
        if (typeof document === 'undefined') return;

        const root = document.documentElement;

        if (theme === 'dark') {
            root.classList.remove('light');
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
            root.classList.add('light');
        }
    }
}
