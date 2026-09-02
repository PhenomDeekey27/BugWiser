'use client';

import { useTheme } from '@/components/theme/ThemeProvider';
import DotFieldCore from '@/components/DotField';

const LIGHT = {
  gradientFrom: 'rgba(139, 143, 152, 0.25)',
  gradientTo: 'rgba(139, 143, 152, 0.18)',
  glowColor: '#E4574F',
};

const DARK = {
  gradientFrom: 'rgba(115, 122, 120, 0.30)',
  gradientTo: 'rgba(115, 122, 120, 0.22)',
  glowColor: '#E85D52',
};

export default function DotField(props: Record<string, unknown>) {
  const { resolvedTheme } = useTheme();
  const c = resolvedTheme === 'dark' ? DARK : LIGHT;

  return (
    <DotFieldCore
      dotRadius={2.5}
      dotSpacing={15}
      cursorRadius={500}
      cursorForce={0.1}
      bulgeOnly
      bulgeStrength={67}
      glowRadius={160}
      sparkle={false}
      waveAmplitude={0}
      gradientFrom={c.gradientFrom}
      gradientTo={c.gradientTo}
      glowColor={c.glowColor}
      {...props}
    />
  );
}
