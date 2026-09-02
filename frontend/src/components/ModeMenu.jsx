import { motion, stagger } from "motion/react";
import { Activity, Clock3, Sparkles, X } from "lucide-react";
import LiquidGlass from "./LiquidGlass.jsx";

const MODES = [
  {
    id: "live",
    label: "Live Mode",
    description: "Current objects, orbital trails, and live intelligence",
    available: true,
    icon: Activity,
  },
  {
    id: "time",
    label: "Time Explorer",
    description: "Historical positions and future orbital exploration",
    available: false,
    icon: Clock3,
  },
  {
    id: "lab",
    label: "Disaster Lab",
    description: "Earth-disaster simulation and response planning",
    available: false,
    icon: Sparkles,
  },
];

const menuVariants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      delayChildren: stagger(0.055),
    },
  },
  exit: {
    opacity: 0,
    transition: {
      delayChildren: stagger(0.025, { from: "last" }),
    },
  },
};

const optionVariants = {
  hidden: {
    opacity: 0,
    y: 12,
    filter: "blur(7px)",
  },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
  },
  exit: {
    opacity: 0,
    y: 7,
    filter: "blur(4px)",
  },
};

function ModeMenu({ onClose, layoutId = "mode-surface" }) {
  return (
    <LiquidGlass
      animate={{ opacity: 1, scale: 1 }}
      className="mode-menu overlay-surface"
      exit={{ opacity: 0, scale: 0.985 }}
      initial={{ opacity: 0, scale: 0.985 }}
      layoutId={layoutId}
      strength="strong"
      transition={{ type: "spring", stiffness: 260, damping: 29 }}
    >
      <motion.header
        animate={{ opacity: 1, y: 0 }}
        className="overlay-heading"
        initial={{ opacity: 0, y: 8 }}
        transition={{ delay: 0.08 }}
      >
        <span>
          <small>Experience modes</small>
          <strong>Choose how you explore</strong>
        </span>
        <button aria-label="Close mode menu" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </motion.header>

      <motion.div
        animate="visible"
        className="mode-menu__list"
        exit="exit"
        initial="hidden"
        variants={menuVariants}
      >
        {MODES.map((mode) => {
          const ModeIcon = mode.icon;

          return (
            <motion.button
              className={mode.available ? "mode-option active" : "mode-option"}
              disabled={!mode.available}
              key={mode.id}
              type="button"
              variants={optionVariants}
              whileHover={mode.available ? { x: 4, scale: 1.008 } : undefined}
              whileTap={mode.available ? { scale: 0.985 } : undefined}
            >
              <span className="mode-option__icon">
                <ModeIcon size={19} />
              </span>
              <span className="mode-option__copy">
                <strong>{mode.label}</strong>
                <small>{mode.description}</small>
              </span>
              <i>{mode.available ? "Active" : "Later"}</i>
            </motion.button>
          );
        })}
      </motion.div>
    </LiquidGlass>
  );
}

export default ModeMenu;
