# Lipit Capture Browser Extension

Version 0.7 Chromium Manifest V3 extension. It observes `<video>` and `<source>`
elements, follows SPA DOM changes, and passively observes media requests through
`webRequest`. MP4, WebM, MOV, HLS, and DASH candidates are normalized in a
session-backed CandidateStore. Media segments and duplicate requests are not
presented as separate sources. Signed URL changes and adaptive quality variants
are grouped while the best master manifest is preserved. The selected candidate is forwarded to the
desktop app through Native Messaging.

The compact video toolbar contains three icon actions: open in Lipit, quick
clip, and quick download. Hovering or focusing an icon shows its description.
Drag the Lipit icon to reposition the toolbar over a video. `Shift + F9` hides
or restores every Lipit toolbar and keeps that preference across page reloads.

## Local installation

1. Run `npm run build` in the repository root.
2. Run `npm run install:bridge` once to register the native host for Chrome,
   Edge, and Brave.
3. Open the browser's extensions page, enable Developer mode, choose **Load
   unpacked**, and select `apps/extension/dist`.

The stable extension ID is `nhcgifoaikjkndkbnkkllknmlfbkdcbc`. The extension
does not modify or block requests and does not collect cookies or authorization
headers.
