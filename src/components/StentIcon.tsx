import React from 'react';

interface StentIconProps {
  className?: string;
}

export const StentIcon: React.FC<StentIconProps> = ({ className = 'w-4 h-4' }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role="img"
      aria-label="Stent device icon"
    >
      {/* Outer stent tubular boundary with flared ends */}
      <path d="M3 7.5C1.5 10 1.5 14 3 16.5" />
      <path d="M21 7.5C22.5 10 22.5 14 21 16.5" />
      <path d="M3 7.5L21 7.5" />
      <path d="M3 16.5L21 16.5" />

      {/* Diamond mesh / lattice wires */}
      <path d="M3 7.5L7.5 16.5" />
      <path d="M7.5 7.5L12 16.5" />
      <path d="M12 7.5L16.5 16.5" />
      <path d="M16.5 7.5L21 16.5" />

      <path d="M7.5 7.5L3 16.5" />
      <path d="M12 7.5L7.5 16.5" />
      <path d="M16.5 7.5L12 16.5" />
      <path d="M21 7.5L16.5 16.5" />
    </svg>
  );
};
