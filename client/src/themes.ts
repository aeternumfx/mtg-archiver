import { createTheme, type MantineTheme } from '@mantine/core';

const sharedComponents: Record<string, any> = {
  Card: {
    defaultProps: { radius: 'md', shadow: 'sm' },
    styles: { root: { transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease' } },
  },
  Paper: {
    styles: { root: { transition: 'background-color 0.2s ease, border-color 0.2s ease' } },
  },
  Button: {
    defaultProps: { radius: 'md' },
    styles: { root: { transition: 'transform 0.12s ease, box-shadow 0.12s ease', '&:active': { transform: 'scale(0.97)' } } },
  },
  ActionIcon: {
    styles: { root: { transition: 'background-color 0.12s ease, transform 0.12s ease', '&:active': { transform: 'scale(0.92)' } } },
  },
  NavLink: {
    styles: () => ({
      root: {
        borderRadius: 8,
        transition: 'background-color 0.15s ease, color 0.15s ease, transform 0.1s ease',
      },
    }),
  },
  Badge: {
    styles: { root: { transition: 'all 0.15s ease' } },
  },
  Select: {
    styles: { dropdown: { boxShadow: '0 8px 24px rgba(0,0,0,0.15)' } },
  },
  Tooltip: {
    defaultProps: { radius: 'md' },
  },
};

function makeTheme(overrides: Record<string, unknown>): MantineTheme {
  return createTheme({
    ...overrides,
    components: {
      ...(overrides.components as Record<string, any>),
      ...sharedComponents,
    },
  } as any) as unknown as MantineTheme;
}

export const themeLight = makeTheme({
  primaryColor: 'indigo',
  defaultRadius: 'md',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  autoContrast: true,
  cursorType: 'pointer',
  shadows: {
    md: '0 4px 12px rgba(0,0,0,0.06)',
    lg: '0 8px 24px rgba(0,0,0,0.10)',
    xl: '0 16px 40px rgba(0,0,0,0.16)',
  },
});

export const themeDark = makeTheme({
  primaryColor: 'indigo',
  defaultRadius: 'md',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  autoContrast: true,
  cursorType: 'pointer',
  shadows: {
    md: '0 4px 12px rgba(0,0,0,0.3)',
    lg: '0 8px 24px rgba(0,0,0,0.4)',
    xl: '0 16px 40px rgba(0,0,0,0.5)',
  },
});

export const themeGalaxy = makeTheme({
  primaryColor: 'violet',
  defaultRadius: 'md',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  colors: {
    dark: [
      '#12131f',
      '#171829',
      '#1c1d33',
      '#24253e',
      '#2c2d4a',
      '#3a3c5a',
      '#4c4e6d',
      '#636585',
      '#81839e',
      '#a0a2b8',
    ],
    violet: [
      '#f5f1ff',
      '#ddd4ff',
      '#b5a3ff',
      '#8d73ff',
      '#6c4eff',
      '#5537ff',
      '#4a2bfa',
      '#3b1fe0',
      '#3018b8',
      '#281298',
    ],
  },
  primaryShade: { light: 6, dark: 5 },
  autoContrast: true,
  cursorType: 'pointer',
  shadows: {
    md: '0 4px 12px rgba(0,0,0,0.35)',
    lg: '0 8px 24px rgba(0,0,0,0.45)',
    xl: '0 16px 40px rgba(0,0,0,0.55)',
  },
});

export const themes: Record<string, { label: string; theme: MantineTheme; colorScheme: 'light' | 'dark'; icon: string }> = {
  light: { label: 'Light', theme: themeLight, colorScheme: 'light', icon: '☀️' },
  dark: { label: 'Dark', theme: themeDark, colorScheme: 'dark', icon: '🌙' },
  galaxy: { label: 'Galaxy', theme: themeGalaxy, colorScheme: 'dark', icon: '🌌' },
};

export type ThemeKey = keyof typeof themes;
