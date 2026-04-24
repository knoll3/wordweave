import { useEffect, useRef, useState } from "react";

type VirtualKeyboardApi = {
  overlaysContent: boolean;
  boundingRect: DOMRectReadOnly;
  addEventListener: (
    type: "geometrychange",
    listener: EventListenerOrEventListenerObject
  ) => void;
  removeEventListener: (
    type: "geometrychange",
    listener: EventListenerOrEventListenerObject
  ) => void;
};

export function useMobileKeyboardWorkarounds({
  isMobileLayout,
  isSearchFocused,
  setIsSearchFocused,
  isAndroidDevice,
}: {
  isMobileLayout: boolean;
  isSearchFocused: boolean;
  setIsSearchFocused: (value: boolean) => void;
  isAndroidDevice: boolean;
}) {
  const [androidViewportHeight, setAndroidViewportHeight] = useState<number | null>(null);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);
  const isMobileLayoutRef = useRef(isMobileLayout);
  const isSearchFocusedRef = useRef(isSearchFocused);
  const androidKeyboardHeightRef = useRef(androidKeyboardHeight);
  const keyboardWasOpenRef = useRef(false);
  const maxVisualViewportHeightRef = useRef(
    typeof window === "undefined" ? 0 : window.visualViewport?.height ?? window.innerHeight
  );

  isMobileLayoutRef.current = isMobileLayout;
  isSearchFocusedRef.current = isSearchFocused;
  androidKeyboardHeightRef.current = androidKeyboardHeight;

  function blurActiveInput() {
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      ["INPUT", "TEXTAREA"].includes(activeElement.tagName)
    ) {
      activeElement.blur();
    }
  }

  function clearMobileSearchFocus() {
    keyboardWasOpenRef.current = false;
    setIsSearchFocused(false);
    blurActiveInput();
  }

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearMobileSearchFocus();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", clearMobileSearchFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", clearMobileSearchFocus);
    };
  }, []);

  useEffect(() => {
    const handleViewportChange = () => {
      const visualViewportHeight = window.visualViewport?.height ?? window.innerHeight;
      maxVisualViewportHeightRef.current = Math.max(
        maxVisualViewportHeightRef.current,
        visualViewportHeight
      );

      if (!isMobileLayoutRef.current || !isSearchFocusedRef.current) {
        keyboardWasOpenRef.current = false;
        return;
      }

      const viewportHeightDrop = maxVisualViewportHeightRef.current - visualViewportHeight;
      const viewportGap = Math.max(0, window.innerHeight - visualViewportHeight);
      const keyboardLooksOpen =
        androidKeyboardHeightRef.current > 0 ||
        viewportHeightDrop > 80 ||
        viewportGap > 80;

      if (keyboardLooksOpen) {
        keyboardWasOpenRef.current = true;
        return;
      }

      if (keyboardWasOpenRef.current) {
        clearMobileSearchFocus();
      }
    };

    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, []);

  useEffect(() => {
    if (!isAndroidDevice) {
      setAndroidViewportHeight(null);
      setAndroidKeyboardHeight(0);
      document.documentElement.style.removeProperty("--android-viewport-height");
      document.documentElement.style.removeProperty("--android-keyboard-height");
      return;
    }

    const virtualKeyboard = (
      navigator as Navigator & { virtualKeyboard?: VirtualKeyboardApi }
    ).virtualKeyboard;

    if (virtualKeyboard) {
      virtualKeyboard.overlaysContent = true;
    }

    const applyViewportHeight = () => {
      const nextHeight = Math.round(window.visualViewport?.height ?? window.innerHeight);
      setAndroidViewportHeight(nextHeight);
      document.documentElement.style.setProperty(
        "--android-viewport-height",
        `${nextHeight}px`
      );
      window.scrollTo(0, 0);
    };

    const scheduleRefresh = () => {
      applyViewportHeight();
      window.requestAnimationFrame(applyViewportHeight);
      window.setTimeout(applyViewportHeight, 120);
      window.setTimeout(applyViewportHeight, 280);
    };

    const applyKeyboardGeometry = () => {
      const nextKeyboardHeight = Math.max(
        0,
        Math.round(virtualKeyboard?.boundingRect.height ?? 0)
      );
      setAndroidKeyboardHeight(nextKeyboardHeight);
      document.documentElement.style.setProperty(
        "--android-keyboard-height",
        `${nextKeyboardHeight}px`
      );
      scheduleRefresh();
    };

    scheduleRefresh();
    applyKeyboardGeometry();
    window.addEventListener("resize", scheduleRefresh);
    window.visualViewport?.addEventListener("resize", scheduleRefresh);
    window.visualViewport?.addEventListener("scroll", scheduleRefresh);
    virtualKeyboard?.addEventListener("geometrychange", applyKeyboardGeometry);

    const handlePointerDownCapture = (event: PointerEvent) => {
      const target = event.target;
      const activeElement = document.activeElement;
      if (
        !(target instanceof Element) ||
        !(activeElement instanceof HTMLElement) ||
        !["INPUT", "TEXTAREA"].includes(activeElement.tagName)
      ) {
        return;
      }
      if (activeElement.contains(target) || target.closest("input, textarea")) {
        return;
      }
      activeElement.blur();
      window.requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        applyKeyboardGeometry();
      });
    };

    document.addEventListener("pointerdown", handlePointerDownCapture, true);

    return () => {
      window.removeEventListener("resize", scheduleRefresh);
      window.visualViewport?.removeEventListener("resize", scheduleRefresh);
      window.visualViewport?.removeEventListener("scroll", scheduleRefresh);
      virtualKeyboard?.removeEventListener("geometrychange", applyKeyboardGeometry);
      document.removeEventListener("pointerdown", handlePointerDownCapture, true);
      document.documentElement.style.removeProperty("--android-keyboard-height");
    };
  }, [isAndroidDevice]);

  return {
    androidViewportHeight,
    androidKeyboardHeight,
    clearMobileSearchFocus,
  };
}
