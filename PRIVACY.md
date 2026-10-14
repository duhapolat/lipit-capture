# Privacy

Lipit Capture is a local desktop application. It has no analytics, advertising, crash reporting or Lipit operated server.

Optional update check: while "check for updates" is enabled in Settings, Lipit reads only the latest public version numbers of Lipit and yt-dlp from their public release pages at most once a day. No identifiers, cookies or usage data are sent, and nothing is downloaded without confirmation.

Local diagnostics: Lipit keeps a rotating local log (URLs reduced to their host, the profile folder masked), local usage counters shown only in Settings, and thumbnails of completed files. None of this leaves the computer.

The desktop application sends a media URL and the minimum request context needed for compatibility directly to the selected media site through local media tools. Downloaded files, settings and download history remain on the computer.

The Chromium extension observes video elements and media request metadata in open HTTP and HTTPS tabs so it can identify the video selected by the user. It stores a bounded, temporary candidate list in the browser session. It does not collect cookies, authorization headers, form values or page contents, and it sends a candidate to the desktop application only when the user presses a Lipit action.

When browser cookie compatibility is explicitly enabled in Settings, yt-dlp reads the selected browser's local cookie store during the requested operation. Cookies are not copied into the extension or Lipit history.

Clearing Lipit's history removes history records and does not delete downloaded media files.

Lipit stores the user's acceptance of the usage terms locally in its settings file. The Turkish privacy notice ([GIZLILIK.md](GIZLILIK.md)) is the primary, more detailed version of this document.
