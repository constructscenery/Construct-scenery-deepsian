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
  // Two-flap sidebar state
  flap1Open: boolean;
  flap2Open: boolean;
  toggleFlap1: () => void;
  toggleFlap2: () => void;
  setFlap1Open: (open: boolean) => void;
  setFlap2Open: (open: boolean) => void;
}

const UIPreferencesContext = createContext<UIPreferencesContextType | null>(null);

const THEME_KEY = 'cs_theme';
const SIDEBAR_ICONS_KEY = 'cs_sidebar_icons';
const MIGRATION_KEY = 'cs_ui_v2';
const FLAP1_KEY = 'cs_flap1_open';
const FLAP2_KEY = 'cs_flap2_open';

export function UIPreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [sidebarIcons, setSidebarIconsState] = useState<boolean>(false);
  const [flap1Open, setFlap1OpenState] = useState<boolean>(true);
  const [flap2Open, setFlap2OpenState] = useState<boolean>(true);
  const [mounted, setMounted] = useState(false);

  // Initialize from localStorage or defaults (night mode & no icons & both flaps open)
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

      const storedFlap1 = localStorage.getItem(FLAP1_KEY);
      if (storedFlap1 !== null) {
        setFlap1OpenState(storedFlap1 === 'true');
      }

      const storedFlap2 = localStorage.getItem(FLAP2_KEY);
      if (storedFlap2 !== null) {
        setFlap2OpenState(storedFlap2 === 'true');
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

  // Sync flap1 to localStorage
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(FLAP1_KEY, String(flap1Open));
    } catch {
      /* ignore */
    }
  }, [flap1Open, mounted]);

  // Sync flap2 to localStorage
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(FLAP2_KEY, String(flap2Open));
    } catch {
      /* ignore */
    }
  }, [flap2Open, mounted]);

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

  const toggleFlap1 = () => {
    setFlap1OpenState((prev) => !prev);
  };

  const toggleFlap2 = () => {
    setFlap2OpenState((prev) => !prev);
  };

  const setFlap1Open = (open: boolean) => {
    setFlap1OpenState(open);
  };

  const setFlap2Open = (open: boolean) => {
    setFlap2OpenState(open);
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
        flap1Open,
        flap2Open,
        toggleFlap1,
        toggleFlap2,
        setFlap1Open,
        setFlap2Open,
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
