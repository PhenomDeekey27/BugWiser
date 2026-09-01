'use client';

interface BugWiserLogoProps {
  variant?: 'full' | 'icon';
  className?: string;
}

export function BugWiserLogo({ variant = 'full', className = '' }: BugWiserLogoProps) {
  if (variant === 'icon') {
    return (
      <svg
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        role="img"
        aria-label="BugWiser"
      >
        <title>BugWiser</title>
        <defs>
          <radialGradient id="iconBodyGrad" cx="50%" cy="40%" r="55%">
            <stop offset="0%" stopColor="#E84040" />
            <stop offset="100%" stopColor="#8B1A1A" />
          </radialGradient>
          <radialGradient id="iconEyeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFD060" />
            <stop offset="100%" stopColor="#FF9020" />
          </radialGradient>
          <radialGradient id="iconLensGrad" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#FFB070" />
            <stop offset="100%" stopColor="#C04020" />
          </radialGradient>
          <filter id="iconGlow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Speed lines */}
        <rect x="2" y="17" width="10" height="2.5" rx="1.25" fill="#E85030" opacity="0.8" />
        <rect x="4" y="22" width="8" height="2.5" rx="1.25" fill="#E85030" opacity="0.6" />
        <rect x="2" y="27" width="10" height="2.5" rx="1.25" fill="#E85030" opacity="0.8" />

        {/* Antennae */}
        <path d="M20 14 Q18 6 14 4" stroke="#C03030" strokeWidth="2" strokeLinecap="round" fill="none" />
        <circle cx="14" cy="4" r="2" fill="#FFD060" filter="url(#iconGlow)" />
        <path d="M28 14 Q30 6 34 4" stroke="#C03030" strokeWidth="2" strokeLinecap="round" fill="none" />
        <circle cx="34" cy="4" r="2" fill="#FFD060" filter="url(#iconGlow)" />

        {/* Body */}
        <ellipse cx="24" cy="24" rx="14" ry="13" fill="url(#iconBodyGrad)" />

        {/* Face area */}
        <ellipse cx="24" cy="20" rx="10" ry="8" fill="#1A0808" />

        {/* Eyes */}
        <ellipse cx="20" cy="19" rx="3" ry="3.5" fill="url(#iconEyeGlow)" filter="url(#iconGlow)" />
        <ellipse cx="28" cy="19" rx="3" ry="3.5" fill="url(#iconEyeGlow)" filter="url(#iconGlow)" />
        <ellipse cx="20" cy="18.5" rx="1.2" ry="1.5" fill="#FFF0C0" />
        <ellipse cx="28" cy="18.5" rx="1.2" ry="1.5" fill="#FFF0C0" />

        {/* Magnifying glass handle */}
        <rect x="30" y="34" width="4" height="10" rx="2" transform="rotate(-35 30 34)" fill="#A03020" />

        {/* Magnifying glass ring */}
        <circle cx="30" cy="30" r="8" fill="none" stroke="url(#iconLensGrad)" strokeWidth="2.5" />

        {/* Magnifying glass lens */}
        <circle cx="30" cy="30" r="6" fill="rgba(255,200,150,0.15)" />

        {/* Code symbol inside lens */}
        <text x="30" y="33" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#FFD080" fontFamily="monospace">&lt;/&gt;</text>
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 280 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="BugWiser"
      preserveAspectRatio="xMidYMid meet"
    >
      <title>BugWiser</title>
      <defs>
        <radialGradient id="bodyGrad" cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#E84040" />
          <stop offset="100%" stopColor="#8B1A1A" />
        </radialGradient>
        <radialGradient id="eyeGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFD060" />
          <stop offset="100%" stopColor="#FF9020" />
        </radialGradient>
        <radialGradient id="lensGrad" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#FFB070" />
          <stop offset="100%" stopColor="#C04020" />
        </radialGradient>
        <linearGradient id="wordmarkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFE8D0" />
          <stop offset="40%" stopColor="#FFD8B8" />
          <stop offset="100%" stopColor="#E86040" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="subtleShadow">
          <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000" floodOpacity="0.3" />
        </filter>
      </defs>

      {/* === BUG ICON === */}
      <g transform="translate(8, 4) scale(0.88)">
        {/* Speed lines */}
        <rect x="0" y="17" width="12" height="2.8" rx="1.4" fill="#E85030" opacity="0.85" />
        <rect x="3" y="22.5" width="9" height="2.8" rx="1.4" fill="#E85030" opacity="0.6" />
        <rect x="0" y="28" width="12" height="2.8" rx="1.4" fill="#E85030" opacity="0.85" />

        {/* Antennae */}
        <path d="M20 14 Q18 5 13 2" stroke="#C03030" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <circle cx="13" cy="2" r="2.5" fill="#FFD060" filter="url(#glow)" />
        <path d="M28 14 Q30 5 35 2" stroke="#C03030" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <circle cx="35" cy="2" r="2.5" fill="#FFD060" filter="url(#glow)" />

        {/* Body */}
        <ellipse cx="24" cy="24" rx="15" ry="14" fill="url(#bodyGrad)" filter="url(#subtleShadow)" />

        {/* Body highlight */}
        <ellipse cx="22" cy="20" rx="8" ry="6" fill="rgba(255,100,80,0.2)" />

        {/* Face area */}
        <ellipse cx="24" cy="20" rx="11" ry="9" fill="#1A0808" />

        {/* Eyes */}
        <ellipse cx="20" cy="19" rx="3.2" ry="3.8" fill="url(#eyeGlow)" filter="url(#glow)" />
        <ellipse cx="28" cy="19" rx="3.2" ry="3.8" fill="url(#eyeGlow)" filter="url(#glow)" />
        <ellipse cx="20" cy="18.2" rx="1.3" ry="1.6" fill="#FFF0C0" />
        <ellipse cx="28" cy="18.2" rx="1.3" ry="1.6" fill="#FFF0C0" />

        {/* Magnifying glass handle */}
        <rect x="31" y="35" width="4.5" height="11" rx="2.25" transform="rotate(-35 31 35)" fill="#A03020" />

        {/* Magnifying glass ring */}
        <circle cx="31" cy="31" r="9" fill="none" stroke="url(#lensGrad)" strokeWidth="2.8" />

        {/* Magnifying glass lens */}
        <circle cx="31" cy="31" r="6.5" fill="rgba(255,200,150,0.12)" />

        {/* Code symbol inside lens */}
        <text x="31" y="34" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#FFD080" fontFamily="monospace">&lt;/&gt;</text>
      </g>

      {/* === WORDMARK === */}
      <g filter="url(#subtleShadow)">
        <text
          x="68"
          y="35"
          fontSize="30"
          fontWeight="700"
          fontFamily="Inter, system-ui, -apple-system, sans-serif"
          fill="url(#wordmarkGrad)"
          letterSpacing="-0.5"
        >
          BugWiser
        </text>
      </g>

      {/* === TAGLINE === */}
      <text
        x="68"
        y="48"
        fontSize="7"
        fontWeight="600"
        fontFamily="JetBrains Mono, monospace"
        fill="#AA776A"
        letterSpacing="2.5"
      >
        DEBUG SMARTER • SHIP FASTER
      </text>
    </svg>
  );
}
