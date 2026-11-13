export interface Palette {
  bg: string;
  ink: string;
  accent: string;
}

export interface Theme extends Palette {
  id: string;
  name: string;
}

export const THEMES: Theme[] = [
  { id: 'glacier', name: 'GLACIER', bg: '#E7ECEF', ink: '#22303A', accent: '#3B9BE0' },
  { id: 'oto-paper', name: 'OTO WARM PAPER', bg: '#EAE8E1', ink: '#1A1A1A', accent: '#D94E4E' },
  { id: 'oto-dark', name: 'OTO DARK STUDIO', bg: '#141517', ink: '#E6E6E6', accent: '#4ECDC4' },
  { id: 'watercolor', name: 'WATERCOLOR SKY', bg: '#ECE9DF', ink: '#1E3A5F', accent: '#6BA3D6' },
  { id: 'ember', name: 'SUNSET EMBER', bg: '#121212', ink: '#F4A261', accent: '#FF5E1A' },
  { id: 'pastel', name: 'PASTEL SCORE', bg: '#EAE9E4', ink: '#22252A', accent: '#7FB3D5' },
  { id: 'studio', name: 'STUDIO PAPER', bg: '#F4F3EE', ink: '#111111', accent: '#FF4D00' },
  { id: 'amber', name: 'DARK AMBER', bg: '#0D0C0B', ink: '#F59E0B', accent: '#FFFFFF' },
  { id: 'acid', name: 'ACID MATRIX', bg: '#080A08', ink: '#00FF66', accent: '#E0FFE8' },
  { id: 'cobalt', name: 'COBALT BLUEPRINT', bg: '#0A192F', ink: '#64FFDA', accent: '#FFFFFF' },
  { id: 'crimson', name: 'CRIMSON TAPE', bg: '#141010', ink: '#F2ECEC', accent: '#E63946' },
];

export const ASPECTS = {
  '16:9': [16, 9],
  '9:16': [9, 16],
  '1:1': [1, 1],
  '4:5': [4, 5],
} as const;

export type Aspect = keyof typeof ASPECTS;

/** Returns "#RRGGBB" (upper case) or null when the input is not a valid hex colour. */
export function normalizeHex(v: string): string | null {
  let h = v.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return `#${h.toUpperCase()}`;
}

export function samePalette(a: Palette, b: Palette): boolean {
  return (
    a.bg.toUpperCase() === b.bg.toUpperCase() &&
    a.ink.toUpperCase() === b.ink.toUpperCase() &&
    a.accent.toUpperCase() === b.accent.toUpperCase()
  );
}
