import { AnimatePresence, motion, stagger } from "motion/react";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import AmbientFlow from "../components/AmbientFlow.jsx";
import Globe from "../components/Globe.jsx";
import LiquidGlass from "../components/LiquidGlass.jsx";
import OrbitWatchBrand from "../components/OrbitWatchBrand.jsx";
import {
  loginAccount,
  registerAccount,
} from "../services/orbitwatchApi.js";
import "./AuthPage.css";

const formVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      delayChildren: stagger(0.055),
    },
  },
};

const fieldVariants = {
  hidden: {
    opacity: 0,
    y: 10,
    filter: "blur(6px)",
  },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
  },
};

function AuthField({ icon: FieldIcon, label, ...inputProperties }) {
  return (
    <motion.label className="auth-field" variants={fieldVariants}>
      <span>{label}</span>
      <div>
        <FieldIcon size={18} />
        <input {...inputProperties} />
      </div>
    </motion.label>
  );
}

function AuthPage({ authType, navigateToPage }) {
  const registrationOpen = authType === "register";
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [formMessage, setFormMessage] = useState("");
  const [requestRunning, setRequestRunning] = useState(false);

  async function submitAuthentication(event) {
    event.preventDefault();
    setFormMessage("");

    if (registrationOpen && password !== confirmPassword) {
      setFormMessage("The two passwords do not match.");
      return;
    }

    setRequestRunning(true);

    try {
      if (registrationOpen) {
        await registerAccount({
          username,
          email,
          password,
        });
      } else {
        await loginAccount({
          email,
          password,
        });
      }

      navigateToPage("live");
    } catch {
      setFormMessage(
        "The authentication backend is not connected yet. We will build it next.",
      );
    } finally {
      setRequestRunning(false);
    }
  }

  return (
    <main className="auth-page">
      <Globe
        focusedNoradId={null}
        onConnectionStateChange={() => {}}
        onSpaceObjectData={() => {}}
        onSpaceObjectSelect={() => {}}
        showFocusedOrbit={false}
        spaceObjects={[]}
      />

      <AmbientFlow />
      <div className="auth-page__backdrop" />

      <div className="auth-page__header">
        <OrbitWatchBrand onClick={() => navigateToPage("live")} />
      </div>

      <motion.div
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="auth-page__content"
        initial={{ opacity: 0, y: 22, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 240, damping: 27 }}
      >
        <LiquidGlass
          className={`auth-panel ${registrationOpen ? "auth-panel--register" : ""}`}
          layoutId="auth-panel"
          strength="strong"
          transition={{ type: "spring", stiffness: 250, damping: 28 }}
        >
          <button
            className="auth-back-button"
            onClick={() => navigateToPage("live")}
            type="button"
          >
            <ArrowLeft size={17} /> Back to Live Mode
          </button>

          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="auth-heading"
            initial={{ opacity: 0, y: 10 }}
          >
            <span className="auth-heading__icon">
              <UserRound size={26} />
            </span>
            <span>
              <small>OrbitWatch account</small>
              <h1>{registrationOpen ? "Create your account" : "Welcome back"}</h1>
              <p>
                {registrationOpen
                  ? "Save objects, locations, alerts, and observation plans."
                  : "Open your synchronized watchlist and alerts."}
              </p>
            </span>
          </motion.div>

          <motion.form
            animate="visible"
            className="auth-form"
            initial="hidden"
            onSubmit={submitAuthentication}
            variants={formVariants}
          >
            <AnimatePresence initial={false}>
              {registrationOpen ? (
                <AuthField
                  autoComplete="username"
                  icon={UserRound}
                  key="username"
                  label="Username"
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Choose a username"
                  required
                  type="text"
                  value={username}
                />
              ) : null}
            </AnimatePresence>

            <AuthField
              autoComplete="email"
              icon={Mail}
              label="Email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />

            <motion.label className="auth-field" variants={fieldVariants}>
              <span>Password</span>
              <div>
                <LockKeyhole size={18} />
                <input
                  autoComplete={registrationOpen ? "new-password" : "current-password"}
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Minimum 8 characters"
                  required
                  type={passwordVisible ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                  onClick={() => setPasswordVisible((current) => !current)}
                  type="button"
                >
                  {passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </motion.label>

            <AnimatePresence initial={false}>
              {registrationOpen ? (
                <AuthField
                  autoComplete="new-password"
                  icon={LockKeyhole}
                  key="confirm-password"
                  label="Confirm password"
                  minLength={8}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repeat your password"
                  required
                  type={passwordVisible ? "text" : "password"}
                  value={confirmPassword}
                />
              ) : null}
            </AnimatePresence>

            {formMessage ? (
              <motion.p
                animate={{ opacity: 1, y: 0 }}
                className="auth-form-message"
                initial={{ opacity: 0, y: 6 }}
              >
                {formMessage}
              </motion.p>
            ) : null}

            <motion.button
              className="auth-submit-button"
              disabled={requestRunning}
              type="submit"
              variants={fieldVariants}
              whileHover={{ scale: 1.012, y: -1 }}
              whileTap={{ scale: 0.985 }}
            >
              {requestRunning
                ? "Connecting..."
                : registrationOpen
                  ? "Create account"
                  : "Login"}
            </motion.button>
          </motion.form>

          <motion.p
            animate={{ opacity: 1 }}
            className="auth-switch"
            initial={{ opacity: 0 }}
            transition={{ delay: 0.32 }}
          >
            {registrationOpen ? "Already have an account?" : "New to OrbitWatch?"}
            <button
              onClick={() =>
                navigateToPage(registrationOpen ? "login" : "register")
              }
              type="button"
            >
              {registrationOpen ? "Login" : "Create account"}
            </button>
          </motion.p>
        </LiquidGlass>
      </motion.div>
    </main>
  );
}

export default AuthPage;
