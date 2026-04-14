# Is My Post Removed? for Reddit

**See what Reddit hides.** Instant ghost detection for every post and comment you make.

Reddit silently removes posts and comments without telling you. You can still see your own content, but nobody else can — it's a ghost. This extension reads Reddit's own internal signals and shows you the truth in seconds.

## How It Works

1. You post or comment on Reddit
2. Extension checks automatically (30 seconds after posting)
3. A badge appears: **LIVE** or **GHOST** — plus WHY it was removed

```
LIVE   My SaaS hit $9k MRR last month...
GHOST  Got my posts removed 3 times with no...
       spam_filter — Reddit's spam filter removed this post

LIVE   Great point about the API approach...
GHOST  I've been using an open-source project...
       spam_filter — Reddit's spam filter removed this comment
```

The extension reads Reddit's `removed_by_category` field from the public `.json` endpoint — the same signal Reddit uses internally. One fetch per item, no third-party APIs, no Pushshift.

## Install

Install manually:

1. Download the [latest release](https://github.com/LeonTing1010/postghost/releases)
2. Unzip and go to `chrome://extensions`
3. Enable "Developer mode" and click "Load unpacked"
4. Select the `extension/` folder

## Features

- Ghost detection on every post and comment you make
- Status badges on your profile page (posts and comments tabs)
- Inline banner on individual post pages
- Browser notification when a new post is ghosted
- Removal cause: spam filter, moderator, AutoMod, admin, copyright takedown
- Works on both new Reddit and old.reddit.com
- No data collection, no accounts, no tracking

## Removal Causes Detected

| Cause | `removed_by_category` | What happened |
|---|---|---|
| **Spam filter** | `reddit` | Reddit's automated filter flagged your post |
| **Moderator** | `moderator` | A subreddit mod removed your post |
| **AutoMod** | `automod_filtered` | AutoMod rules filtered your post |
| **Admin** | `deleted` | A Reddit admin removed your post |
| **Copyright** | `copyright_takedown` | Removed due to a copyright claim |
| **Content policy** | `content_takedown` | Removed for content policy violation |

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

Full privacy policy: [Privacy Policy](https://leonting1010.github.io/postghost/privacy.html)

## Support

- **Bug reports**: [GitHub Issues](https://github.com/LeonTing1010/postghost/issues)
- **Questions & ideas**: [GitHub Discussions](https://github.com/LeonTing1010/postghost/discussions)
- **FAQ & troubleshooting**: [Support page](https://leonting1010.github.io/postghost/support.html)

## License

[MIT](LICENSE)
