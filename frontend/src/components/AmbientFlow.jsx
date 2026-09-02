import { animate, createScope, utils } from "animejs";
import { useEffect, useRef } from "react";
import "./AmbientFlow.css";

const ORB_COUNT = 5;

function AmbientFlow() {
  const flowRootRef = useRef(null);

  useEffect(() => {
    const animationScope = createScope({
      root: flowRootRef,
      mediaQueries: {
        reduceMotion: "(prefers-reduced-motion: reduce)",
      },
    }).add((scope) => {
      if (scope.matches.reduceMotion) {
        return;
      }

      const flowOrbs = flowRootRef.current.querySelectorAll(
        ".ambient-flow__orb",
      );

      flowOrbs.forEach((flowOrb, index) => {
        animate(flowOrb, {
          x: utils.random(-180, 180),
          y: utils.random(-135, 135),
          scale: [0.82 + index * 0.03, utils.random(105, 128) / 100],
          opacity: [0.06 + index * 0.01, 0.13 + index * 0.012],
          duration: utils.random(18000, 29000),
          delay: index * 480,
          alternate: true,
          loop: true,
          ease: "inOut(2)",
        });
      });
    });

    return () => {
      animationScope.revert();
    };
  }, []);

  return (
    <div aria-hidden="true" className="ambient-flow" ref={flowRootRef}>
      {Array.from({ length: ORB_COUNT }, (_, index) => (
        <span className={`ambient-flow__orb ambient-flow__orb--${index + 1}`} key={index} />
      ))}
    </div>
  );
}

export default AmbientFlow;
