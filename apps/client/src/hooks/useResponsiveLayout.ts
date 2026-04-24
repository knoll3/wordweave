import { useEffect, useState } from "react";

export function useResponsiveLayout({
  portraitTabletLayoutQuery,
  mobileLayoutQuery,
}: {
  portraitTabletLayoutQuery: string;
  mobileLayoutQuery: string;
}) {
  const [isPortraitTabletLayout, setIsPortraitTabletLayout] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(portraitTabletLayoutQuery).matches;
  });
  const [isMobileLayout, setIsMobileLayout] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(mobileLayoutQuery).matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(portraitTabletLayoutQuery);
    const handleChange = () => {
      setIsPortraitTabletLayout(mediaQuery.matches);
    };

    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [portraitTabletLayoutQuery]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(mobileLayoutQuery);
    const handleChange = () => {
      setIsMobileLayout(mediaQuery.matches);
    };

    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [mobileLayoutQuery]);

  return {
    isPortraitTabletLayout,
    isMobileLayout,
  };
}
