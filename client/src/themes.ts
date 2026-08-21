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
    // Mantine's `dark` scale runs light(0) -> deep(9). Body background uses
    // dark[7], papers dark[6], primary text dark[0]. The deep navy palette
    // gives a space-like canvas with light lavender foreground text.
    dark: [
      '#d3d6ea',
      '#b2b6d0',
      '#9095b6',
      '#6f749c',
      '#545983',
      '#3f4369',
      '#333752',
      '#20233a',
      '#171a2e',
      '#101225',
    ],
    violet: [
      '#f3eeff',
      '#e0d4ff',
      '#c3a9ff',
      '#9f7bff',
      '#7e52ff',
      '#6330ff',
      '#5119ee',
      '#4313c9',
      '#3510a3',
      '#2a0d87',
    ],
  },
  primaryShade: { light: 6, dark: 5 },
  autoContrast: true,
  cursorType: 'pointer',
  shadows: {
    md: '0 4px 12px rgba(0,0,0,0.45)',
    lg: '0 8px 24px rgba(0,0,0,0.55)',
    xl: '0 16px 40px rgba(0,0,0,0.65)',
  },
});

export const themes: Record<string, { label: string; theme: MantineTheme; colorScheme: 'light' | 'dark'; icon: string }> = {
  light: { label: 'Light', theme: themeLight, colorScheme: 'light', icon: '☀️' },
  dark: { label: 'Dark', theme: themeDark, colorScheme: 'dark', icon: '🌙' },
  galaxy: { label: 'Galaxy', theme: themeGalaxy, colorScheme: 'dark', icon: '🌌' },
};

export type ThemeKey = keyof typeof themes;
