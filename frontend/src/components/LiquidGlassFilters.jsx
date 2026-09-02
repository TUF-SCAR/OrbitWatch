function LiquidGlassFilters() {
  return (
    <svg
      aria-hidden="true"
      className="liquid-filter-definitions"
      focusable="false"
    >
      <defs>
        <filter
          id="liquid-flow-filter"
          x="-55%"
          y="-55%"
          width="210%"
          height="210%"
        >
          <feTurbulence
            baseFrequency="0.004 0.011"
            numOctaves="2"
            seed="9"
            type="fractalNoise"
          >
            <animate
              attributeName="baseFrequency"
              dur="19s"
              repeatCount="indefinite"
              values="0.004 0.011;0.007 0.015;0.003 0.009;0.006 0.013;0.004 0.011"
            />
          </feTurbulence>
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="24"
            xChannelSelector="R"
            yChannelSelector="B"
          />
          <feGaussianBlur stdDeviation="0.25" />
        </filter>
      </defs>
    </svg>
  );
}

export default LiquidGlassFilters;
