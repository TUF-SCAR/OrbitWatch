import {pushReceipt,refreshBrowserPush,revokePushOnLogout} from '../services/browserPush.js';
import { useCallback, useEffect, useRef, useState } from "react";
import App from "../App.jsx";
import AuthPage from "../pages/AuthPage.jsx";
import BootSequence from "../components/BootSequence.jsx";
import { clearAccessToken, fetchCurrentUser, getStoredAccessToken, revokeCurrentSession, storeAccessToken } from "../services/orbitwatchApi.js";
import { getCachedStartupCountry, resolveStartupCountry } from "../services/startupCountry.js";
import { usePhoneUI } from "../utils/usePhoneUI.js";
import "./AuthRoot.css";
function pageFromPath() { return window.location.pathname === "/register" ? "register" : "login"; }
export default function AuthRoot() {
  const [pendingToken, setPendingToken] = useState(getStoredAccessToken);
  const [phase, setPhase] = useState(pendingToken ? "checking" : "guest");
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const [verificationBusy, setVerificationBusy] = useState(Boolean(pendingToken));
  const [sessionError, setSessionError] = useState("");
  const [verificationMode,setVerificationMode] = useState("restore");
  const retryVerification = useCallback(() => { setVerificationBusy(true); setVerificationAttempt(value => value + 1); }, []);
  const [authPage, setAuthPage] = useState(pageFromPath);
  const [user, setUser] = useState(null);
  const [bootDone, setBootDone] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [travelDone, setTravelDone] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [country, setCountry] = useState(getCachedStartupCountry);
  const countryLocked = useRef(false);
  const notificationParams=new URLSearchParams(window.location.search);
  const pendingNotification=useRef(notificationParams.get('notifications')==='1'?'/?'+new URLSearchParams({notifications:'1',...(/^[a-f0-9-]{36}$/.test(notificationParams.get('notice')||'')?{notice:notificationParams.get('notice')}:{})}):null);
  const authenticated = phase === "ready";
  const liveVisible = (phase === "handoff" || authenticated);
  const phone = usePhoneUI();
  // Give pickup the phone's first frames before starting a second WebGL scene.
  const mountLiveScene = user && (!phone || phase !== "extract");
  const startTravel = useCallback(() => { setTravelDone(false); setCycle((value) => value + 1); setPhase("travel"); window.history.replaceState({}, "", pendingNotification.current||"/");if(pendingNotification.current)window.dispatchEvent(new Event('orbitwatch:notification-open'));pendingNotification.current=null; }, []);
  const logoutBusy=useRef(false);
  const sessionOwner=useRef(null);
  const ownerId=user?.id;
  const logout = useCallback((reason) => {
    if(logoutBusy.current)return;
    logoutBusy.current=true;
    const token=getStoredAccessToken(), receipt=pushReceipt();
    const revoked=token&&reason?.type!=='storage'
      ?revokeCurrentSession(token,receipt?.ownerId===sessionOwner.current?receipt.id:null).catch(()=>false)
      :null;
    sessionOwner.current=null;
    clearAccessToken();
    void revokePushOnLogout(revoked).catch(()=>{});
    setPendingToken(null); setVerificationBusy(false); setSessionError(""); setUser(null);
    setSceneReady(false); setTravelDone(false);
    setPhase(['orbitwatch:unauthorized','storage'].includes(reason?.type)||window.matchMedia('(prefers-reduced-motion: reduce)').matches?'guest':'return');
    setAuthPage("login"); window.history.replaceState({}, "", "/login");
  }, []);
  useEffect(()=>{
    if(!['return','deliver','guest'].includes(phase))return;
    if(phase==='guest'){logoutBusy.current=false;return;}
    const timer=setTimeout(()=>setPhase(phase==='return'?'deliver':'guest'),phase==='return'?2200:1600);
    return()=>clearTimeout(timer);
  },[phase]);
  const onSceneReady = useCallback(() => setSceneReady(true), []);
  const onReturnUnavailable=useCallback(()=>setPhase(previous=>['return','deliver'].includes(previous)?'guest':previous),[]);
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
      countryLocked.current = true; sessionOwner.current=result.id; setUser(result); setSessionError("");
      if (verificationMode === "login") { setSceneReady(false); setPhase("extract"); }
      else startTravel();
    }).catch((error) => {
      if (controller.signal.aborted) return;
      if (error.status === 401) logout();
      else { setSessionError(error.message || "Session verification is temporarily unavailable."); setPhase("unavailable"); }
    }).finally(() => { if (!controller.signal.aborted) setVerificationBusy(false); });
    return () => controller.abort();
  }, [pendingToken, verificationAttempt, startTravel, logout,verificationMode]);
  useEffect(() => {
    if (phase !== "unavailable" || verificationBusy) return;
    const timer = window.setTimeout(retryVerification, Math.min(30000, 5000 * 2 ** Math.min(verificationAttempt, 3)));
    window.addEventListener("online", retryVerification);
    return () => { window.clearTimeout(timer); window.removeEventListener("online", retryVerification); };
  }, [phase, verificationAttempt, verificationBusy, retryVerification]);
  useEffect(() => { window.addEventListener("orbitwatch:unauthorized", logout); return () => window.removeEventListener("orbitwatch:unauthorized", logout); }, [logout]);
  useEffect(() => {
    const signedOut=event=>{if(event.key==='orbitwatch_access_token'&&event.oldValue&&!event.newValue)logout(event);};
    window.addEventListener('storage',signedOut);
    return()=>window.removeEventListener('storage',signedOut);
  },[logout]);
  useEffect(() => {
    if(!authenticated||!ownerId)return;
    const controller=new AbortController();
    let checkedAt=0;
    const sync=()=>{
      if(Date.now()-checkedAt<60000)return;
      checkedAt=Date.now();
      refreshBrowserPush(ownerId,controller.signal).catch(()=>{});
    };
    sync();window.addEventListener('focus',sync);
    return()=>{controller.abort();window.removeEventListener('focus',sync);};
  },[authenticated,ownerId]);
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
    setVerificationMode("login");
    setVerificationBusy(true); setPendingToken(response.access_token); setVerificationAttempt(value => value + 1); setPhase("checking");
  }
  return <div className="auth-root-shell">
    {mountLiveScene && <div className={`auth-root-layer auth-root-layer--live ${liveVisible ? "is-visible" : ""}`} style={{ opacity: liveVisible ? 1 : 0, transition: "opacity 600ms ease" }} inert={!liveVisible} aria-hidden={!liveVisible}><App currentUser={user} onLogout={logout} hudActive={authenticated} hudCycle={cycle} onSceneReady={onSceneReady} startupCountry={country} /></div>}
    {!authenticated && <div className="auth-root-layer auth-root-layer--auth" style={{ opacity: liveVisible ? 0 : 1, transition: "opacity 600ms ease", pointerEvents: liveVisible ? "none" : "auto" }} inert={phase !== "guest" && phase !== "extract" && !(phase === "checking" && verificationMode === "login")}><AuthPage onReturnUnavailable={onReturnUnavailable} returning={phase==="return"} delivering={phase==="deliver"} authType={authPage} launching={phase === "travel" || phase === "handoff"} extracting={phase === "extract"} onExtracted={startTravel} startupCountry={country} verifying={verificationBusy && verificationMode === "login"} showInterface={phase === "deliver" || phase === "guest" || phase === "extract" || (phase === "checking" && verificationMode === "login")} onAuthenticated={completeAuthentication} onSwitch={(next) => { setAuthPage(next); window.history.pushState({}, "", `/${next}`); }} /></div>}
    {(!bootDone || (phase === "checking" && verificationMode !== "login")) && <BootSequence preparingLive={phase === "checking"} />}
    {phase === "unavailable" && <section className="auth-session-recovery" role="alert" aria-busy={verificationBusy}>
      <h1>Unable to verify your session</h1><p>{sessionError}</p>
      <button autoFocus disabled={verificationBusy} onClick={retryVerification}>{verificationBusy ? "VERIFYING…" : "RETRY"}</button>
      <button onClick={logout}>BACK TO LOGIN</button>
    </section>}
  </div>;
}
