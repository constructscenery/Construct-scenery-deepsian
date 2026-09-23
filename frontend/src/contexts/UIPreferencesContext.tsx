'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface UIPreferencesContextType {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  sidebarIcons: boolean;
  toggleSidebarIcons: () => void;
  setSidebarIcons: (enabled: boolean) => void;
}

const UIPreferencesContext = createContext<UIPreferencesContextType | null>(null);

const THEME_KEY = 'cs_theme';
const SIDEBAR_ICONS_KEY = 'cs_sidebar_icons';
const MIGRATION_KEY = 'cs_ui_v2';

export function UIPreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [sidebarIcons, setSidebarIconsState] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);

  // Initialize from localStorage or defaults (night mode & no icons)
  useEffect(() => {
    try {
      if (localStorage.getItem(MIGRATION_KEY) !== 'true') {
        localStorage.removeItem(THEME_KEY);
        localStorage.removeItem(SIDEBAR_ICONS_KEY);
        localStorage.setItem(MIGRATION_KEY, 'true');
      }

      const storedTheme = localStorage.getItem(THEME_KEY) as Theme | null;
      if (storedTheme === 'light') {
        setThemeState('light');
      } else {
        setThemeState('dark');
      }

      const storedIcons = localStorage.getItem(SIDEBAR_ICONS_KEY);
      if (storedIcons === 'true') {
        setSidebarIconsState(true);
      } else {
        setSidebarIconsState(false);
      }
    } catch {
      // LocalStorage access might fail in private browsing
    }
    setMounted(true);
  }, []);

  // Sync theme to <html> class & color-scheme
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme, mounted]);

  // Sync sidebar icons to localStorage
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(SIDEBAR_ICONS_KEY, String(sidebarIcons));
    } catch {
      /* ignore */
    }
  }, [sidebarIcons, mounted]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const setTheme = (t: Theme) => {
    setThemeState(t);
  };

  const toggleSidebarIcons = () => {
    setSidebarIconsState((prev) => !prev);
  };

  const setSidebarIcons = (enabled: boolean) => {
    setSidebarIconsState(enabled);
  };

  return (
    <UIPreferencesContext.Provider
      value={{
        theme,
        isDark: theme === 'dark',
        toggleTheme,
        setTheme,
        sidebarIcons,
        toggleSidebarIcons,
        setSidebarIcons,
      }}
    >
      {children}
    </UIPreferencesContext.Provider>
  );
}

export function useUIPreferences(): UIPreferencesContextType {
  const context = useContext(UIPreferencesContext);
  if (!context) {
    throw new Error('useUIPreferences must be used within a UIPreferencesProvider');
  }
  return context;
}
