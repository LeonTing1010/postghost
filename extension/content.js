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

  // ── Rate Limiter ────────────────────────────────────────────────

  let lastFetchTime = 0;
  const fetchQueue = [];
  let fetchRunning = false;

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
      const now = Date.now();
      const wait = Math.max(0, RATE_LIMIT_MS - (now - lastFetchTime));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));

      lastFetchTime = Date.now();
      try {
        const resp = await fetch(url, { credentials: "include" });
        if (resp.status === 429) {
          // Back off hard on 429 — double the delay for remaining queue
          console.warn("[PostGhost] Reddit 429 — backing off");
          await new Promise((r) => setTimeout(r, 10_000));
          resolve(null);
          continue;
        }
        if (!resp.ok) { resolve(null); continue; }
        resolve(await resp.json());
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
   * Create an inline banner for single post view.
   */
  function createBanner(result) {
    const banner = document.createElement("div");
    banner.setAttribute(BADGE_ATTR, "banner");

    if (result.status === "live") {
      banner.className = "postghost-banner postghost-banner-live";
      banner.innerHTML = `<span class="postghost-banner-icon">&#x1F7E2;</span> <strong>LIVE</strong> &mdash; ${result.detail}`;
    } else if (result.status === "ghost") {
      banner.className = "postghost-banner postghost-banner-ghost";
      banner.innerHTML =
        `<span class="postghost-banner-icon">&#x1F534;</span> <strong>GHOST</strong> &mdash; ${result.detail}`;
    } else if (result.status === "deleted") {
      banner.className = "postghost-banner postghost-banner-deleted";
      banner.innerHTML =
        `<span class="postghost-banner-icon">&#x26AA;</span> <strong>DELETED</strong> &mdash; ${result.detail}`;
    }

    return banner;
  }

  // ── Job 1: Detect new post → check after delay → notify ────────

  let lastUrl = location.href;

  function isPostUrl(url) {
    return /reddit\.com\/r\/\w+\/comments\/\w+/i.test(url);
  }

  function isOwnPostPage() {
    // On new Reddit, check if there's a post action menu (edit/delete) — indicates authorship
    // On old Reddit, check for .buttons .edit-usertext
    return (
      !!document.querySelector('[slot="post-overflow-menu"]') ||
      !!document.querySelector(".buttons .edit-usertext") ||
      !!document.querySelector('button[aria-label="Edit post"]')
    );
  }

  async function checkCurrentPost() {
    const url = location.href;
    if (!isPostUrl(url)) return;

    const json = await redditJson(url);
    const post = extractPost(json);
    if (!post || Array.isArray(post)) return; // Not a single post

    const result = diagnose(post);

    // Inject banner on post page if authored by user
    if (isOwnPostPage()) {
      injectPostBanner(result);
    }

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
  function watchNavigation() {
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
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
    });
    observer.observe(document.body, { childList: true, subtree: true });
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

    // Fetch user's submitted posts
    const json = await redditJson(`https://old.reddit.com/user/${username}/submitted`);
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

    // Find post elements in the page and badge them
    requestAnimationFrame(() => {
      badgeNewReddit(diagMap);
      badgeOldReddit(diagMap);
    });
  }

  function badgeNewReddit(diagMap) {
    // New Reddit: posts are <a> or <article> elements with post links
    const links = document.querySelectorAll('a[href*="/comments/"]');
    for (const link of links) {
      // Already badged?
      if (link.querySelector(`[${BADGE_ATTR}]`)) continue;

      // Extract post ID from href
      const m = link.href.match(/\/comments\/(\w+)/);
      if (!m) continue;

      const result = diagMap.get(m[1]);
      if (!result) continue;

      const badge = createBadge(result);
      link.insertBefore(badge, link.firstChild);
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
