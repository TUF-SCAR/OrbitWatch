import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import "./ExperienceIntro.css";

function ExperienceIntro() {
  const [introVisible, setIntroVisible] = useState(() => {
    return sessionStorage.getItem("orbitwatch-intro-viewed") !== "true";
  });

  useEffect(() => {
    if (!introVisible) {
      return undefined;
    }

    const introTimer = window.setTimeout(() => {
      sessionStorage.setItem("orbitwatch-intro-viewed", "true");
      setIntroVisible(false);
    }, 1900);

    return () => {
      window.clearTimeout(introTimer);
    };
  }, [introVisible]);

  return (
    <AnimatePresence>
      {introVisible ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="experience-intro"
          exit={{ opacity: 0, transition: { duration: 0.48 } }}
          initial={{ opacity: 0 }}
        >
          <motion.div
            animate={{ scale: 1, opacity: 1 }}
            className="experience-intro__mark"
            initial={{ scale: 0.82, opacity: 0 }}
            transition={{ type: "spring", stiffness: 180, damping: 20 }}
          >
            <motion.span
              animate={{ scale: [0.78, 1.28], opacity: [0.8, 0] }}
              className="experience-intro__scan"
              transition={{ duration: 1.5, ease: "easeOut", repeat: 1 }}
            />
            <span className="experience-intro__core" />
          </motion.div>

          <motion.div
            animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
            className="experience-intro__copy"
            initial={{ y: 12, opacity: 0, filter: "blur(8px)" }}
            transition={{ delay: 0.18, duration: 0.48 }}
          >
            <strong>OrbitWatch</strong>
            <span>Initializing orbital field</span>
          </motion.div>

          <motion.div
            animate={{ scaleX: 1 }}
            className="experience-intro__progress"
            initial={{ scaleX: 0 }}
            transition={{ delay: 0.2, duration: 1.3, ease: [0.22, 1, 0.36, 1] }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default ExperienceIntro;
