# Native Shell WebView Research

Status: research note, not a decision.

## Term

Use **Native Shell** for the app binary: a small Android app that owns platform
permissions, install, share targets, camera/contact/location bridges, and a
WebView host.

Use **Web Runtime** for the JobDone JavaScript/CSS/asset bundle loaded inside
the Native Shell.

Avoid "PWA shell" because the point is to stop depending on browser/PWA install
behaviour. Avoid "native app" when the UI is still mostly the web runtime.

## Existing Sibling Pattern

Field Relay already has the shape:

- Kotlin `CommandWebActivity`
- app-private cached WebView runtime
- bundled fallback assets
- runtime refresh from GitHub
- native bridge exposed as `FieldRelayNative`

Commandbook already has the vocabulary:

- platform runtime adapter
- runtime descriptor
- capability groups
- small host interface around portable logic

Useful lesson: the pattern works for a dogfood prototype, but JobDone carries
user Entries, Contacts, Locations, Photos, Team data, and auth sessions, so it
needs tighter security than the current Field Relay proof.

## Android Policy Read

Android WebView apps are normal Android apps. Google documents WebView as a
supported way to display web applications inside an Activity:

- https://developer.android.com/develop/ui/views/layout/webapps/webview

Google Play policy is not a blanket ban on runtime JavaScript. The current
Device and Network Abuse wording says interpreted languages loaded at runtime
must not allow Play-policy violations, and it bans downloaded executable code
such as DEX/JAR/native code from outside Google Play:

- https://support.google.com/googleplay/android-developer/answer/16559646

The sharp Android risk is a WebView with a JavaScript bridge loading untrusted
or unverified content. Play policy explicitly calls out WebViews with added
JavaScript interfaces that load untrusted web content or unverified URLs.

Google's remediation guidance says a bridge-enabled WebView with sensitive
functionality must only load strictly scoped URLs/content owned by the app
developer, and must not expose sensitive functionality to arbitrary JavaScript:

- https://support.google.com/googleplay/android-developer/answer/10768383

## Prior Art

This pattern already exists in several forms:

- Capacitor/Cordova/Ionic: native shell plus WebView plus bridge.
- React Native with OTA update systems such as CodePush or Expo Updates:
  JavaScript bundle can update without a native-store release, but native
  module compatibility must be managed carefully.
- Field Relay/Commandbook: our own small version of cached dynamic JavaScript
  inside Android.

Capacitor is the closest off-the-shelf shape if we want less custom Android
plumbing. It has production-focused WebView config, plugin boundaries, and
Android WebView version handling:

- https://capacitorjs.com/docs/config

## Why Not Everybody Does This

- Store policy and review ambiguity, especially on iOS.
- Security: a WebView bridge can turn XSS into native-app privilege escalation.
- Native/web version skew: downloaded JS can call native bridge APIs the
  installed shell does not support.
- Offline/update complexity: you need a bundled fallback, cache integrity,
  rollback, and staged rollout.
- UX/performance: WebView apps can feel less native if keyboard, file picker,
  camera, push, and back-stack behaviour are not handled carefully.
- Debuggability: you now debug both Android lifecycle and web runtime state.

## JobDone-Specific Friction

Likely good fit:

- Existing React UI can mostly run unchanged.
- IndexedDB/local-first architecture maps well to WebView storage.
- PWA install/share friction becomes a normal APK install/share-target problem.
- Android photo/contact/location permissions can be owned by Kotlin and exposed
  as explicit bridge capabilities.
- Dev-phone QA can use Chrome WebView remote debugging.

Tricky parts:

- Auth callbacks must land back in the Native Shell/WebView, not the browser.
- Existing service-worker/PWA update checks need replacing or bypassing.
- WebView storage persistence and backup/restore need explicit testing.
- File/photo picker permission bugs may improve, but only if native owns the
  picker and passes stable app-private file references/blobs to the web runtime.
- Share target and capture lifecycle must survive process death.
- If future encrypted Local Replica keys live in the Web Runtime, the native
  bridge must not accidentally expose them.
- Debug red screens and feedback bundles must distinguish native-shell version
  from web-runtime version.

## Security Shape

Minimum viable safe shape:

- Load only HTTPS content from JobDone-owned origins, or signed cached bundles
  from app-private storage.
- Do not enable `allowUniversalAccessFromFileURLs`.
- Do not enable mixed content in production.
- Do not allow arbitrary navigation inside the privileged WebView.
- Open external links in the system browser/custom tab.
- Use a tiny, allowlisted native bridge. No generic fetch bridge for production
  JobDone data unless the bridge enforces origin, method, URL, and payload
  policy.
- Version every bridge capability; the web runtime declares required shell
  capabilities before boot.
- Sign/hash Web Runtime bundles and keep last-known-good rollback.
- Enable WebView remote debugging only for debug/internal builds.

## Recommended First Slice

Build a Native Shell spike, not a product rewrite:

1. Kotlin Android app opens a WebView to the deployed staging frontend.
2. It sets a JobDone shell user-agent and exposes no native bridge.
3. Prove login, IndexedDB persistence, capture text, team page navigation, and
   feedback report.
4. Add one native bridge capability only after the no-bridge WebView works:
   app version/runtime diagnostics.
5. Only then choose between remote URL loading and signed cached Web Runtime
   bundles.

