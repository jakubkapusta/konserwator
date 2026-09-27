// Inline SVG icons. Tool icons point to the lower left; `tip` is the working point in the 64×64 viewBox.

export const TOOL_ICONS: Record<number, { svg: string; tip: [number, number] }> = {
  1: {
    tip: [13, 51],
    svg: `<svg viewBox="0 0 64 64"><g transform="rotate(45 32 32)">
      <rect x="28.5" y="-6" width="7" height="30" rx="3.5" fill="#8a5a33"/><rect x="29.5" y="-4" width="2" height="26" rx="1" fill="#b27d4f"/>
      <rect x="25" y="22" width="14" height="10" rx="2" fill="#cfc6b6"/><rect x="25" y="25" width="14" height="1.6" fill="#8f8779"/>
      <path d="M25 32 H39 L42.5 50 Q32 57 21.5 50 Z" fill="#efe3c9"/>
      <path d="M28 33 L27 51 M32 33 V53 M36 33 L37 51" stroke="#c7b894" stroke-width="1.1" fill="none"/>
    </g></svg>`,
  },
  2: {
    tip: [11, 53],
    svg: `<svg viewBox="0 0 64 64"><g transform="rotate(45 32 32)">
      <rect x="30" y="-6" width="4" height="46" rx="2" fill="#efe9dc"/><rect x="30.6" y="-6" width="1.2" height="46" fill="#fff"/>
      <ellipse cx="32" cy="46" rx="6.6" ry="10" fill="var(--tip, #fbf7ee)"/>
      <ellipse cx="30" cy="42" rx="2.4" ry="4.2" fill="rgba(255,255,255,0.55)"/>
    </g></svg>`,
  },
  3: {
    tip: [8, 56],
    svg: `<svg viewBox="0 0 64 64"><g transform="rotate(45 32 32)">
      <rect x="28.5" y="-8" width="7" height="34" rx="2.5" fill="#9aa2a8"/><rect x="29.5" y="-6" width="1.8" height="30" fill="#d7dde1"/>
      <path d="M29.5 0 H34.5 M29.5 4 H34.5 M29.5 8 H34.5" stroke="#6f777d" stroke-width="1"/>
      <path d="M29 26 H35 L35 40 Q34 52 32 60 Q29.5 48 29 40 Z" fill="#e3e8eb"/><path d="M32 30 L32 58" stroke="#fff" stroke-width="0.8"/>
    </g></svg>`,
  },
  4: {
    // agate burnisher: a polished stone tooth on a wooden handle
    tip: [10, 54],
    svg: `<svg viewBox="0 0 64 64"><g transform="rotate(45 32 32)">
      <rect x="29" y="-8" width="6" height="36" rx="3" fill="#6d4526"/><rect x="30" y="-6" width="1.6" height="32" fill="#9a6a40"/>
      <rect x="27.5" y="26" width="9" height="7" rx="1.5" fill="#c9a24e"/><rect x="27.5" y="28.5" width="9" height="1.2" fill="#8a6a2a"/>
      <path d="M28.5 33 H35.5 Q37 46 32 58 Q27 46 28.5 33 Z" fill="#b9a38a"/><path d="M30.5 35 Q30 46 32 55" stroke="#efe6da" stroke-width="1.4" fill="none"/>
    </g></svg>`,
  },
  5: {
    // wide flat varnish brush
    tip: [32, 60],
    svg: `<svg viewBox="0 0 64 64">
      <rect x="27" y="0" width="10" height="26" rx="4" fill="#7a4d2b"/><rect x="29" y="2" width="2.5" height="22" fill="#a06d44"/>
      <rect x="10" y="24" width="44" height="10" rx="2" fill="#c8c0b0"/><rect x="10" y="27" width="44" height="1.5" fill="#8f8779"/>
      <path d="M10 34 H54 L55 58 H9 Z" fill="#e6d3a8"/><path d="M16 35 V58 M24 35 V58 M32 35 V58 M40 35 V58 M48 35 V58" stroke="#c9b27e" stroke-width="1"/>
      <path d="M9 56 H55 V60 H9 Z" fill="rgba(255,236,190,0.8)"/>
    </svg>`,
  },
};

export const ICON = {
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  sound: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/></svg>`,
  mute: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>`,
  more: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`,
  find: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M8 10.5h5M10.5 8v5" stroke-width="1.5"/></svg>`,
  fit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`,
};
