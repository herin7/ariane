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
     * The animation library, fetched on hover rather than on click.
     *
     * It is a real download and a click is the one moment nobody will wait
     * through. Pointing at the link is the free half second, so the chunk is
     * almost always resting in memory by the time the button goes down. It is
     * requested once and the promise is the cache.
     */
    let thread: Promise<typeof import("./thread")> | undefined;
    const warmThread = () => {
      if (!thread && !reduced.matches) thread = import("./thread").catch(() => undefined as never);
    };

    /**
     * In-page links, which the browser gets almost right and then drops.
     *
     * `scroll-padding-top` in the stylesheet is what stops an anchor landing
     * under the floating header. This is the other half: throw the thread at
     * what was linked to, and put the cursor in the field if there is one, so
     * "Find my path" ends with somewhere to type rather than a silent scroll.
     *
     * The scroll is started before the animation is awaited, deliberately. The
     * jump is the part that has to be instant; the thread is the part that is
     * allowed to be late, and on a cold cache it simply does not play. A second
     * click replays all of it, which is why none of this is a `:target` rule -
     * the hash is already set by then, nothing re-matches, and the click looks
     * broken.
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

      // Below the fold the smooth scroll is still running; focusing without
      // `preventScroll` would teleport past it.
      const field = landing.querySelector<HTMLElement>("input:not([type=hidden]), textarea");
      field?.focus({ preventScroll: true });

      if (reduced.matches) return;

      // Where the thread leaves from, measured now: the header is fixed on wide
      // screens and scrolls away on narrow ones, so a point read later is a
      // point somewhere else.
      const pill = link.getBoundingClientRect();
      const from = { x: pill.left + pill.width / 2, y: pill.top + pill.height / 2 };

      warmThread();
      void thread?.then((module) => {
        if (!module || !landing.isConnected) return;
        module.launch(link);
        return module.throwThread(from, landing);
      });
    };

    root.classList.add("motion-ready");
    syncScrollState();
    window.addEventListener("scroll", requestScrollSync, { passive: true });
    window.addEventListener("resize", requestScrollSync);
    document.addEventListener("click", closeNavMenu);
    document.addEventListener("click", landOnAnchor);
    document.addEventListener("pointerenter", warmThread, { capture: true, once: true });
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
      document.removeEventListener("pointerenter", warmThread, { capture: true });
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      root.classList.remove("motion-ready", "nav-scrolled");
      root.style.removeProperty("--scroll-progress");
    };
  }, []);

  return null;
}
