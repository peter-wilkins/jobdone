# Dev Phone QA

Use this before asking Peter for manual phone testing. It is a small text-first
regression gate, not a permanent mobile automation framework.

## Run

Default target is staging:

```bash
npm run qa:phone
```

Production target:

```bash
QA_PHONE_URL=https://jobdone.continuumkit.org npm run qa:phone
```

Expected build check:

```bash
QA_EXPECT_BUILD="$(git rev-parse --short HEAD)" npm run qa:phone
```

If more than one phone is attached:

```bash
DEV_PHONE_SERIAL=RF8N6017PKY npm run qa:phone
```

## What It Checks

- ADB can see one authorised Android device.
- The dev phone is kept awake while plugged in.
- The target JobDone URL opens on the real phone.
- Android UI text is dumped with `uiautomator`.
- Obvious browser/server failures are absent.
- The expected environment banner/build text is visible.

Evidence is written under `.tmp/dev-phone-qa/` and should stay local.

## Human Testing Boundary

Run this before contacting Peter for manual testing. If it fails, fix the app or
deployment first. Ask Peter only for checks that need a human judgement or real
account interaction, such as:

- subjective UX feel
- email inbox behaviour
- PWA install prompts
- real camera/microphone quality
- account or destructive device actions

