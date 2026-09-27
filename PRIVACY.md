# Privacy

Lipit Capture is a local desktop application. It has no analytics, advertising, crash reporting or Lipit operated server.

The desktop application sends a media URL and the minimum request context needed for compatibility directly to the selected media site through local media tools. Downloaded files, settings and download history remain on the computer.

The Chromium extension observes video elements and media request metadata in open HTTP and HTTPS tabs so it can identify the video selected by the user. It stores a bounded, temporary candidate list in the browser session. It does not collect cookies, authorization headers, form values or page contents, and it sends a candidate to the desktop application only when the user presses a Lipit action.

When browser cookie compatibility is explicitly enabled in Settings, yt-dlp reads the selected browser's local cookie store during the requested operation. Cookies are not copied into the extension or Lipit history.

Clearing Lipit's history removes history records and does not delete downloaded media files.
