/**
 * PostGhost content script — runs on reddit.com
 *
 * Three jobs:
 * 1. Detect when user posts → check after 30s → notify if ghost
 * 2. On profile/posts page → badge every post 🟢🔴
 * 3. On single post page (authored by user) → show inline banner
 */

(() => {
  "use strict";

  // Avoid double-injection
  if (window.__postghost_loaded) return;
  window.__postghost_loaded = true;

  // ── Config ──────────────────────────────────────────────────────

  const CHECK_DELAY_MS = 30_000; // Wait 30s after posting for Reddit's filters
  const JSON_SUFFIX = ".json?raw_json=1";
  const BADGE_ATTR = "data-postghost";
  const RATE_LIMIT_MS = 2500; // Min 2.5s between Reddit .json fetches to avoid IP ban
  const CACHE_TTL_MS = 5 * 60 * 1000; // Cache results for 5 minutes

  // ── Cache ───────────────────────────────────────────────────────

  const jsonCache = new Map();

  function cacheGet(url) {
    const entry = jsonCache.get(url);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > CACHE_TTL_MS) { jsonCache.delete(url); return undefined; }
    return entry.data;
  }

  function cacheSet(url, data) {
    jsonCache.set(url, { data, ts: Date.now() });
  }

  // ── Logged-in Username ──────────────────────────────────────────

  let loggedInUser = null;
  let loggedInUserPromise = null;

  function getLoggedInUser() {
    if (loggedInUser) return loggedInUser;
    // Old Reddit
    const oldUser = document.querySelector('.user a');
    if (oldUser && oldUser.href?.includes('/user/')) {
      const m = oldUser.href.match(/\/user\/([^/?#]+)/);
      if (m) { loggedInUser = m[1]; return loggedInUser; }
    }
    return null;
  }

  /** Async fallback: fetch /api/me.json (works on new Reddit where DOM selectors fail) */
  async function ensureLoggedInUser() {
    if (loggedInUser) return loggedInUser;
    getLoggedInUser();
    if (loggedInUser) return loggedInUser;
    if (!loggedInUserPromise) {
      loggedInUserPromise = fetch("/api/me.json", { credentials: "include" })
        .then((r) => r.json())
        .then((d) => { loggedInUser = d?.data?.name || d?.name || null; return loggedInUser; })
        .catch(() => null);
    }
    return loggedInUserPromise;
  }

  // ── Rate Limiter ────────────────────────────────────────────────

  let lastFetchTime = 0;
  const fetchQueue = [];
  let fetchRunning = false;
  let backoffMs = RATE_LIMIT_MS;

  /**
   * Rate-limited fetch queue. Ensures at least RATE_LIMIT_MS between
   * requests to Reddit's .json endpoints. Without this, batch-checking
   * a profile page can trigger Reddit's IP-level rate limiter (429 → ban).
   */
  async function processFetchQueue() {
    if (fetchRunning) return;
    fetchRunning = true;

    while (fetchQueue.length > 0) {
      const { url, resolve } = fetchQueue.shift();

      // Check cache first
      const cached = cacheGet(url);
      if (cached !== undefined) { resolve(cached); continue; }

      const now = Date.now();
      const wait = Math.max(0, backoffMs - (now - lastFetchTime));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));

      lastFetchTime = Date.now();
      try {
        const resp = await fetch(url, { credentials: "include" });
        if (resp.status === 429) {
          // Exponential backoff: double delay, drain remaining queue with null
          backoffMs = Math.min(backoffMs * 2, 60_000);
          console.warn(`[PostGhost] Reddit 429 — backoff now ${backoffMs}ms, draining ${fetchQueue.length} queued`);
          await new Promise((r) => setTimeout(r, backoffMs));
          resolve(null);
          // Drain remaining queue to avoid hammering
          while (fetchQueue.length > 0) fetchQueue.shift().resolve(null);
          continue;
        }
        // Reset backoff on success
        backoffMs = RATE_LIMIT_MS;
        if (!resp.ok) { resolve(null); continue; }
        const data = await resp.json();
        cacheSet(url, data);
        resolve(data);
      } catch {
        resolve(null);
      }
    }

    fetchRunning = false;
  }

  // ── Helpers ─────────────────────────────────────────────────────

  /**
   * Fetch Reddit JSON with the user's cookies.
   * Rate-limited to avoid triggering Reddit's IP ban.
   * Returns parsed JSON or null on failure.
   */
  function redditJson(url) {
    // Normalize URL: ensure it ends with / before appending .json
    const base = url.replace(/\/?(\?.*)?$/, "/");
    const jsonUrl = base + JSON_SUFFIX;
    return new Promise((resolve) => {
      fetchQueue.push({ url: jsonUrl, resolve });
      processFetchQueue();
    });
  }

  /**
   * Extract post data from Reddit's listing JSON format.
   */
  function extractPost(json) {
    // Single post page: json is [listing, comments]
    if (Array.isArray(json)) {
      const children = json[0]?.data?.children;
      if (children?.length) return children[0].data;
    }
    // User submitted page: json is { data: { children: [...] } }
    if (json?.data?.children) {
      return json.data.children.map((c) => c.data);
    }
    return null;
  }

  /**
   * Determine ghost status from a post's data.
   * Returns { status, cause, detail }
   */
  function diagnose(post) {
    if (!post) return { status: "unknown", cause: null, detail: "Could not read post data" };

    // Deleted by author
    if (post.author === "[deleted]") {
      return { status: "deleted", cause: "deleted_by_author", detail: "You deleted this post" };
    }

    // Removed by Reddit/mod/automod
    const rbc = post.removed_by_category;
    if (rbc) {
      const causeMap = {
        reddit: { cause: "spam_filter", detail: "Reddit's spam filter removed this post" },
        moderator: { cause: "mod_removed", detail: "A moderator removed this post" },
        automod_filtered: { cause: "automod", detail: "AutoMod filtered this post" },
        deleted: { cause: "admin_removed", detail: "A Reddit admin removed this post" },
        author: { cause: "deleted_by_author", detail: "You deleted this post" },
        copyright_takedown: { cause: "copyright", detail: "Removed due to copyright claim" },
        content_takedown: { cause: "content_takedown", detail: "Removed due to content policy" },
      };
      const info = causeMap[rbc] || { cause: rbc, detail: `Removed by: ${rbc}` };
      return { status: "ghost", ...info };
    }

    // Check other removal signals
    if (post.removed === true) {
      return { status: "ghost", cause: "removed", detail: "This post was removed" };
    }
    if (post.selftext === "[removed]") {
      return { status: "ghost", cause: "content_removed", detail: "Post content was removed" };
    }
    if (post.is_robot_indexable === false && post.author !== "[deleted]") {
      return { status: "ghost", cause: "not_indexable", detail: "This post is hidden from feeds" };
    }

    return { status: "live", cause: null, detail: "This post is visible to everyone" };
  }

  /**
   * Create a badge element.
   */
  function createBadge(result) {
    const badge = document.createElement("span");
    badge.setAttribute(BADGE_ATTR, result.status);

    if (result.status === "live") {
      badge.className = "postghost-badge postghost-live";
      badge.textContent = "LIVE";
      badge.title = result.detail;
    } else if (result.status === "ghost") {
      badge.className = "postghost-badge postghost-ghost";
      badge.textContent = "GHOST";
      badge.title = `${result.detail}`;
    } else if (result.status === "deleted") {
      badge.className = "postghost-badge postghost-deleted";
      badge.textContent = "DELETED";
      badge.title = result.detail;
    } else {
      badge.className = "postghost-badge postghost-unknown";
      badge.textContent = "?";
      badge.title = result.detail;
    }

    return badge;
  }

  /**
   * Actionable tips per removal cause.
   */
  const causeTips = {
    spam_filter: "Tip: New accounts and link-heavy posts trigger Reddit's spam filter most often. Build karma with comments first, then try reposting without links.",
    mod_removed: "Tip: Check this subreddit's rules — your post may have violated a specific rule. You can message the mods to ask why.",
    automod: "Tip: AutoMod rules vary by subreddit. Common triggers: low karma, new account, banned keywords. Try a different subreddit or rephrase.",
    admin_removed: "This is a site-wide action by Reddit admins. Review Reddit's content policy to avoid future removals.",
    copyright: "A copyright holder filed a takedown. If you believe this is wrong, you can file a counter-notice.",
    content_takedown: "This post violated Reddit's content policy. Review the policy to understand which rule was triggered.",
    removed: "Tip: The post was removed but the specific reason is unclear. Try messaging the subreddit mods.",
    content_removed: "The post content was stripped. This usually means a mod or admin action.",
    not_indexable: "Your post is hidden from feeds and search. This can happen silently — only you can see it.",
  };

  /**
   * Create an inline banner for single post view.
   */
  function createBanner(result) {
    const banner = document.createElement("div");
    banner.setAttribute(BADGE_ATTR, "banner");

    const icons = { live: "\u{1F7E2}", ghost: "\u{1F47B}", deleted: "\u26AA" };
    const titles = { live: "LIVE", ghost: "GHOST", deleted: "DELETED" };
    const classes = { live: "postghost-banner-live", ghost: "postghost-banner-ghost", deleted: "postghost-banner-deleted" };

    const status = result.status in icons ? result.status : "deleted";
    banner.className = `postghost-banner ${classes[status]}`;

    const icon = document.createElement("span");
    icon.className = "postghost-banner-icon";
    icon.textContent = icons[status];

    const body = document.createElement("div");
    body.className = "postghost-banner-body";

    const title = document.createElement("div");
    title.className = "postghost-banner-title";
    title.textContent = titles[status];

    const detail = document.createElement("div");
    detail.className = "postghost-banner-detail";
    detail.textContent = result.detail;

    body.appendChild(title);
    body.appendChild(detail);

    // Add actionable tip for ghost posts
    if (result.status === "ghost" && result.cause && causeTips[result.cause]) {
      const tip = document.createElement("div");
      tip.className = "postghost-banner-tip";
      tip.textContent = causeTips[result.cause];
      body.appendChild(tip);
    }

    banner.appendChild(icon);
    banner.appendChild(body);

    return banner;
  }

  // ── Job 1: Detect new post → check after delay → notify ────────

  let lastUrl = location.href;

  function isPostUrl(url) {
    return /reddit\.com\/r\/\w+\/comments\/\w+/i.test(url);
  }

  async function isOwnPost(post) {
    if (!post?.author) return false;
    const me = await ensureLoggedInUser();
    return me && post.author.toLowerCase() === me.toLowerCase();
  }

  async function checkCurrentPost() {
    const url = location.href;
    if (!isPostUrl(url)) return;

    const json = await redditJson(url);
    const post = extractPost(json);
    if (!post || Array.isArray(post)) return; // Not a single post

    const result = diagnose(post);

    // Inject banner on post page if authored by user (compare via JSON author)
    if (await isOwnPost(post)) {
      injectPostBanner(result);

      // Send notification for ghost posts
      if (result.status === "ghost") {
        const sub = post.subreddit || "unknown";
        chrome.runtime.sendMessage({
          type: "postghost_notify",
          title: `Your post in r/${sub} was ghosted`,
          message: result.detail,
        });
      }
    }
  }

  function injectPostBanner(result) {
    // Don't inject twice
    if (document.querySelector(`[${BADGE_ATTR}="banner"]`)) return;

    const banner = createBanner(result);

    // New Reddit: insert before post content
    const newRedditPost = document.querySelector("shreddit-post") || document.querySelector('[data-test-id="post-content"]');
    if (newRedditPost) {
      newRedditPost.parentElement.insertBefore(banner, newRedditPost);
      return;
    }

    // Old Reddit: insert before .usertext-body
    const oldRedditPost = document.querySelector(".expando .usertext-body") || document.querySelector("#siteTable .thing .entry");
    if (oldRedditPost) {
      oldRedditPost.parentElement.insertBefore(banner, oldRedditPost);
    }
  }

  // Watch for URL changes (SPA navigation on new Reddit)
  // Uses history API interception instead of MutationObserver for performance —
  // new Reddit's React SPA fires thousands of DOM mutations per second.
  function watchNavigation() {
    function onNavChange() {
      if (location.href === lastUrl) return;
      const prevUrl = lastUrl;
      lastUrl = location.href;

      // If navigated TO a post page (likely just posted)
      if (isPostUrl(lastUrl) && !isPostUrl(prevUrl)) {
        setTimeout(checkCurrentPost, CHECK_DELAY_MS);
      }
      // If already on a post page (direct navigation)
      else if (isPostUrl(lastUrl)) {
        checkCurrentPost();
      }
      // If on profile page
      else if (isProfilePostsPage(lastUrl)) {
        badgeProfilePosts();
      }
    }

    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function () {
      origPushState.apply(this, arguments);
      onNavChange();
    };
    history.replaceState = function () {
      origReplaceState.apply(this, arguments);
      onNavChange();
    };
    window.addEventListener("popstate", onNavChange);
  }

  // ── Job 2: Badge all posts on profile page ─────────────────────

  function isProfilePostsPage(url) {
    url = url || location.href;
    return /reddit\.com\/user\/[^/]+\/(submitted|posts)/i.test(url) ||
      (/reddit\.com\/user\/[^/]+\/?$/i.test(url));
  }

  async function badgeProfilePosts() {
    if (!isProfilePostsPage()) return;

    // Extract username from URL
    const match = location.href.match(/reddit\.com\/user\/([^/?#]+)/i);
    if (!match) return;
    const username = match[1];

    // Fetch user's submitted posts (use same origin to avoid CORS issues)
    const json = await redditJson(`${location.origin}/user/${username}/submitted`);
    if (!json) return;

    const posts = extractPost(json);
    if (!Array.isArray(posts)) return;

    // Build a map of post id → diagnosis
    const diagMap = new Map();
    for (const post of posts) {
      if (post.id) {
        diagMap.set(post.id, diagnose(post));
      }
    }

    // Report ghost count to background for icon badge
    let ghostCount = 0;
    for (const result of diagMap.values()) {
      if (result.status === "ghost") ghostCount++;
    }
    chrome.runtime.sendMessage({ type: "postghost_badge_update", ghostCount });

    // Find post elements in the page and badge them
    requestAnimationFrame(() => {
      badgeNewReddit(diagMap);
      badgeOldReddit(diagMap);
    });
  }

  function badgeNewReddit(diagMap) {
    // New Reddit: posts are <shreddit-post> elements with post-id or permalink attributes
    const shredditPosts = document.querySelectorAll("shreddit-post");
    for (const post of shredditPosts) {
      if (post.querySelector(`[${BADGE_ATTR}]`)) continue;

      // Extract post ID from permalink attribute or inner link
      const permalink = post.getAttribute("permalink") || "";
      const m = permalink.match(/\/comments\/(\w+)/) ||
        post.querySelector('a[href*="/comments/"]')?.href?.match(/\/comments\/(\w+)/);
      if (!m) continue;

      const result = diagMap.get(m[1]);
      if (!result) continue;

      const badge = createBadge(result);
      // Insert badge into the title link
      const titleLink = post.querySelector('a[slot="title"], a.block.text-neutral-content-strong, a[data-testid="post-title"]');
      if (titleLink) {
        titleLink.style.display = "inline-flex";
        titleLink.style.alignItems = "center";
        titleLink.style.gap = "6px";
        titleLink.insertBefore(badge, titleLink.firstChild);
      } else {
        // Fallback: prepend to shreddit-post itself
        post.insertBefore(badge, post.firstChild);
      }
    }

    // Fallback for non-shreddit layouts
    if (shredditPosts.length === 0) {
      const links = document.querySelectorAll('a[href*="/comments/"]');
      for (const link of links) {
        if (link.querySelector(`[${BADGE_ATTR}]`)) continue;
        const m = link.href.match(/\/comments\/(\w+)/);
        if (!m) continue;
        const result = diagMap.get(m[1]);
        if (!result) continue;
        const badge = createBadge(result);
        link.insertBefore(badge, link.firstChild);
      }
    }
  }

  function badgeOldReddit(diagMap) {
    // Old Reddit: posts are .thing elements with data-fullname="t3_xxx"
    const things = document.querySelectorAll(".thing[data-fullname]");
    for (const thing of things) {
      if (thing.querySelector(`[${BADGE_ATTR}]`)) continue;

      const fullname = thing.getAttribute("data-fullname");
      if (!fullname?.startsWith("t3_")) continue;

      const postId = fullname.slice(3);
      const result = diagMap.get(postId);
      if (!result) continue;

      const badge = createBadge(result);
      const titleLink = thing.querySelector("a.title");
      if (titleLink) {
        titleLink.parentElement.insertBefore(badge, titleLink);
      }
    }
  }

  // ── Init ────────────────────────────────────────────────────────

  function init() {
    // Prefetch logged-in username (async, non-blocking)
    ensureLoggedInUser();

    // If on a post page, check it
    if (isPostUrl(location.href)) {
      checkCurrentPost();
    }

    // If on profile posts page, badge all posts
    if (isProfilePostsPage()) {
      badgeProfilePosts();
    }

    // Watch for SPA navigation
    watchNavigation();
  }

  // Wait for page to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
