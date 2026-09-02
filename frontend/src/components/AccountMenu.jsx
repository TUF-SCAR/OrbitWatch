import { motion, stagger } from "motion/react";
import {
  Bell,
  Bookmark,
  LogIn,
  Settings,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import LiquidGlass from "./LiquidGlass.jsx";

const listVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      delayChildren: stagger(0.05),
    },
  },
  exit: {
    opacity: 0,
    transition: {
      delayChildren: stagger(0.02, { from: "last" }),
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 9, filter: "blur(6px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: 5, filter: "blur(4px)" },
};

function AccountMenu({
  navigateToPage,
  onClose,
  layoutId = "account-surface",
}) {
  function openAuthenticationPage(pageName) {
    onClose();
    navigateToPage(pageName);
  }

  return (
    <LiquidGlass
      animate={{ opacity: 1, scale: 1 }}
      className="account-menu overlay-surface"
      exit={{ opacity: 0, scale: 0.985 }}
      initial={{ opacity: 0, scale: 0.985 }}
      layoutId={layoutId}
      strength="strong"
      transition={{ type: "spring", stiffness: 260, damping: 29 }}
    >
      <header className="overlay-heading">
        <div className="account-menu__identity">
          <span className="account-avatar">
            <UserRound size={21} />
          </span>
          <span>
            <small>Guest account</small>
            <strong>Build your OrbitWatch profile</strong>
          </span>
        </div>

        <button aria-label="Close account menu" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </header>

      <motion.div
        animate="visible"
        className="account-menu__content"
        exit="exit"
        initial="hidden"
        variants={listVariants}
      >
        <motion.p className="account-menu__description" variants={itemVariants}>
          Sign in to synchronize watchlists, saved locations, alerts, and
          observation plans.
        </motion.p>

        <motion.div className="account-menu__actions" variants={itemVariants}>
          <button onClick={() => openAuthenticationPage("login")} type="button">
            <LogIn size={17} />
            <span>
              <strong>Login</strong>
              <small>Open your synchronized account</small>
            </span>
          </button>

          <button
            onClick={() => openAuthenticationPage("register")}
            type="button"
          >
            <UserPlus size={17} />
            <span>
              <strong>Create account</strong>
              <small>Start saving objects and alerts</small>
            </span>
          </button>
        </motion.div>

        <motion.div className="account-menu__disabled" variants={itemVariants}>
          <span>
            <Bookmark size={16} />
            Watchlist
          </span>
          <span>
            <Bell size={16} />
            Alerts
          </span>
          <span>
            <Settings size={16} />
            Settings
          </span>
        </motion.div>
      </motion.div>
    </LiquidGlass>
  );
}

export default AccountMenu;
