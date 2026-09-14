export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-label="AutoCourt"
      role="img"
    >
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#e8590c" />
      <path d="M20 44 L29 22 L35 22 L26 44 Z" fill="#fff" opacity="0.55" />
      <path d="M31 44 L40 22 L44 22 L35 44 Z" fill="#fff" opacity="0.3" />
      <path
        d="M18 34 L27 43 L46 20"
        fill="none"
        stroke="#fff"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
