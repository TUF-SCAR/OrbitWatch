import { AnimatePresence, motion } from "motion/react";
import {
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Orbit,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import SolarSystemScene from "../components/SolarSystemScene.jsx";
import SpatialSurface from "../components/SpatialSurface.jsx";
import {
  loginAccount,
  registerAccount,
} from "../services/orbitwatchApi.js";
import "./AuthPage.css";

function AuthField({ icon: FieldIcon, label, trailing, ...inputProperties }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <div>
        <FieldIcon size={16} />
        <input {...inputProperties} />
        {trailing || null}
      </div>
    </label>
  );
}

export default function AuthPage({
  authType,
  launching,
  onAuthenticated,
  onSwitch,
  showInterface = true,
}) {
  const registrationOpen = authType === "register";
  const [username, setUsername] = useState("");
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [formMessage, setFormMessage] = useState("");
  const [requestRunning, setRequestRunning] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  async function submitAuthentication(event) {
    event.preventDefault();
    setFormMessage("");

    const normalizedUsername = username.trim();
    const normalizedUsernameOrEmail =
      usernameOrEmail.trim();
    const normalizedEmail = email.trim();
    const normalizedPassword = password.trim();
    const normalizedConfirmPassword =
      confirmPassword.trim();

    setUsername(normalizedUsername);
    setUsernameOrEmail(normalizedUsernameOrEmail);
    setEmail(normalizedEmail);
    setPassword(normalizedPassword);
    setConfirmPassword(normalizedConfirmPassword);

    if (
      registrationOpen &&
      normalizedPassword !== normalizedConfirmPassword
    ) {
      setFormMessage("The two passwords do not match.");
      return;
    }

    setRequestRunning(true);

    try {
      const authResponse = registrationOpen
        ? await registerAccount({
            username: normalizedUsername,
            email: normalizedEmail,
            password: normalizedPassword,
          })
        : await loginAccount({
            usernameOrEmail: normalizedUsernameOrEmail,
            password: normalizedPassword,
          });

      await onAuthenticated(authResponse);
    } catch (error) {
      setFormMessage(
        error?.detail ||
          error?.message ||
          "OrbitWatch could not authenticate this account.",
      );
      setRequestRunning(false);
    }
  }

  const busy = requestRunning || launching;
  const interfaceVisible = !launching && !previewOpen;

  return (
    <main
      data-auth-interface={showInterface ? "visible" : "hidden"} className="auth-page">
      <SolarSystemScene launching={launching} />

      <AnimatePresence>
        {interfaceVisible ? (
          <motion.div
            key="auth-interface"
            className="auth-interface"
            initial={{ opacity: 0, filter: "blur(10px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{
              opacity: 0,
              filter: "blur(8px)",
              scale: 0.992,
            }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="auth-page__backdrop" />
            <div className="auth-coordinate-grid" />

            <div className="auth-page__header">
              <SpatialSurface side="left" strength={2.4} className="auth-brand">
                <span className="auth-brand__mark" data-depth="4">
                  <Orbit size={20} />
                </span>
                <span data-depth="6">
                  <strong>ORBITWATCH</strong>
                  <small>SPATIAL ORBITAL INTELLIGENCE</small>
                </span>
              </SpatialSurface>
            </div>

            <SpatialSurface
              side="right"
              strength={2.4}
              className="auth-system-readout"
            >
              <LockKeyhole size={14} data-depth="4" />
              <span data-depth="5">SECURE ACCESS</span>
            </SpatialSurface>

            <div className="auth-page__content">
              <SpatialSurface
                as="section"
                key={authType}
                side="center"
                strength={3.2}
                className={`auth-panel ${registrationOpen ? "auth-panel--register" : ""}`}
              >
                <div className="auth-panel__topline" data-depth="3">
                  <span>IDENTITY GATEWAY</span>
                  <span>{registrationOpen ? "NEW ACCOUNT" : "AUTHENTICATION"}</span>
                </div>

                <div className="auth-heading" data-depth="5">
                  <span className="auth-heading__icon">
                    <UserRound size={23} />
                  </span>
                  <span>
                    <small>OrbitWatch account</small>
                    <h1>{registrationOpen ? "Create your account" : "Welcome back"}</h1>
                    <p>
                      {registrationOpen
                        ? "Create your identity for synchronized watchlists, alerts, and observation tools."
                        : "Authenticate to initialize your OrbitWatch workspace."}
                    </p>
                  </span>
                </div>

                <form className="auth-form" data-depth="6" onSubmit={submitAuthentication}>
                  {registrationOpen ? (
                    <AuthField
                      autoComplete="username"
                      icon={UserRound}
                      label="USERNAME"
                      onChange={(event) => setUsername(event.target.value)}
                      onBlur={(event) => setUsername(event.target.value.trim())}
                      placeholder="Choose a username"
                      required
                      type="text"
                      value={username}
                    />
                  ) : (
                    <AuthField
                      autoComplete="username"
                      icon={UserRound}
                      label="USERNAME OR EMAIL"
                      onChange={(event) => setUsernameOrEmail(event.target.value)}
                      onBlur={(event) => setUsernameOrEmail(event.target.value.trim())}
                      placeholder="Username or email"
                      required
                      type="text"
                      value={usernameOrEmail}
                    />
                  )}

                  {registrationOpen ? (
                    <AuthField
                      autoComplete="email"
                      icon={Mail}
                      label="EMAIL"
                      onChange={(event) => setEmail(event.target.value)}
                      onBlur={(event) => setEmail(event.target.value.trim())}
                      placeholder="you@example.com"
                      required
                      type="email"
                      value={email}
                    />
                  ) : null}

                  <AuthField
                    autoComplete={registrationOpen ? "new-password" : "current-password"}
                    icon={LockKeyhole}
                    label="PASSWORD"
                    minLength={8}
                    onChange={(event) => setPassword(event.target.value)}
                    onBlur={(event) => setPassword(event.target.value.trim())}
                    placeholder="Minimum 8 characters"
                    required
                    trailing={
                      <button
                        aria-label={passwordVisible ? "Hide password" : "Show password"}
                        onClick={() => setPasswordVisible((current) => !current)}
                        type="button"
                      >
                        {passwordVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    }
                    type={passwordVisible ? "text" : "password"}
                    value={password}
                  />

                  {registrationOpen ? (
                    <AuthField
                      autoComplete="new-password"
                      icon={LockKeyhole}
                      label="CONFIRM PASSWORD"
                      minLength={8}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      onBlur={(event) => setConfirmPassword(event.target.value.trim())}
                      placeholder="Repeat your password"
                      required
                      type={passwordVisible ? "text" : "password"}
                      value={confirmPassword}
                    />
                  ) : null}

                  {formMessage ? <p className="auth-form-message">{formMessage}</p> : null}

                  <button className="auth-submit-button" disabled={busy} type="submit">
                    <span className="auth-submit-button__signal" />
                    {requestRunning
                      ? "AUTHENTICATING"
                      : registrationOpen
                        ? "CREATE ACCOUNT"
                        : "LOGIN"}
                  </button>
                </form>

                <div className="auth-panel__divider" data-depth="4" />

                <p className="auth-switch" data-depth="5">
                  {registrationOpen ? "ALREADY REGISTERED?" : "NEW TO ORBITWATCH?"}
                  <button
                    disabled={busy}
                    onClick={() => onSwitch(registrationOpen ? "login" : "register")}
                    type="button"
                  >
                    {registrationOpen ? "LOGIN" : "CREATE ACCOUNT"}
                  </button>
                </p>

                <div className="auth-panel__status" data-depth="3">
                  <span><i /> BACKEND LINK READY</span>
                  <span>SOLAR SYSTEM ACTIVE</span>
                </div>
              </SpatialSurface>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {!launching ? (
          <motion.button
            key="preview-toggle"
            className="auth-preview-toggle"
            type="button"
            aria-pressed={previewOpen}
            onClick={() => setPreviewOpen((value) => !value)}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 18 }}
            transition={{ duration: 0.18 }}
          >
            <span>{previewOpen ? "Interface hidden" : "System view"}</span>
            <strong>{previewOpen ? "RETURN TO LOGIN" : "PREVIEW SYSTEM"}</strong>
          </motion.button>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
