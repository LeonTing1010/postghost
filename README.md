# Is My Post Removed? for Reddit

**See what Reddit hides.** Instant ghost detection for every post you make.

Reddit silently removes posts without telling you. You can still see your own post, but nobody else can — it's a ghost post. This extension reads Reddit's own internal signals and shows you the truth in seconds.

## How It Works

1. You post on Reddit
2. Extension checks automatically (30 seconds after posting)
3. A badge appears: **LIVE**, **GHOST**, or **DYING**

```
LIVE   My SaaS hit $9k MRR last month...        328  67
GHOST  Got my posts removed 3 times with no...     1   6
       spam_filter — karma 12, need 50
DYING  Anyone else given up on Reddit marketing?  91  95
```

The extension reads Reddit's `removed_by_category` field from the public `.json` endpoint — the same signal Reddit uses internally. One fetch per post, no third-party APIs, no Pushshift.

## Install

**[Add to Chrome](https://chrome.google.com/webstore/detail/TODO)** (Chrome Web Store) — free, no sign-up.

Or install manually:

1. Download the [latest release](https://github.com/LeonTing1010/postghost/releases)
2. Unzip and go to `chrome://extensions`
3. Enable "Developer mode" and click "Load unpacked"
4. Select the `extension/` folder

## Features

- Ghost detection on every post you make
- LIVE / GHOST / DYING status badges on your profile page
- Inline banner on individual post pages
- Browser notification when a new post is ghosted
- Removal cause: spam filter, moderator, AutoMod, karma gate, age gate
- Works on both new Reddit and old.reddit.com
- No data collection, no accounts, no tracking

## Why Posts Get Ghosted

| Cause | What happens |
|---|---|
| **Spam filter** | Low karma or new account triggers Reddit's automated filter |
| **AutoMod** | Subreddit-specific rules (certain words, link patterns, etc.) |
| **Moderator** | A human mod removed your post manually |
| **Karma gate** | Subreddit requires minimum karma you don't have |
| **Age gate** | Subreddit requires minimum account age |

## How is this different from Reveddit?

| | This extension | Reveddit Real-Time |
|---|---|---|
| Detection | Reddit native `.json` | Pushshift API (being deprecated) |
| False positives | Low (reads official field) | Known issue |
| Rate limiting | None (one fetch per post) | Users report 429 errors |
| Tells you WHY | Yes | No |
| Price | Free | Free |

## Privacy

- No data leaves your browser
- No accounts, no sign-up
- No analytics, no tracking
- Only reads your own posts via Reddit's public `.json` endpoint
- Open source — read every line of code right here

Full privacy policy: [postghost/privacy](https://leonting1010.github.io/postghost/privacy.html)

## Support

- **Bug reports**: [GitHub Issues](https://github.com/LeonTing1010/postghost/issues)
- **Questions & ideas**: [GitHub Discussions](https://github.com/LeonTing1010/postghost/discussions)
- **FAQ & troubleshooting**: [Support page](https://leonting1010.github.io/postghost/support.html)

## License

MIT
