import { useCallback, useEffect, useRef, useState } from "react";
import App from "../App.jsx";
import AuthPage from "../pages/AuthPage.jsx";
import BootSequence from "../components/BootSequence.jsx";
import { clearAccessToken, fetchCurrentUser, getStoredAccessToken, storeAccessToken } from "../services/orbitwatchApi.js";
import { getCachedStartupCountry, resolveStartupCountry } from "../services/startupCountry.js";
import "./AuthRoot.css";
function pageFromPath() { return window.location.pathname === "/register" ? "register" : "login"; }
export default function AuthRoot() {
  const [pendingToken, setPendingToken] = useState(getStoredAccessToken);
  const [phase, setPhase] = useState(pendingToken ? "checking" : "guest");
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const [verificationBusy, setVerificationBusy] = useState(Boolean(pendingToken));
  const [sessionError, setSessionError] = useState("");
  const verificationMode = useRef("restore");
  const retryVerification = useCallback(() => { setVerificationBusy(true); setVerificationAttempt(value => value + 1); }, []);
  const [authPage, setAuthPage] = useState(pageFromPath);
  const [user, setUser] = useState(null);
  const [bootDone, setBootDone] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [travelDone, setTravelDone] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [country, setCountry] = useState(getCachedStartupCountry);
  const countryLocked = useRef(false);
  const authenticated = phase === "ready";
  const liveVisible = (phase === "handoff" || authenticated);
  const startTravel = useCallback(() => { setTravelDone(false); setCycle((value) => value + 1); setPhase("travel"); window.history.replaceState({}, "", "/"); }, []);
  const logout = useCallback(() => { clearAccessToken(); setPendingToken(null); setVerificationBusy(false); setSessionError(""); setUser(null); setSceneReady(false); setTravelDone(false); setPhase("guest"); setAuthPage("login"); window.history.replaceState({}, "", "/login"); }, []);
  const onSceneReady = useCallback(() => setSceneReady(true), []);
  useEffect(() => { const timer = window.setTimeout(() => setBootDone(true), 850); return () => window.clearTimeout(timer); }, []);
  useEffect(() => {
    const controller = new AbortController();
    resolveStartupCountry(controller.signal).then((result) => { if (!countryLocked.current && !controller.signal.aborted) setCountry(result); }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!pendingToken) return;
    const controller = new AbortController();
    fetchCurrentUser(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      countryLocked.current = true; setUser(result); setSessionError("");
      if (verificationMode.current === "login") { setSceneReady(false); setPhase("extract"); }
      else startTravel();
    }).catch((error) => {
      if (controller.signal.aborted) return;
      if (error.status === 401) logout();
      else { setSessionError(error.message || "Session verification is temporarily unavailable."); setPhase("unavailable"); }
    }).finally(() => { if (!controller.signal.aborted) setVerificationBusy(false); });
    return () => controller.abort();
  }, [pendingToken, verificationAttempt, startTravel, logout]);
  useEffect(() => {
    if (phase !== "unavailable" || verificationBusy) return;
    const timer = window.setTimeout(retryVerification, Math.min(30000, 5000 * 2 ** Math.min(verificationAttempt, 3)));
    window.addEventListener("online", retryVerification);
    return () => { window.clearTimeout(timer); window.removeEventListener("online", retryVerification); };
  }, [phase, verificationAttempt, verificationBusy, retryVerification]);
  useEffect(() => { window.addEventListener("orbitwatch:unauthorized", logout); return () => window.removeEventListener("orbitwatch:unauthorized", logout); }, [logout]);
  useEffect(() => {
    if (phase !== "travel") return;
    const timer = window.setTimeout(() => setTravelDone(true), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 2200);
    return () => window.clearTimeout(timer);
  }, [phase]);
  useEffect(() => {
    if (phase !== "travel" || !travelDone || !sceneReady) return;
    const timer = window.setTimeout(() => setPhase("handoff"), 0);
    return () => window.clearTimeout(timer);
  }, [phase, travelDone, sceneReady]);
  useEffect(() => { if (phase !== "handoff") return; const timer = window.setTimeout(() => setPhase("ready"), 600); return () => window.clearTimeout(timer); }, [phase]);
  useEffect(() => {
    const pop = () => { if (phase === "guest") setAuthPage(pageFromPath()); else window.history.replaceState({}, "", "/"); };
    window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop);
  }, [phase]);
  async function completeAuthentication(response) {
    if (!response?.access_token) throw new Error("Backend did not return an access token.");
    storeAccessToken(response.access_token);
    verificationMode.current = "login";
    setVerificationBusy(true); setPendingToken(response.access_token); setVerificationAttempt(value => value + 1); setPhase("checking");
  }
  return <div className="auth-root-shell">
    {user && <div className={`auth-root-layer auth-root-layer--live ${liveVisible ? "is-visible" : ""}`} style={{ opacity: liveVisible ? 1 : 0, transition: "opacity 600ms ease" }} inert={!liveVisible} aria-hidden={!liveVisible}><App currentUser={user} onLogout={logout} hudActive={authenticated} hudCycle={cycle} onSceneReady={onSceneReady} startupCountry={country} /></div>}
    {!authenticated && <div className="auth-root-layer auth-root-layer--auth" style={{ opacity: liveVisible ? 0 : 1, transition: "opacity 600ms ease", pointerEvents: liveVisible ? "none" : "auto" }} inert={phase !== "guest" && phase !== "extract"}><AuthPage authType={authPage} launching={phase === "travel" || phase === "handoff"} extracting={phase === "extract"} onExtracted={startTravel} startupCountry={country} showInterface={phase === "guest" || phase === "extract"} onAuthenticated={completeAuthentication} onSwitch={(next) => { setAuthPage(next); window.history.pushState({}, "", `/${next}`); }} /></div>}
    {(!bootDone || phase === "checking") && <BootSequence preparingLive={phase === "checking"} />}
    {phase === "unavailable" && <section className="auth-session-recovery" role="alert" aria-busy={verificationBusy}>
      <h1>Unable to verify your session</h1><p>{sessionError}</p>
      <button autoFocus disabled={verificationBusy} onClick={retryVerification}>{verificationBusy ? "VERIFYING…" : "RETRY"}</button>
      <button onClick={logout}>BACK TO LOGIN</button>
    </section>}
  </div>;
}
