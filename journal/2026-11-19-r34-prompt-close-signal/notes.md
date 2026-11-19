# R34: a signal that iOS's Install prompt closed (website IPA install)

## Question

B90's `watchPrompt` (web/app/signing-client.js) can only catch a Cancel in iOS's itms-services prompt at its 30 s cap
(`PROMPT_CAP`), because on iOS 15.8.8 no focus/blur/visibilitychange/pageshow event fires and `document.hasFocus()`
stays true. Is there any other signal in the page: requestAnimationFrame throttled under the alert, timer drift,
anything else? And do newer iOS versions (17+, 26) fire the events?

## Result: no signal on iOS 15.8.8; the code stays as it is

Nothing in the page changes while the prompt is up or when it is cancelled. With no signal there was nothing to
shorten in `watchPrompt`, so there's no product change. The 30 s cap (plus the focus path, kept in case newer iOS
fires events) stays.

## How I checked (iPhone 7, iOS 15.8.8, Safari)

`probe.html` and `probe-server.py` in this folder. The server serves the page on 127.0.0.1:8394 and appends every
entry the page POSTs to `/log`. The phone reached it through `ssh -R 8394:127.0.0.1:8394 7`. I loaded it with
`tools/ui-7.sh open` and tapped through `ui-7.sh` under the lock. The page logs:

- each second: rAF frames in that second and the largest gap between frames, the largest drift of a 100 ms
  `setInterval`, `document.hasFocus()`, `visibilityState`, `document.activeElement`
- events: focus, blur, pageshow, pagehide, resize, pointercancel, touchcancel (window, capture), visibilitychange,
  focusin/focusout (document), and `animationiteration` of a CSS animation that runs forever
- the Open prompt button focuses itself, then sets `location.href` to
  `itms-services://?action=download-manifest&url=https://ifizbox.com/sign/up/<48 hex>/manifest.plist?bundleid=com.ryha.ifizbox.r34probe&…`.
  The live Worker answers that from the query, so the real prompt shows ("ifizbox.com" would like to install
  "R34Probe").

The run: I tapped Open prompt and the prompt showed. I took two screenshots about 10 s apart, with the page still
drawing under the dimmed alert, then tapped Cancel. Over the ~35 s after the link opened:

- rAF: 59 to 61 frames every second, largest gap 19 to 37 ms, with the prompt up, after Cancel and before the
  link opened alike. It isn't throttled.
- Timer drift: 1 to 5 ms mostly, with 10 to 24 ms spikes scattered through the whole run (before the prompt as
  well), so no step that marks the prompt.
- The CSS animation's `animationiteration` kept coming every second.
- `hasFocus` true, `visibilityState` visible, `activeElement` the button, the whole time. Apart from the focus/focusin
  from my own `.focus()` call at the tap, no event fired at all.
- The Worker's status for that token afterwards: `{"manifest":true,"asked":false,"started":false,"finished":false}`.
  iOS fetched the manifest for the prompt and sent nothing on Cancel, so the server has no signal either.

So on iOS 15 the alert is drawn by another process, over a page that keeps running at full rate. What happens in the
page says nothing about it.

## What failed along the way

- The first probe used a 32-hex token. The Worker only routes 48-hex tokens (`/sign/up/([0-9a-f]{48})/…`), so the
  manifest 404'd and no prompt showed. Fixed to 24 random bytes.
- Re-opening the probe URL with `uiopen` opened a second Safari tab, and the first tab went hidden (its entries
  read `vis: hidden`, 0 frames, timers throttled to about 1 s). I read only the visible tab's entries. Both probe
  tabs are still open in Safari on the 7, which does no harm.
- I had not kept `$!` for the server and the tunnel, which I started as background commands. I found their pids by
  the listening port (`ss -ltnp sport = :8394`) and their parent shells, then killed those two pids.

## Follow-up

Filed R36 (`later`) for a person: run this same probe on an iOS 17+/26 iPhone. That phone (the iPhone 15) is the
user's daily phone and read-only for agents.

## Not verified

- iOS 17+ and iOS 26: the only newer iPhone here is the iPhone 15, the user's daily phone. Agents may only read
  from it (a paired lockdown probe), and can't open a page or tap a prompt on it. The probe is saved here for a
  person to run (follow-up filed).
- A home-screen web app on iOS 15: B90 already found no events there. I didn't repeat the rAF/timer probe in that
  mode, because the alert is the same SpringBoard prompt over the same WebKit page, and Safari showed no change at
  all.
- Tapping Install instead of Cancel: not needed for the question. B90 covers Install through the Worker's `asked` mark.
