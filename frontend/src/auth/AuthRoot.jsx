import {
  AnimatePresence,
  motion,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import App from "../App.jsx";
import AuthPage from "../pages/AuthPage.jsx";
import BootSequence from "../components/BootSequence.jsx";
import LiveEarthWarmup from "../components/LiveEarthWarmup.jsx";
import {
  clearAccessToken,
  fetchCurrentUser,
  getStoredAccessToken,
  storeAccessToken,
} from "../services/orbitwatchApi.js";
import {
  getCachedStartupCountry,
  resolveStartupCountry,
} from "../services/startupCountry.js";
import "./AuthRoot.css";

const INTRO_MINIMUM_MS = 6400;
const GUEST_LIVE_WARM_MS = 900;
const GUEST_AUTH_WARM_MS = 850;
const TOKEN_BOOT_MINIMUM_MS = 1250;

function pageFromPath() {
  return window.location.pathname === "/register"
    ? "register"
    : "login";
}

function replacePath(path) {
  if (window.location.pathname !== path) {
    window.history.replaceState({}, "", path);
  }
}

function pushPath(path) {
  if (window.location.pathname !== path) {
    window.history.pushState({}, "", path);
  }
}

export default function AuthRoot() {
  const initialToken = getStoredAccessToken();
  const timersRef = useRef([]);
  const countryLockedRef = useRef(false);

  const [sessionState, setSessionState] = useState(
    initialToken ? "checking" : "guest",
  );
  const [authPage, setAuthPage] = useState(pageFromPath);
  const [currentUser, setCurrentUser] = useState(null);

  const [bootVisible, setBootVisible] = useState(true);
  const [bootMinimumDone, setBootMinimumDone] = useState(false);
  const [liveEarthWarmupVisible, setLiveEarthWarmupVisible] = useState(!initialToken);
  const [authSceneMounted, setAuthSceneMounted] = useState(Boolean(initialToken));

  const [launching, setLaunching] = useState(false);
  const [introMinimumDone, setIntroMinimumDone] = useState(false);
  const [liveReady, setLiveReady] = useState(false);
  const [liveVisible, setLiveVisible] = useState(false);
  const [hudActive, setHudActive] = useState(false);
  const [hudCycle, setHudCycle] = useState(0);
  const [startupCountry, setStartupCountry] = useState(
    () => getCachedStartupCountry(),
  );

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const queueTimer = useCallback((callback, milliseconds) => {
    const timer = window.setTimeout(callback, milliseconds);
    timersRef.current.push(timer);
    return timer;
  }, []);

  const beginIntro = useCallback(() => {
    countryLockedRef.current = true;
    clearTimers();
    setBootVisible(false);
    setLaunching(true);
    setIntroMinimumDone(false);
    setLiveVisible(false);
    setHudActive(false);
    setHudCycle((value) => value + 1);
    setSessionState("launching");
    replacePath("/");

    queueTimer(() => {
      setIntroMinimumDone(true);
    }, INTRO_MINIMUM_MS);
  }, [clearTimers, queueTimer]);

  const logout = useCallback(() => {
    clearTimers();
    clearAccessToken();
    setCurrentUser(null);
    setSessionState("guest");
    setLaunching(false);
    setIntroMinimumDone(false);
    setLiveReady(false);
    setLiveVisible(false);
    setHudActive(false);
    setBootVisible(false);
    setBootMinimumDone(true);
    setLiveEarthWarmupVisible(false);
    setAuthSceneMounted(true);
    setAuthPage("login");
    replacePath("/login");
  }, [clearTimers]);

  const handleLiveReady = useCallback(() => {
    setLiveReady(true);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    resolveStartupCountry(controller.signal)
      .then((country) => {
        if (!countryLockedRef.current) {
          setStartupCountry(country);
        }
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          // India is already the synchronous fallback.
        }
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timers = [];

    if (initialToken) {
      timers.push(
        window.setTimeout(() => {
          setBootMinimumDone(true);
        }, TOKEN_BOOT_MINIMUM_MS),
      );
    } else {
      timers.push(
        window.setTimeout(() => {
          setLiveEarthWarmupVisible(false);
          setAuthSceneMounted(true);
        }, GUEST_LIVE_WARM_MS),
      );

      timers.push(
        window.setTimeout(() => {
          setBootMinimumDone(true);
        }, GUEST_LIVE_WARM_MS + GUEST_AUTH_WARM_MS),
      );
    }

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    const onUnauthorized = () => logout();
    window.addEventListener("orbitwatch:unauthorized", onUnauthorized);
    return () => window.removeEventListener("orbitwatch:unauthorized", onUnauthorized);
  }, [logout]);

  useEffect(() => {
    if (sessionState !== "checking") return undefined;

    const controller = new AbortController();

    fetchCurrentUser(controller.signal)
      .then((user) => {
        setCurrentUser(user);
        setLiveReady(false);
        setSessionState("token-ready");
        replacePath("/");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        clearAccessToken();
        setCurrentUser(null);
        setSessionState("guest");
        setAuthPage("login");
        setLiveEarthWarmupVisible(false);
        setAuthSceneMounted(true);
        if (bootMinimumDone) setBootVisible(false);
        replacePath("/login");
      });

    return () => controller.abort();
  }, [sessionState, bootMinimumDone]);

  useEffect(() => {
    if (
      sessionState === "guest" &&
      bootMinimumDone &&
      authSceneMounted
    ) {
      setBootVisible(false);
    }
  }, [sessionState, bootMinimumDone, authSceneMounted]);

  useEffect(() => {
    if (
      sessionState === "token-ready" &&
      bootMinimumDone &&
      authSceneMounted
    ) {
      beginIntro();
    }
  }, [sessionState, bootMinimumDone, authSceneMounted, beginIntro]);

  useEffect(() => {
    if (
      sessionState !== "launching" ||
      !introMinimumDone ||
      !liveReady
    ) {
      return undefined;
    }

    setLiveVisible(true);

    const hudTimer = window.setTimeout(() => {
      setHudActive(true);
    }, 480);

    const finishTimer = window.setTimeout(() => {
      setLaunching(false);
      setSessionState("authenticated");
      replacePath("/");
    }, 1150);

    return () => {
      window.clearTimeout(hudTimer);
      window.clearTimeout(finishTimer);
    };
  }, [sessionState, introMinimumDone, liveReady]);

  useEffect(() => {
    if (
      sessionState === "guest" &&
      !["/login", "/register"].includes(window.location.pathname)
    ) {
      replacePath(`/${authPage}`);
    }
  }, [sessionState, authPage]);

  useEffect(() => {
    function onPopState() {
      if (
        sessionState === "authenticated" ||
        sessionState === "launching" ||
        sessionState === "token-ready"
      ) {
        replacePath("/");
        return;
      }

      if (sessionState === "guest") {
        setAuthPage(pageFromPath());
      }
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [sessionState]);

  async function completeAuthentication(response) {
    if (!response?.access_token) {
      throw new Error("Backend did not return an access token.");
    }

    storeAccessToken(response.access_token);

    try {
      const user = await fetchCurrentUser();
      setCurrentUser(user);
      setLiveReady(false);
      setAuthSceneMounted(true);
      beginIntro();
    } catch (error) {
      clearAccessToken();
      throw error;
    }
  }

  function switchAuth(page) {
    const next = page === "register" ? "register" : "login";
    setAuthPage(next);
    pushPath(`/${next}`);
  }

  const appMounted = Boolean(currentUser);
  const authLayerMounted =
    authSceneMounted && sessionState !== "authenticated";
  const showAuthInterface =
    sessionState === "guest" && !launching;

  return (
    <main className="auth-root-shell">
      {liveEarthWarmupVisible && bootVisible ? (
        <LiveEarthWarmup />
      ) : null}

      {appMounted ? (
        <motion.div
          className="auth-root-layer auth-root-layer--live"
          initial={false}
          animate={{ opacity: liveVisible ? 1 : 0 }}
          transition={{
            duration: 0.92,
            ease: [0.22, 1, 0.36, 1],
          }}
          aria-hidden={!liveVisible}
        >
          <App
            currentUser={currentUser}
            onLogout={logout}
            hudActive={hudActive}
            hudCycle={hudCycle}
            onSceneReady={handleLiveReady}
                    startupCountry={startupCountry}
          />
        </motion.div>
      ) : null}

      <AnimatePresence>
        {authLayerMounted ? (
          <motion.div
            key="auth-layer"
            className="auth-root-layer auth-root-layer--auth"
            initial={{ opacity: 1 }}
            animate={{ opacity: liveVisible ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 0.92,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <AuthPage
              authType={authPage}
              launching={launching}
              showInterface={showAuthInterface}
              onAuthenticated={completeAuthentication}
              onSwitch={switchAuth}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {bootVisible ? (
          <BootSequence
            key="boot"
            preparingLive={
              sessionState === "checking" ||
              sessionState === "token-ready"
            }
          />
        ) : null}
      </AnimatePresence>
    </main>
  );
}
