"use client";

import { useEffect } from "react";

/**
 * A tiny, content-agnostic reveal layer.
 *
 * The page is fully visible without JavaScript. Once hydrated, sections opt in
 * with `data-reveal` and enter once as they cross the reading line. A mutation
 * observer covers client-side navigation without coupling motion to any route.
 */
export function MotionObserver() {
  useEffect(() => {
    const root = document.documentElement;
    let scrollFrame = 0;

    const syncScrollState = () => {
      scrollFrame = 0;
      const scrollable = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      const progress = Math.min(Math.max(window.scrollY / scrollable, 0), 1);
      root.classList.toggle("nav-scrolled", window.scrollY > 48);
      root.style.setProperty("--scroll-progress", progress.toFixed(4));
    };

    const requestScrollSync = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(syncScrollState);
    };

    const seen = new WeakSet<Element>();
    const intersection = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in-view");
          intersection.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    const register = (root: ParentNode) => {
      const candidates = [
        ...(root instanceof Element && root.matches("[data-reveal]") ? [root] : []),
        ...root.querySelectorAll("[data-reveal]"),
      ];
      for (const candidate of candidates) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        intersection.observe(candidate);
      }
    };

    // The header survives a client-side navigation, so the mobile menu would
    // still be hanging open over the page you just asked for.
    const closeNavMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      target.closest(".nav-menu[open] a")?.closest("details")?.removeAttribute("open");
    };

    root.classList.add("motion-ready");
    syncScrollState();
    window.addEventListener("scroll", requestScrollSync, { passive: true });
    window.addEventListener("resize", requestScrollSync);
    document.addEventListener("click", closeNavMenu);
    register(document);

    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) register(node);
        }
      }
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutations.disconnect();
      intersection.disconnect();
      window.removeEventListener("scroll", requestScrollSync);
      window.removeEventListener("resize", requestScrollSync);
      document.removeEventListener("click", closeNavMenu);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      root.classList.remove("motion-ready", "nav-scrolled");
      root.style.removeProperty("--scroll-progress");
    };
  }, []);

  return null;
}
