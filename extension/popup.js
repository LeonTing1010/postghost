/**
 * PostGhost popup — shows ghost/live counts from background state.
 */

chrome.runtime.sendMessage({ type: "postghost_get_stats" }, (stats) => {
  if (!stats || !stats.scanned) {
    document.getElementById("message").textContent =
      "Visit your Reddit profile to scan posts.";
    return;
  }

  document.getElementById("ghost-count").textContent = stats.ghost;
  document.getElementById("live-count").textContent = stats.live;
  document.getElementById("total-count").textContent = stats.total;

  if (stats.ghost > 0) {
    document.getElementById("message").textContent =
      `${stats.ghost} of ${stats.total} posts removed — only you can see them.`;
  } else {
    document.getElementById("message").textContent =
      "All scanned posts are visible. You're good!";
  }
});
