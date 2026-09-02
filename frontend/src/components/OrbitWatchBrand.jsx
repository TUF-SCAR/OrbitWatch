import { animate, createScope } from "animejs";
import { Menu } from "lucide-react";
import { useEffect, useRef } from "react";
import LiquidGlass from "./LiquidGlass.jsx";

function OrbitWatchBrand({ onClick, layoutId = "mode-surface" }) {
  const brandRef = useRef(null);

  useEffect(() => {
    const animationScope = createScope({
      root: brandRef,
      mediaQueries: {
        reduceMotion: "(prefers-reduced-motion: reduce)",
      },
    }).add((scope) => {
      if (scope.matches.reduceMotion) {
        return;
      }

      animate(".orbitwatch-logo__ring--1", {
        scale: [0.94, 1.04, 0.94],
        opacity: [0.58, 0.9, 0.58],
        duration: 4200,
        ease: "inOut(2)",
        loop: true,
      });

      animate(".orbitwatch-logo__ring--2", {
        x: [-1.5, 1.5, -1.5],
        y: [1, -1, 1],
        opacity: [0.42, 0.72, 0.42],
        duration: 5200,
        ease: "inOut(2)",
        loop: true,
      });

      animate(".orbitwatch-logo__core", {
        scale: [0.9, 1.14, 0.9],
        opacity: [0.76, 1, 0.76],
        duration: 2600,
        ease: "inOut(2)",
        loop: true,
      });
    });

    return () => {
      animationScope.revert();
    };
  }, []);

  return (
    <div ref={brandRef}>
      <LiquidGlass
        className="orbitwatch-brand"
        element="button"
        layoutId={layoutId}
        onClick={onClick}
        strength="medium"
        transition={{ type: "spring", stiffness: 280, damping: 28 }}
        type="button"
        whileHover={{ scale: 1.02, y: -1 }}
        whileTap={{ scale: 0.98 }}
      >
        <span className="orbitwatch-logo" aria-hidden="true">
          <span className="orbitwatch-logo__ring orbitwatch-logo__ring--1" />
          <span className="orbitwatch-logo__ring orbitwatch-logo__ring--2" />
          <span className="orbitwatch-logo__core" />
        </span>

        <span className="orbitwatch-brand__text">
          <strong>OrbitWatch</strong>
          <small>Live space intelligence</small>
        </span>

        <Menu size={18} />
      </LiquidGlass>
    </div>
  );
}

export default OrbitWatchBrand;
