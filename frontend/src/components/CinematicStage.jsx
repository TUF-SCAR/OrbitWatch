import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";
import { useEffect, useMemo, useState } from "react";
import "./CinematicStage.css";

const completedStages = new Set();

const offsets = {
  top: { x: 0, y: -54 },
  left: { x: -62, y: 0 },
  right: { x: 62, y: 0 },
  bottom: { x: 0, y: 58 },
};

export default function CinematicStage({
  active,
  side,
  delay = 0,
  loaderAnchor,
  zIndex = 20,
  cycle = 0,
  children,
}) {
  const reduceMotion = useReducedMotion();

  const stageKey = useMemo(
    () => `${cycle}:${loaderAnchor || side}`,
    [cycle, loaderAnchor, side],
  );

  const [contentReady, setContentReady] = useState(
    () => completedStages.has(stageKey),
  );

  const offset = offsets[side] || offsets.top;

  useEffect(() => {
    setContentReady(completedStages.has(stageKey));
  }, [stageKey]);

  useEffect(() => {
    if (!active || completedStages.has(stageKey)) {
      return undefined;
    }

    const timeoutId = window.setTimeout(
      () => {
        completedStages.add(stageKey);
        setContentReady(true);
      },
      reduceMotion ? 80 : Math.round((delay + 1.0) * 1000),
    );

    return () => window.clearTimeout(timeoutId);
  }, [active, delay, reduceMotion, stageKey]);

  const completed = contentReady || completedStages.has(stageKey);

  return (
    <motion.div
      className={`cinematic-stage cinematic-stage--${loaderAnchor}`}
      style={{ zIndex }}
      initial={false}
      animate={
        active
          ? { opacity: 1, x: 0, y: 0 }
          : {
              opacity: 0,
              x: completed ? 0 : offset.x,
              y: completed ? 0 : offset.y,
            }
      }
      transition={
        reduceMotion
          ? { duration: 0.05 }
          : completed
            ? {
                duration: 0.24,
                ease: [0.22, 1, 0.36, 1],
              }
            : {
                type: "spring",
                stiffness: 155,
                damping: 22,
                mass: 0.82,
                delay,
              }
      }
    >
      <AnimatePresence mode="wait">
        {active && !completed ? (
          <motion.div
            key={`loader-${stageKey}`}
            className="cinematic-stage__loader"
            initial={{
              opacity: 0,
              scale: 0.76,
              filter: "blur(4px)",
            }}
            animate={{
              opacity: 1,
              scale: 1,
              filter: "blur(0px)",
            }}
            exit={{
              opacity: 0,
              scale: 1.16,
              filter: "blur(5px)",
            }}
            transition={{
              duration: 0.20,
              delay: reduceMotion ? 0 : delay,
            }}
          >
            <motion.i
              animate={{ rotate: 360 }}
              transition={{
                duration: 0.72,
                repeat: Infinity,
                ease: "linear",
              }}
            />
            <span>SYNC</span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.div
        className="cinematic-stage__content"
        animate={
          completed
            ? {
                opacity: 1,
                scale: 1,
                filter: "blur(0px)",
              }
            : {
                opacity: 0,
                scale: 0.985,
                filter: "blur(5px)",
              }
        }
        transition={{
          duration: reduceMotion ? 0.05 : 0.30,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
