/**
 * PostGhost background service worker
 *
 * - Browser notifications when a ghost post is detected
 * - Extension icon badge showing ghost count
 * - Stats for popup
 */

let stats = { ghost: 0, live: 0, total: 0, scanned: false };

function updateBadge() {
  if (stats.ghost > 0) {
    chrome.action.setBadgeText({ text: String(stats.ghost) });
    chrome.action.setBadgeBackgroundColor({ color: "#cf222e" });
  } else if (stats.scanned) {
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#1a7f37" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "postghost_notify") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon128.png",
      title: msg.title || "PostGhost",
      message: msg.message || "One of your posts may have been removed.",
      priority: 2,
    });
  }

  if (msg.type === "postghost_badge_update") {
    stats = {
      ghost: msg.ghostCount || 0,
      live: msg.liveCount || 0,
      total: msg.totalCount || 0,
      scanned: true,
    };
    updateBadge();
  }

  if (msg.type === "postghost_get_stats") {
    sendResponse(stats);
    return true;
  }
});
