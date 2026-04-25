/**
 * Color palettes for priority badges and category chips.
 *
 * Resolved per-palette at webview render time. Each palette entry is a
 * string that is injected straight into CSS (either a #hex or a CSS
 * `var(...)` reference — both are valid CSS color values).
 *
 * `theme-adaptive` resolves colors from VS Code's theme CSS variables, so
 * the extension re-tints when the user switches themes.
 *
 * Slot semantics:
 *   P3 Critical → red/magenta
 *   P2 Warning  → orange/amber
 *   P1 Info     → green
 *   P0 Praise   → blue
 */

import { CommentPriority } from './types.js';

export type PaletteId =
  | 'theme-adaptive'
  | 'cobalt9'
  | 'tailwind'
  | 'pastel-soft'
  | 'material'
  | 'solarized'
  | 'muted-modern'
  | 'nord'
  | 'dracula'
  | 'gruvbox'
  | 'cvd-consensus'
  | 'cvd-deep'
  | 'cvd-vivid'
  | 'okabe-ito';

export const PALETTE_IDS: readonly PaletteId[] = [
  'theme-adaptive',
  'cobalt9',
  'tailwind',
  'pastel-soft',
  'material',
  'solarized',
  'muted-modern',
  'nord',
  'dracula',
  'gruvbox',
  'cvd-consensus',
  'cvd-deep',
  'cvd-vivid',
  'okabe-ito',
] as const;

export type CategoryKey =
  | 'security'
  | 'correctness'
  | 'maintenance'
  | 'optimization'
  | 'setting'
  | 'review-history';

export interface Palette {
  priority: Record<CommentPriority, string>;
  category: Record<CategoryKey, string>;
}

export const PALETTES: Record<PaletteId, Palette> = {
  // 1. Theme Adaptive — inherits from active VS Code theme
  'theme-adaptive': {
    priority: {
      P3: 'var(--vscode-errorForeground, #EF4444)',
      P2: 'var(--vscode-editorWarning-foreground, #F97316)',
      P1: 'var(--vscode-charts-green, #22C55E)',
      P0: 'var(--vscode-editorInfo-foreground, #3B82F6)',
    },
    category: {
      security:        'var(--vscode-charts-red, #C51162)',
      correctness:     'var(--vscode-charts-orange, #FF6D00)',
      maintenance:     'var(--vscode-charts-blue, #0091EA)',
      optimization:    'var(--vscode-charts-purple, #6200EA)',
      setting:         'var(--vscode-charts-green, #00BFA5)',
      'review-history':'var(--vscode-descriptionForeground, #6B7280)',
    },
  },

  // 2. Cobalt9 — electric navy-friendly accents
  'cobalt9': {
    priority: { P3: '#FF628C', P2: '#FF9D00', P1: '#3AD900', P0: '#0088FF' },
    category: {
      security: '#FF628C', correctness: '#FFC600',
      maintenance: '#0088FF', optimization: '#AE81FF',
      setting: '#3AD900', 'review-history': '#5F7E97',
    },
  },

  // 3. Tailwind — modern web, familiar
  'tailwind': {
    priority: { P3: '#EF4444', P2: '#F97316', P1: '#22C55E', P0: '#3B82F6' },
    category: {
      security: '#DC2626', correctness: '#EA580C',
      maintenance: '#2563EB', optimization: '#7C3AED',
      setting: '#16A34A', 'review-history': '#6B7280',
    },
  },

  // 4. Pastel Soft — low saturation, gentle on the eyes
  'pastel-soft': {
    priority: { P3: '#F08080', P2: '#FFB26B', P1: '#A8DABD', P0: '#A0C4FF' },
    category: {
      security: '#FFB3BA', correctness: '#FFDFBA',
      maintenance: '#BAE1FF', optimization: '#E0BBFF',
      setting: '#BAFFC9', 'review-history': '#D3D3D3',
    },
  },

  // 5. Material — Google Material A-tones, punchy
  'material': {
    priority: { P3: '#D50000', P2: '#FF6D00', P1: '#00C853', P0: '#2962FF' },
    category: {
      security: '#C51162', correctness: '#FF6D00',
      maintenance: '#0091EA', optimization: '#6200EA',
      setting: '#00BFA5', 'review-history': '#455A64',
    },
  },

  // 6. Solarized — muted terminal-familiar
  'solarized': {
    priority: { P3: '#DC322F', P2: '#CB4B16', P1: '#859900', P0: '#268BD2' },
    category: {
      security: '#DC322F', correctness: '#B58900',
      maintenance: '#268BD2', optimization: '#6C71C4',
      setting: '#2AA198', 'review-history': '#586E75',
    },
  },

  // 7. Muted Modern — Tailwind × Solarized blend
  'muted-modern': {
    priority: { P3: '#E53B39', P2: '#E25F16', P1: '#53AF2F', P0: '#3086E4' },
    category: {
      security: '#DC2C2B', correctness: '#D07106',
      maintenance: '#2677DF', optimization: '#7456D9',
      setting: '#20A271', 'review-history': '#62707B',
    },
  },

  // 8. Nord — arctic / cool
  'nord': {
    priority: { P3: '#BF616A', P2: '#D08770', P1: '#A3BE8C', P0: '#5E81AC' },
    category: {
      security: '#BF616A', correctness: '#EBCB8B',
      maintenance: '#5E81AC', optimization: '#B48EAD',
      setting: '#A3BE8C', 'review-history': '#4C566A',
    },
  },

  // 9. Dracula — iconic dark-theme accents
  'dracula': {
    priority: { P3: '#FF5555', P2: '#FFB86C', P1: '#50FA7B', P0: '#8BE9FD' },
    category: {
      security: '#FF5555', correctness: '#F1FA8C',
      maintenance: '#8BE9FD', optimization: '#BD93F9',
      setting: '#50FA7B', 'review-history': '#6272A4',
    },
  },

  // 10. Gruvbox — warm retro
  'gruvbox': {
    priority: { P3: '#FB4934', P2: '#FE8019', P1: '#B8BB26', P0: '#83A598' },
    category: {
      security: '#FB4934', correctness: '#FABD2F',
      maintenance: '#83A598', optimization: '#D3869B',
      setting: '#B8BB26', 'review-history': '#928374',
    },
  },

  // 11. CVD Consensus — balanced colorblind-safe
  // P1/P0 use two luminance-separated blues instead of green/teal so the
  // safe-but-positive slots can never be confused with red/orange via any
  // CVD type. P1 medium blue, P0 bright sky blue (Okabe sky).
  'cvd-consensus': {
    priority: { P3: '#DD3462', P2: '#E87F01', P1: '#2C7FB8', P0: '#56B4E9' },
    category: {
      security: '#DD3462', correctness: '#E87F01',
      maintenance: '#158C90', optimization: '#6C4DBA',
      setting: '#31AA59', 'review-history': '#7A7A7A',
    },
  },

  // 12. CVD Deep — light-theme optimized colorblind-safe
  // P1 deep navy, P0 medium sea blue — both dark enough to read on white.
  'cvd-deep': {
    priority: { P3: '#A3195B', P2: '#B84A00', P1: '#1F4E8C', P0: '#2C7FB8' },
    category: {
      security: '#A3195B', correctness: '#B84A00',
      maintenance: '#0F6E73', optimization: '#523A7A',
      setting: '#00723E', 'review-history': '#4A4A4A',
    },
  },

  // 13. CVD Vivid — dark-theme optimized colorblind-safe
  // P1 dodger blue, P0 bright sky-cyan — both glow on navy bg.
  'cvd-vivid': {
    priority: { P3: '#FF3399', P2: '#FF8A2A', P1: '#1E90FF', P0: '#66CCFF' },
    category: {
      security: '#FF3399', correctness: '#FF8A2A',
      maintenance: '#2DC4BC', optimization: '#9B72FF',
      setting: '#4DD76C', 'review-history': '#888888',
    },
  },

  // 14. Okabe-Ito — canonical Nature-paper colorblind-safe palette
  'okabe-ito': {
    priority: { P3: '#D55E00', P2: '#E69F00', P1: '#009E73', P0: '#0072B2' },
    category: {
      security: '#D55E00', correctness: '#E69F00',
      maintenance: '#0072B2', optimization: '#CC79A7',
      setting: '#009E73', 'review-history': '#999999',
    },
  },
};

/** Return the palette for an id, falling back to `theme-adaptive` on unknown input. */
export function resolvePalette(id: string | undefined): Palette {
  return PALETTES[(id as PaletteId)] ?? PALETTES['theme-adaptive'];
}

/**
 * Derive grade badge color from palette priority slots.
 *   exceptional → P0 (best — blue)
 *   proficient  → P0 (blue)
 *   adequate    → P1 (green)
 *   insufficient→ P2 (orange)
 *   critical    → P3 (red)
 */
export function gradeColor(palette: Palette, grade: string): string {
  switch (grade) {
    case 'exceptional':  return palette.priority.P0;
    case 'proficient':   return palette.priority.P0;
    case 'adequate':     return palette.priority.P1;
    case 'insufficient': return palette.priority.P2;
    case 'critical':     return palette.priority.P3;
    default:             return 'var(--vscode-descriptionForeground, #666)';
  }
}
