# Lipit Capture Browser Extension

Version 0.7 Chromium Manifest V3 extension. It observes `<video>` and `<source>`
elements, follows SPA DOM changes, and passively observes media requests through
`webRequest`. MP4, WebM, MOV, HLS, and DASH candidates are normalized in a
session-backed CandidateStore. Media segments and duplicate requests are not
presented as separate sources. Signed URL changes and adaptive quality variants
are grouped while the best master manifest is preserved. The selected candidate is forwarded to the
desktop app through Native Messaging.

The compact video toolbar expands on hover or focus. The lightning buttons next
to `İndir` and `Klip` use the quick profile saved in the desktop app. The `×`
control collapses the toolbar to its Lipit icon; clicking the icon shows the
controls again.

## Local installation

1. Run `npm run build` in the repository root.
2. Run `npm run install:bridge` once to register the native host for Chrome,
   Edge, and Brave.
3. Open the browser's extensions page, enable Developer mode, choose **Load
   unpacked**, and select `apps/extension/dist`.

The stable extension ID is `nhcgifoaikjkndkbnkkllknmlfbkdcbc`. The extension
does not modify or block requests and does not collect cookies or authorization
headers.
