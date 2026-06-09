#!/usr/bin/env bash
set -euo pipefail

ADB="${ADB:-$(command -v adb || true)}"
if [ -z "$ADB" ]; then
  echo "FAIL: adb not found on PATH" >&2
  exit 1
fi

URL="${QA_PHONE_URL:-https://jobdone-staging.vercel.app}"
SERIAL="${DEV_PHONE_SERIAL:-${ANDROID_SERIAL:-}}"
WAIT_SECONDS="${QA_PHONE_WAIT_SECONDS:-8}"
CDP_PORT="${QA_PHONE_CDP_PORT:-9222}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="${QA_PHONE_EVIDENCE_DIR:-.tmp/dev-phone-qa/$STAMP}"
mkdir -p "$EVIDENCE_DIR"

if [ -z "$SERIAL" ]; then
  mapfile -t DEVICES < <("$ADB" devices | awk 'NR > 1 && $2 == "device" { print $1 }')
  if [ "${#DEVICES[@]}" -eq 1 ]; then
    SERIAL="${DEVICES[0]}"
  elif [ "${#DEVICES[@]}" -eq 0 ]; then
    echo "FAIL: no authorized Android device visible to adb" >&2
    "$ADB" devices >&2
    exit 1
  else
    echo "FAIL: multiple devices visible; set DEV_PHONE_SERIAL" >&2
    "$ADB" devices >&2
    exit 1
  fi
fi

adb_dev() {
  "$ADB" -s "$SERIAL" "$@"
}

echo "Phone QA target: $URL"
echo "Device: $SERIAL"
echo "Evidence: $EVIDENCE_DIR"

adb_dev devices -l > "$EVIDENCE_DIR/adb-devices.txt"
adb_dev shell getprop ro.product.model > "$EVIDENCE_DIR/device-model.txt" || true
adb_dev shell getprop ro.build.version.release > "$EVIDENCE_DIR/android-version.txt" || true

# Keep the dev phone awake while it is plugged in. This is intentionally
# non-destructive and makes repeated phone QA less flaky.
adb_dev shell settings put system screen_off_timeout 2147483647 >/dev/null 2>&1 || true
adb_dev shell settings put global stay_on_while_plugged_in 7 >/dev/null 2>&1 || true
adb_dev shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true

adb_dev shell am start -a android.intent.action.VIEW -d "$URL" > "$EVIDENCE_DIR/am-start.txt"
sleep "$WAIT_SECONDS"

adb_dev shell uiautomator dump /sdcard/jobdone-window.xml > "$EVIDENCE_DIR/uiautomator-dump.txt"
adb_dev pull /sdcard/jobdone-window.xml "$EVIDENCE_DIR/window.xml" >/dev/null
adb_dev shell rm /sdcard/jobdone-window.xml >/dev/null 2>&1 || true

python3 - "$EVIDENCE_DIR/window.xml" "$EVIDENCE_DIR/window-text.txt" <<'PY'
import sys
import xml.etree.ElementTree as ET

xml_path, text_path = sys.argv[1:3]
root = ET.parse(xml_path).getroot()
seen = []
for node in root.iter("node"):
    for key in ("text", "content-desc"):
        value = (node.attrib.get(key) or "").strip()
        if value and value not in seen:
            seen.append(value)
with open(text_path, "w", encoding="utf-8") as fh:
    fh.write("\n".join(seen))
    fh.write("\n")
PY

if adb_dev forward "tcp:$CDP_PORT" localabstract:chrome_devtools_remote >/dev/null 2>&1; then
  node - "$CDP_PORT" "$URL" "$EVIDENCE_DIR/chrome-text.txt" <<'JS' || true
const [, , port, expectedUrl, outputPath] = process.argv;
const origin = new URL(expectedUrl).origin;
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
const target = targets.find(t => {
  if (t.type !== 'page' || !t.webSocketDebuggerUrl) return false;
  try {
    const url = new URL(t.url);
    return t.url === expectedUrl || url.origin === origin;
  } catch {
    return false;
  }
});

if (!target) {
  await import('node:fs').then(fs => fs.writeFileSync(outputPath, ''));
  process.exit(0);
}

const expression = `
(() => [
  document.title || '',
  document.querySelector('meta[name="jobdone-build"]')?.content
    ? 'build ' + document.querySelector('meta[name="jobdone-build"]').content
    : '',
  document.body?.innerText || ''
].filter(Boolean).join('\\n'))()
`;

const text = await new Promise((resolve, reject) => {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const timeout = setTimeout(() => reject(new Error('Chrome DevTools evaluation timed out')), 5000);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  };
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timeout);
    ws.close();
    resolve(message.result?.result?.value || '');
  };
  ws.onerror = (event) => {
    clearTimeout(timeout);
    reject(new Error(String(event.message || 'Chrome DevTools websocket failed')));
  };
});

await import('node:fs').then(fs => fs.writeFileSync(outputPath, `${target.title || ''}\n${target.url || ''}\n${text}\n`));
JS
fi

TEXT_FILE="$EVIDENCE_DIR/visible-text.txt"
cat "$EVIDENCE_DIR/window-text.txt" > "$TEXT_FILE"
if [ -s "$EVIDENCE_DIR/chrome-text.txt" ]; then
  printf '\n' >> "$TEXT_FILE"
  cat "$EVIDENCE_DIR/chrome-text.txt" >> "$TEXT_FILE"
fi

fail() {
  echo "FAIL: $1" >&2
  echo "Visible text was written to $TEXT_FILE" >&2
  exit 1
}

contains() {
  grep -Fqi -- "$1" "$TEXT_FILE"
}

for forbidden in \
  "This site can't be reached" \
  "This site can’t be reached" \
  "Webpage not available" \
  "ERR_" \
  "Vercel Authentication" \
  "Deployment Protection" \
  "Application error" \
  "404: NOT_FOUND" \
  "401" \
  "403"; do
  if contains "$forbidden"; then
    fail "browser/server error visible: $forbidden"
  fi
done

if [[ "$URL" == *staging* ]]; then
  EXPECTED_DEFAULT="STAGING"
elif [[ "$URL" == *production* || "$URL" == *jobdone.continuumkit.org* ]]; then
  EXPECTED_DEFAULT="PRODUCTION"
else
  EXPECTED_DEFAULT="JobDone"
fi

IFS='|' read -r -a EXPECTED_TEXTS <<< "${QA_PHONE_EXPECT_TEXT:-$EXPECTED_DEFAULT}"
for expected in "${EXPECTED_TEXTS[@]}"; do
  [ -z "$expected" ] && continue
  if ! contains "$expected"; then
    fail "expected visible text missing: $expected"
  fi
done

if [ -n "${QA_EXPECT_BUILD:-}" ] && ! contains "build $QA_EXPECT_BUILD"; then
  fail "expected build missing: build $QA_EXPECT_BUILD"
fi

echo "PASS: dev phone loaded JobDone and visible text matched expectations"
echo "Visible text:"
sed -n '1,80p' "$TEXT_FILE"
