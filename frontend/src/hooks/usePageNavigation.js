import { useEffect, useState } from "react";

const PAGE_PATHS = {
  live: "/",
  login: "/login",
  register: "/register",
};

function pageFromPath(pathname) {
  if (pathname === PAGE_PATHS.login) {
    return "login";
  }

  if (pathname === PAGE_PATHS.register) {
    return "register";
  }

  return "live";
}

export function usePageNavigation() {
  const [activePage, setActivePage] = useState(() =>
    pageFromPath(window.location.pathname),
  );

  useEffect(() => {
    function handleBrowserNavigation() {
      setActivePage(pageFromPath(window.location.pathname));
    }

    window.addEventListener("popstate", handleBrowserNavigation);

    return () => {
      window.removeEventListener("popstate", handleBrowserNavigation);
    };
  }, []);

  function navigateToPage(pageName) {
    const nextPath = PAGE_PATHS[pageName] ?? PAGE_PATHS.live;

    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }

    setActivePage(pageFromPath(nextPath));
  }

  return {
    activePage,
    navigateToPage,
  };
}
