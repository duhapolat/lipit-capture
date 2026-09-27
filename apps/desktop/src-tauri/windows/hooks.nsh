!include "StrFunc.nsh"
${Using:StrFunc} StrRep

!define LIPIT_NATIVE_HOST_NAME "com.lipit.capture"
!define LIPIT_EXTENSION_ID "nhcgifoaikjkndkbnkkllknmlfbkdcbc"

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$LOCALAPPDATA\Lipit Capture\NativeMessaging\chromium"

  ; Chromium native messaging manifests use JSON, so use forward slashes in
  ; the absolute executable path instead of unescaped Windows backslashes.
  ${StrRep} $0 "$INSTDIR\lipit-native-host.exe" "\" "/"
  StrCpy $1 "$LOCALAPPDATA\Lipit Capture\NativeMessaging\chromium\${LIPIT_NATIVE_HOST_NAME}.json"
  FileOpen $2 "$1" w
  FileWrite $2 "{$\r$\n"
  FileWrite $2 "  $\"name$\": $\"${LIPIT_NATIVE_HOST_NAME}$\",$\r$\n"
  FileWrite $2 "  $\"description$\": $\"Lipit Capture native messaging bridge$\",$\r$\n"
  FileWrite $2 "  $\"path$\": $\"$0$\",$\r$\n"
  FileWrite $2 "  $\"type$\": $\"stdio$\",$\r$\n"
  FileWrite $2 "  $\"allowed_origins$\": [$\"chrome-extension://${LIPIT_EXTENSION_ID}/$\"]$\r$\n"
  FileWrite $2 "}$\r$\n"
  FileClose $2

  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\${LIPIT_NATIVE_HOST_NAME}" "" "$1"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\${LIPIT_NATIVE_HOST_NAME}" "" "$1"
  WriteRegStr HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\${LIPIT_NATIVE_HOST_NAME}" "" "$1"

  ; Remove obsolete Firefox registrations left by development builds.
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\${LIPIT_NATIVE_HOST_NAME}"
  DeleteRegKey HKCU "Software\WOW6432Node\Mozilla\NativeMessagingHosts\${LIPIT_NATIVE_HOST_NAME}"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\${LIPIT_NATIVE_HOST_NAME}"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\${LIPIT_NATIVE_HOST_NAME}"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\${LIPIT_NATIVE_HOST_NAME}"
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\${LIPIT_NATIVE_HOST_NAME}"
  DeleteRegKey HKCU "Software\WOW6432Node\Mozilla\NativeMessagingHosts\${LIPIT_NATIVE_HOST_NAME}"
  Delete "$LOCALAPPDATA\Lipit Capture\NativeMessaging\chromium\${LIPIT_NATIVE_HOST_NAME}.json"
  RMDir "$LOCALAPPDATA\Lipit Capture\NativeMessaging\chromium"
  RMDir "$LOCALAPPDATA\Lipit Capture\NativeMessaging"
!macroend
