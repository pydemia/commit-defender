/**
 * Color palettes for priority badges and category chips.
 *
 * Resolved per-palette at webview render time. Each palette entry is a
 * string injected straight into CSS (either a #hex or a CSS `var(...)`).
 *
 * `theme-adaptive` resolves colors from VS Code's theme CSS variables, so
 * the extension re-tints when the user switches themes.
 *
 * Slot semantics:
 *   Priority: P3=red/magenta, P2=orange/amber, P1=green, P0=blue
 *             (CVD palettes use two blues for P1/P0 instead of green/blue)
 *
 *   Category — uses a SEPARATE hue family so chips read as labels, not
 *   severity signals:
 *     security      → purple/violet
 *     correctness   → gold/yellow
 *     maintenance   → cyan/teal
 *     optimization  → rose or indigo (depends on whether P3 is magenta)
 *     setting       → sepia/brown
 *     review-history→ gray
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
  // 1. Theme Adaptive — inherits priorities from active VS Code theme;
  //    categories use VS Code chart colors (yellow/purple) plus fixed hex
  //    for hues VS Code doesn't expose (cyan, indigo, sepia).
  'theme-adaptive': {
    priority: {
      P3: 'var(--vscode-errorForeground, #EF4444)',
      P2: 'var(--vscode-editorWarning-foreground, #F97316)',
      P1: 'var(--vscode-charts-green, #22C55E)',
      P0: 'var(--vscode-editorInfo-foreground, #3B82F6)',
    },
    category: {
      security:        'var(--vscode-charts-purple, #A855F7)',
      correctness:     'var(--vscode-charts-yellow, #D4A017)',
      maintenance:     '#06B6D4',  // cyan
      optimization:    '#6366F1',  // indigo
      setting:         '#A0522D',  // sienna
      'review-history':'var(--vscode-descriptionForeground, #6B7280)',
    },
  },

  // 2. Cobalt9 — electric navy-friendly; categories use cobalt's purple,
  //    yellow, cyan, deep-pink (not P3's hot-pink), olive-tan, steel-gray.
  'cobalt9': {
    priority: { P3: '#FF628C', P2: '#FF9D00', P1: '#3AD900', P0: '#0088FF' },
    category: {
      security: '#AE81FF',          // cobalt violet
      correctness: '#FFC600',       // cobalt yellow (distinct from P2 orange)
      maintenance: '#9EFFFF',       // cobalt cyan
      optimization: '#5C6BC0',      // indigo (avoids P3 hot-pink clash)
      setting: '#A89A6E',           // olive-tan
      'review-history': '#5F7E97',  // steel
    },
  },

  // 3. Tailwind — Tailwind 500 series for categories.
  'tailwind': {
    priority: { P3: '#EF4444', P2: '#F97316', P1: '#22C55E', P0: '#3B82F6' },
    category: {
      security: '#A855F7',          // purple-500
      correctness: '#FACC15',       // yellow-400
      maintenance: '#06B6D4',       // cyan-500
      optimization: '#EC4899',      // pink-500
      setting: '#92400E',           // amber-800 (sepia-brown)
      'review-history': '#6B7280',  // gray-500
    },
  },

  // 4. Pastel Soft — pastel categories that pair with pastel priorities.
  'pastel-soft': {
    priority: { P3: '#F08080', P2: '#FFB26B', P1: '#A8DABD', P0: '#A0C4FF' },
    category: {
      security: '#C9A0DC',          // pastel lilac
      correctness: '#FFE4B5',       // pastel cream-gold
      maintenance: '#A0E7E5',       // pastel cyan
      optimization: '#FFC8DD',      // pastel pink
      setting: '#D2B48C',           // tan
      'review-history': '#D3D3D3',  // light gray
    },
  },

  // 5. Material — Google Material 500 series for categories.
  'material': {
    priority: { P3: '#D50000', P2: '#FF6D00', P1: '#00C853', P0: '#2962FF' },
    category: {
      security: '#9C27B0',          // purple-500
      correctness: '#FFC107',       // amber-500
      maintenance: '#00BCD4',       // cyan-500
      optimization: '#3F51B5',      // indigo-500
      setting: '#795548',           // brown-500
      'review-history': '#607D8B',  // blue-grey-500
    },
  },

  // 6. Solarized — uses solarized's 8-accent palette for categories.
  'solarized': {
    priority: { P3: '#DC322F', P2: '#CB4B16', P1: '#859900', P0: '#268BD2' },
    category: {
      security: '#6C71C4',          // solarized violet
      correctness: '#B58900',       // solarized yellow
      maintenance: '#2AA198',       // solarized cyan
      optimization: '#D33682',      // solarized magenta
      setting: '#6E4F1F',           // sepia (custom — solarized has no brown)
      'review-history': '#586E75',  // base01
    },
  },

  // 7. Muted Modern — Tailwind × Solarized blend; categories follow same
  //    blend rule (Tailwind 600 averaged with Solarized accents).
  'muted-modern': {
    priority: { P3: '#E53B39', P2: '#E25F16', P1: '#53AF2F', P0: '#3086E4' },
    category: {
      security: '#9333EA',          // muted purple
      correctness: '#CA8A04',       // muted gold
      maintenance: '#0E7490',       // dark teal
      optimization: '#4F46E5',      // indigo
      setting: '#92400E',           // sepia
      'review-history': '#62707B',  // slate
    },
  },

  // 8. Nord — uses Nord aurora + frost colors for categories.
  'nord': {
    priority: { P3: '#BF616A', P2: '#D08770', P1: '#A3BE8C', P0: '#5E81AC' },
    category: {
      security: '#B48EAD',          // aurora purple
      correctness: '#EBCB8B',       // aurora yellow
      maintenance: '#8FBCBB',       // frost light cyan
      optimization: '#81A1C1',      // frost slate-blue
      setting: '#7E5538',           // sepia (custom — Nord has no brown)
      'review-history': '#4C566A',  // polar night nord3
    },
  },

  // 9. Dracula — uses Dracula's full ANSI palette for categories.
  'dracula': {
    priority: { P3: '#FF5555', P2: '#FFB86C', P1: '#50FA7B', P0: '#8BE9FD' },
    category: {
      security: '#BD93F9',          // Dracula purple
      correctness: '#F1FA8C',       // Dracula yellow
      maintenance: '#94E0F2',       // softer cyan (P0 already Dracula cyan)
      optimization: '#FF79C6',      // Dracula pink (distinct hue from P3 red)
      setting: '#A88B4C',           // sepia (custom)
      'review-history': '#6272A4',  // Dracula comment
    },
  },

  // 10. Gruvbox — uses Gruvbox's bright variants for categories.
  'gruvbox': {
    priority: { P3: '#FB4934', P2: '#FE8019', P1: '#B8BB26', P0: '#83A598' },
    category: {
      security: '#D3869B',          // Gruvbox purple-mauve
      correctness: '#FABD2F',       // Gruvbox yellow
      maintenance: '#8EC07C',       // Gruvbox aqua
      optimization: '#B16286',      // Gruvbox magenta
      setting: '#A89984',           // Gruvbox tan
      'review-history': '#928374',  // Gruvbox gray
    },
  },

  // 11. CVD Consensus — categories chosen to be CVD-distinguishable from
  //     priorities AND from each other. IBM purple, Okabe yellow, Okabe
  //     bluish-green, Okabe reddish-purple, sienna, gray.
  'cvd-consensus': {
    priority: { P3: '#DD3462', P2: '#E87F01', P1: '#2C7FB8', P0: '#56B4E9' },
    category: {
      security: '#785EF0',          // IBM purple
      correctness: '#F0E442',       // Okabe yellow
      maintenance: '#009E73',       // Okabe bluish-green
      optimization: '#CC79A7',      // Okabe reddish-purple
      setting: '#8C5E2A',           // sienna
      'review-history': '#7A7A7A',  // gray
    },
  },

  // 12. CVD Deep — deeper tones for light-theme readability; categories
  //     deeper too.
  'cvd-deep': {
    priority: { P3: '#A3195B', P2: '#B84A00', P1: '#1F4E8C', P0: '#2C7FB8' },
    category: {
      security: '#5B21B6',          // deep violet
      correctness: '#A16207',       // deep gold
      maintenance: '#0F766E',       // deep teal
      optimization: '#BE185D',      // deep rose-pink
      setting: '#6E4F1F',           // sepia
      'review-history': '#4A4A4A',  // dark gray
    },
  },

  // 13. CVD Vivid — bright/electric for dark themes; categories also bright
  //     but in non-priority hue families.
  'cvd-vivid': {
    priority: { P3: '#FF3399', P2: '#FF8A2A', P1: '#1E90FF', P0: '#66CCFF' },
    category: {
      security: '#B388FF',          // vivid violet
      correctness: '#FFD700',       // gold
      maintenance: '#4DD76C',       // bright green
      optimization: '#9B72FF',      // lavender-purple
      setting: '#C5A572',           // gold-tan
      'review-history': '#888888',  // gray
    },
  },

  // 14. Okabe-Ito — canonical Nature palette uses its own 8-color set for
  //     categories.
  'okabe-ito': {
    priority: { P3: '#D55E00', P2: '#E69F00', P1: '#009E73', P0: '#0072B2' },
    category: {
      security: '#CC79A7',          // Okabe reddish-purple
      correctness: '#F0E442',       // Okabe yellow
      maintenance: '#56B4E9',       // Okabe sky blue (distinct from P0 deep blue)
      optimization: '#785EF0',      // IBM purple (extends Okabe set)
      setting: '#6E4F1F',           // sepia
      'review-history': '#999999',  // gray
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
