import { createContext, useContext } from 'react';

export const THEMES = ['Slate', 'Dark', 'Midnight', 'Emerald', 'Amethyst', 'Crimson', 'Forest', 'Ocean', 'Light'] as const;
export type Theme = typeof THEMES[number];

export const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: 'Slate',
  setTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);
