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
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
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

    /**
     * In-page links, which the browser gets almost right and then drops.
     *
     * `scroll-padding-top` in the stylesheet is what stops an anchor landing
     * under the floating header. This is the other half: mark what was arrived
     * at so it can react, and put the cursor in the field if there is one, so
     * "Find my path" ends with somewhere to type rather than a silent scroll.
     *
     * A second click on the same link is the case worth writing code for. The
     * hash is already set by then, so the browser fires nothing and `:target`
     * re-matches nothing - the click looks broken. Removing the class and
     * reading `offsetWidth` restarts the animation for real.
     *
     * Links to another page keep their default behaviour untouched.
     */
    const landOnAnchor = (event: MouseEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      const link = event.target instanceof Element ? event.target.closest("a[href*='#']") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank") return;

      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;

      // `getElementById`, not `querySelector`: a fragment is arbitrary text and
      // has no business being parsed as a selector.
      const id = decodeURIComponent(url.hash.slice(1));
      const landing = id && document.getElementById(id);
      if (!landing) return;

      event.preventDefault();
      window.history.replaceState(null, "", `#${id}`);
      landing.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "start" });

      landing.classList.remove("just-landed");
      void landing.getBoundingClientRect();
      landing.classList.add("just-landed");
      landing.addEventListener("animationend", () => landing.classList.remove("just-landed"), { once: true });

      // Below the fold the smooth scroll is still running; focusing without
      // `preventScroll` would teleport past it.
      landing.querySelector<HTMLElement>("input:not([type=hidden]), textarea")?.focus({ preventScroll: true });
    };

    root.classList.add("motion-ready");
    syncScrollState();
    window.addEventListener("scroll", requestScrollSync, { passive: true });
    window.addEventListener("resize", requestScrollSync);
    document.addEventListener("click", closeNavMenu);
    document.addEventListener("click", landOnAnchor);
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
      document.removeEventListener("click", landOnAnchor);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      root.classList.remove("motion-ready", "nav-scrolled");
      root.style.removeProperty("--scroll-progress");
    };
  }, []);

  return null;
}
