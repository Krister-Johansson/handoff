# Voice: speech to text and text to speech in the dashboard

## Context

The user wants to drive handoff by voice in Google Chrome: say what to do, dictate answers and notes, and hear replies and notifications without looking at the screen. The dashboard is a Next.js 16 App Router app served on 127.0.0.1 with no login. It has pages for projects, runs (steps, graph, events), the inbox, notifications, the library, the graph editor, the code review page, the Try it page and permission request cards.

A separate plan, `docs/plans/assistant-webmcp.md`, covers an assistant inside the dashboard whose tools are exposed through WebMCP. That file does not exist in this worktree at the time of writing, so this plan states its assumptions about the assistant explicitly (see "The assistant seam"). Voice is a layer over that assistant: transcribed speech becomes a user message to the assistant, and the assistant's replies can be spoken. A small set of direct voice commands bypass the model for speed and determinism.

Prior art: the user's todoOverKill backlog has F41 (speech to text, microphone toggle) and F42 (text to speech, read replies aloud) on top of an assistant panel (F38 to F40). What carries over: `useSpeechRecognition` and `useSpeechSynthesis` hooks, a microphone toggle in the top bar with `aria-pressed`, Escape stops, interim text rendered into the composer, speaking off by default, a Stop button, hidden controls when unsupported, and tests that assert "nothing is sent without the setting" and "nothing speaks on page load". Where handoff differs: handoff has no assistant yet and no chat panel, it already has a notification pipeline (polling, sonner toasts, desktop notifications, a sound) with preferences in localStorage, its review pages already have single-key shortcuts (`[` and `]`), and the actions a voice command must reach (approve, send back, works, doesn't work, allow once, deny) are server actions, not API routes. handoff also runs only on 127.0.0.1 in Chrome, so Chrome's on-device recognition is the primary path, which the todoOverKill issues did not consider.

## Goals

- Start listening with a key or a button, see what was heard while speaking, and have the final transcript either run a direct command or go to the assistant.
- Hear assistant replies, notifications and long page content (a run summary, a review) read aloud, and stop them with one key.
- Answer the Try it page, the code review page and permission requests by voice.
- Keep audio on the machine by default. Server-based recognition and network voices are opt-in per browser.
- Keep keyboard and screen reader use intact; voice adds a channel, it never becomes the only one.
- Test every behaviour in Vitest with fakes at the browser API boundary.

## Non-goals

- A wake word or an always-open microphone.
- Speech in browsers other than Chrome. Other browsers hide the controls.
- Cloud speech services, API keys in the browser, or any audio leaving the machine without an explicit setting.
- Voice editing of the graph in React Flow (drag, connect). The assistant's tools may edit graphs later; voice only sends text to it.
- Building the assistant itself. That is `docs/plans/assistant-webmcp.md`.
- Spoken output in a language other than the recognition language.

## Verified facts

Checked on 2026-10-01 against the pages named. Re-check before coding against any of them.

Chrome speech recognition

- Chrome 139 (stable 2025-08-05) added on-device speech recognition to the Web Speech API: a page can ask whether a language is available locally, ask Chrome to install it, and require local processing so that audio and transcripts stay on the machine. Source: https://developer.chrome.com/blog/new-in-chrome-139
- `SpeechRecognition.processLocally` is a boolean, default `false`. `true` means recognition must run on the device; `false` lets the browser choose local or remote. Source: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally
- `SpeechRecognition.available({ langs: string[], processLocally?: boolean, quality?: "command" | "dictation" | "conversation" })` returns a promise of `"available"`, `"downloading"`, `"downloadable"` or `"unavailable"`. `"downloading"` and `"downloadable"` only occur with `processLocally: true`. Source: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static
- `SpeechRecognition.install({ langs, quality? })` returns a promise of a boolean: `true` when every language pack installed or was already installed, `false` on failure or unsupported language. Throws `InvalidStateError` when the document is not fully active and `SyntaxError` for a bad BCP 47 tag. Access is governed by the `on-device-speech-recognition` Permissions Policy, whose default allowlist is `self`, so a same-origin page needs no header. Sources: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/install_static and https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API
- Without `processLocally`, Chrome's recognition is server-based: audio goes to a web service and recognition does not work offline. Source: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition (browser compatibility notes) and the "Using the Web Speech API" guide above.
- On-device recognition is available on Windows, macOS and Linux. ChromeOS, Android and Android WebView do not support it. Source: Intent to Ship "Web Speech API: On-Device Recognition Quality", 2026-05-06, https://groups.google.com/a/chromium.org/g/blink-dev/c/P8P-x7AnC6I
- Chrome 142 (stable 2025-10-28) added contextual biasing: `recognition.phrases`, an `ObservableArray` of `SpeechRecognitionPhrase(phrase, boost)`. The MDN example sets `processLocally = true` alongside it. The error code `phrases-not-supported` exists for models that cannot bias. Sources: https://developer.chrome.com/release-notes/142 and https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/phrases
- Chrome 150 (stable 2026-06-30) added the `quality` option (`command`, `dictation`, `conversation`) to `available()` and `install()` so a page can ask whether the device can handle more than short commands. Source: https://developer.chrome.com/release-notes/150
- Chrome 151 (stable 2026-07-28) added `SpeechRecognition.unspokenPunctuation`, a boolean that lets the engine insert punctuation from pauses and prosody. Source: https://developer.chrome.com/release-notes/151
- `SpeechRecognitionErrorEvent.error` values: `aborted`, `audio-capture`, `bad-grammar`, `language-not-supported`, `network`, `no-speech`, `not-allowed`, `phrases-not-supported`, `service-not-allowed`. Source: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionErrorEvent/error
- Instance surface: `lang`, `continuous`, `interimResults`, `maxAlternatives`, `phrases`, `processLocally`, `unspokenPunctuation`; methods `start()`, `stop()`, `abort()`; events `start`, `audiostart`, `soundstart`, `speechstart`, `result`, `speechend`, `soundend`, `audioend`, `nomatch`, `error`, `end`. Source: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- `start()` also accepts a `MediaStreamTrack` (Intent to Ship 2024-12-18, target Chrome 133, desktop first). Not needed here; the microphone default is enough. Source: https://groups.google.com/a/chromium.org/g/blink-dev/c/4ibjEVQ-i0s/m/2OsaIhf3BAAJ
- `http://127.0.0.1` and `http://localhost` are potentially trustworthy origins, so microphone access and the secure-context requirements apply to the dashboard as served today. Source: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts

Chrome speech synthesis

- `speechSynthesis` (`speak`, `cancel`, `pause`, `resume`, `getVoices`, `speaking`, `pending`, `paused`, event `voiceschanged`) is Baseline widely available since September 2018. Source: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis
- `SpeechSynthesisVoice.localService` is `true` for a voice supplied by a local synthesizer and `false` for a remote one. Remote voices may add latency and bandwidth. Source: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService
- Chrome's extension TTS reference describes the same split: Chrome uses the operating system's synthesizer on Windows (SAPI 5), macOS and ChromeOS, and a voice flagged `remote` is "a remote network resource". Source: https://developer.chrome.com/docs/extensions/reference/api/tts

Chrome built-in AI

- The built-in AI API list has no speech-to-text or text-to-speech API. The Prompt API is stable for extensions from Chrome 138 and listed for the web from Chrome 148; Translator, Language Detector and Summarizer are stable from Chrome 138. Source: https://developer.chrome.com/docs/ai/built-in-apis (page dated 2025-09-12)
- The Prompt API accepts audio input (`AudioBuffer`, `ArrayBuffer`, `Blob`), but audio input requires a GPU with more than 4 GB of VRAM, and the model needs 22 GB of free disk. Source: https://developer.chrome.com/docs/ai/prompt-api (page dated 2026-08-26)

WebMCP (for the assistant seam only)

- Chrome runs a WebMCP origin trial from Chrome 149. Local testing uses `chrome://flags/#enable-webmcp-testing` without a trial token. Source: https://developer.chrome.com/docs/ai/webmcp (page dated 2026-08-07)

Testing

- Vitest `vi.stubGlobal(name, value)` sets a global that jsdom lacks (reachable as `window.X` too); `vi.unstubAllGlobals()` restores, and `test.unstubGlobals: true` does so before every test. Source: Context7 `/vitest-dev/vitest`, docs `guide/mocking/globals.md` and `api/vi.md`.
- `apps/web` tests run in jsdom 30.1.1 with `@testing-library/react` 16.3.3 and `@testing-library/jest-dom` 7.0.1 (`apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts`). `@testing-library/user-event` is not installed; existing tests use `fireEvent` and `act`.

Codebase (read in `/Users/krister/Project/handoff-review`)

- Layout: `apps/web/src/app/layout.tsx` nests `ThemeProvider`, `TooltipProvider`, `SiteHeader`, the page and `<Toaster position="bottom-right" closeButton />`. `components/site-header.tsx` is a server component; its right cluster holds `NotificationBell` (client), a Settings link and `WorkerStatus`. There is no sidebar.
- Notifications: `packages/core/src/graph/notify.ts` defines `NotifyKindSchema = z.enum(["started","finished","failed","input","permission","ready","merged"])` with per-node defaults `started:false, finished:true, failed:true, input:true, permission:true, ready:true, merged:false`. The engine writes rows in the `notifications` table (`docs/plans/notifications.md`; when this plan was written they were `events` rows with `type: "notify"`). `components/notification-bell.tsx` polls `GET /api/notifications` every 15 s, toasts new items through sonner, and calls `notify(items)` from `lib/notify.ts`, which plays a ping and creates a desktop `Notification` according to `NotifyPrefs { desktop, sound }` stored in localStorage under `handoff.notify` (`lib/attention.ts`, `readPrefs`, `writePrefs`). The settings UI is `components/settings/notification-settings.tsx`, loaded with `ssr: false`. Tabs are listed in `lib/settings-tab.ts` (`SETTINGS_TABS = ["appearance","notifications","agents","worker"]`) and `components/settings/settings-nav.tsx`.
- Code review: `components/review/code-review.tsx` (`CodeReview`) with "Previous file" and "Next file" buttons, `[` and `]` keys through a window `keydown` listener that skips typing targets and modifier keys, a "Submit review" popover with `SubmitReview` (`components/review/submit-review.tsx`, `ReviewOption = "changes" | "approve" | "fix"`, radio group "Review result", textarea `#review-note`, button "Send review"). Submitting calls the server action `answerReviewAction({ questionId, runId, option, note, comments })` in `app/inbox/actions.ts`.
- Try it: `components/review/try-review.tsx` (`TryReview`) with per-criterion "Works" checkbox (`#try-works-{i}`), "Doesn't work" button (`aria-pressed`), note textarea `#try-note-{i}`, "Previous criterion" and "Next criterion" buttons and the same `[` and `]` keys, "Start the app again" (`restartTryItAction`), and a Submit popover with "Send back to {from}" (option `changes`, failing criteria as comments) and "Approve" (enabled only when every criterion works).
- Permission cards: `components/runs/permission-card.tsx` (`PermissionCard`) with "Allow once", "Always allow {rule}" and "Deny" (note `#permission-note-{id}`), all through `answerPermissionAction`.
- Run page: `app/projects/[projectId]/runs/[runId]/page.tsx` renders `RunLive` with tabs `steps`, `graph`, `events` and alert cards above them. The event stream uses `EventSource` against `GET /api/runs/[runId]/events`.
- Feature detection patterns already in use: `hasNotifications = () => typeof Notification !== "undefined"` (`lib/notify.ts`), `new AudioContext()` in `try/catch` (`lib/ping.ts`), localStorage reads wrapped in `try/catch`.
- Test patterns already in use: `vi.stubGlobal("Notification", FakeNotification)` with `afterEach(() => vi.unstubAllGlobals())` in `notification-bell.test.tsx`; a `FakeEventSource` with an `emit()` helper in `event-stream.test.tsx`; server actions mocked with `vi.hoisted` plus `vi.mock("@/app/inbox/actions", ...)`.
- No assistant, chat, WebMCP, `SpeechRecognition` or `speechSynthesis` code exists in `apps/web` or `packages`.
- Versions: next 16.3.7, react 19.2.8, sonner 2.0.8, lucide-react 1.48.0, radix-ui 1.6.7, next-themes 0.4.6, zod 4.6.5, vitest 5.0.2, typescript 5.9.3.

## Unverified

Treat each as unknown until checked on the machine or on a primary page.

- The current Chrome stable version number. A search result named 153.x for late September 2026; no primary page confirmed it. The manual script records `chrome://version`.
- Whether Chrome exposes an unprefixed `window.SpeechRecognition`. caniuse reports prefixed support (`webkitSpeechRecognition`). The feature detection reads both names.
- Which languages have on-device packs. A Chrome team thread from August 2025 was reported to list seventeen languages (including en-US, de-DE, fr-FR, es-ES) and not Swedish; the thread could not be read in full. `available()` is the source of truth at runtime.
- Chromium issue 444393111, titled "speechRecognition.available({ processLocally: true, langs: ['en-US'] }) broken in macOS". The tracker needs a sign-in; status unknown. The user's machine is macOS, so the manual script checks `available()` first.
- Whether `install()` needs a user activation or shows a Chrome prompt. The plan calls it from a click handler regardless.
- Chrome ending a `continuous` session after roughly a minute of silence and firing `end`. Widely reported; not on a primary page. The hook restarts on `end` only in dictation mode and only while the user has not stopped.
- `speechSynthesis` cutting off long utterances in Chrome (Chromium issue 41346274 exists; status not read). The speaker chunks text by sentence regardless, because stop granularity needs it anyway.
- Whether the "Google ..." voices Chrome lists on desktop are network voices (`localService === false`) and whether the text is sent to Google. Widely reported, not documented on a primary page. The speaker filters on `localService` by default and the manual script records the voice list.
- Whether `phrases` works with server-based recognition. The plan only sets `phrases` when `processLocally` is true.
- Safari's current `webkitSpeechRecognition` behaviour. Out of scope; controls hide when the constructor is missing.
- Whether Prompt API audio input is available to web pages in stable Chrome, and its latency. Not used; recorded for the alternatives discussion.

## Decisions

### 1. Speech to text: Web Speech API with on-device recognition required by default

Use `SpeechRecognition` (falling back to `webkitSpeechRecognition`) with `processLocally = true`. Before the first start, call `SpeechRecognition.available({ langs: [lang], processLocally: true })`. On `"available"`, start. On `"downloadable"` or `"downloading"`, the microphone button shows "Install English (US) for offline use" and calls `install()` from the click. On `"unavailable"`, the button explains that the language has no on-device pack and offers server-based recognition as a switch in Settings, off by default. Only when that switch is on does the hook create a recognizer with `processLocally = false`.

Where audio goes:

- On-device recognition: audio and transcripts stay on the machine (Chrome 139 blog, explainer).
- Server-based recognition: Chrome sends audio to Google's speech service (MDN). Opt-in only, with the setting's label saying so.

Alternatives considered:

- Chrome built-in AI. No built-in API does speech to text. The Prompt API takes audio, but it needs a GPU with more than 4 GB of VRAM and 22 GB of disk, returns text only after the whole clip, gives no interim results, and its web availability is a moving target. Rejected.
- Whisper in the browser (transformers.js or whisper.cpp through WebAssembly or WebGPU). Audio stays local, which is good, and Swedish would work. It needs a model download of tens to hundreds of megabytes, a worker, WebGPU for acceptable latency, and our own interim-result logic. The dashboard is a personal tool on one machine, so this is feasible, but it is a second recognizer to maintain. Kept as the fallback plan if on-device Chrome packs never cover the user's language (open question 1). Rejected for v1.
- Cloud STT (Deepgram, Google, OpenAI). Audio leaves the machine and the browser would need a credential. `CLAUDE.md` keeps secrets out of the browser and the database. Rejected.
- Chrome's server-based recognition as the default (what the todoOverKill issues assumed). Simpler, but audio leaves the machine for every utterance. Rejected as default, kept as opt-in.

Settings: `lang` (default `en-US`), `allowServerRecognition` (default false). When Chrome 150 or later is detected through the presence of the `quality` option, `available()` is called with `quality: "dictation"`; otherwise without it.

### 2. Text to speech: speechSynthesis with local voices by default

Use `speechSynthesis` with a `SpeechSynthesisUtterance` per sentence. Voice choice: the user's chosen `voiceURI` if still present, else the first voice whose `lang` matches the recognition language and `localService === true`, else any local voice, else nothing is spoken and the transcript strip says "No local voice for en-US". A setting `allowRemoteVoices` (default false) admits voices with `localService === false`.

Where text goes: a local voice synthesizes on the machine. A remote voice sends the text to its vendor. With `allowRemoteVoices` off, the dashboard never speaks through a remote voice.

Alternatives considered:

- Cloud TTS. Text leaves the machine and needs a credential. Rejected.
- A neural voice in the browser (Piper or Kokoro through WebAssembly or WebGPU). Better voice quality, audio local, but a large download and another audio pipeline. Not needed for notifications and short replies. Rejected for v1; it slots behind the `Speaker` interface if wanted later.
- Chrome built-in AI. No TTS API. Rejected.

### 3. Interaction design

Push to talk, not a wake word and not always listening. A wake word needs an always-open microphone and a local keyword model that the browser does not provide. Always listening keeps Chrome's microphone indicator on, picks up the dashboard's own speech and the room, and (per the unverified note) Chrome ends sessions after silence anyway.

Two listening modes, chosen by where focus is when listening starts:

- Command mode (focus is not in a text field): `continuous = false`, `interimResults = true`. One utterance. On the final result, the router runs a direct command or sends the text to the assistant. The session ends by itself.
- Dictation mode (focus is in a textarea or input, for example the assistant composer, a review note or a Try it note): `continuous = true`, `interimResults = true`, `unspokenPunctuation = true` when the property exists. Final results append to the field at the caret; interim text shows in the transcript strip, not in the field. Listening continues until the user stops it. If Chrome ends the session on its own, the hook restarts it once per `end` while the state is still `listening`.

Controls:

- A microphone button in the header next to `NotificationBell`, a 44 px target with `aria-pressed`, label "Listen" when idle and "Stop listening" when active. Hidden when unsupported.
- A key: `V` toggles listening when focus is not in a typing target, following the `isTyping` check the review pages already use for `[` and `]`. `Escape` stops listening (abort, interim discarded), stops speaking, and does nothing else when voice is inactive, so Radix dialogs keep their own Escape behaviour.
- A hold-to-talk variant (hold the button or the key) is not in v1; open question 2.

How the person knows it is listening: the header button changes state and pulses (no pulse under `prefers-reduced-motion`); a transcript strip appears under the header with the status ("Listening", "Heard: ...", "Sent to assistant", "Ran: next criterion", "Blocked: microphone permission denied") and the interim text; a visually hidden `aria-live="polite"` region announces "Listening" and "Stopped". Chrome's own tab microphone indicator is the fourth signal.

Cancelling: `Escape` or the button. `abort()` is used so no late final result arrives after the user cancelled. A stop while speech is playing cancels speech first; a second stop cancels listening.

Reading long content: each page that has something worth reading registers a reader through `useReadAloud({ title, text })` (the run page registers the run's summary and the latest failure, the review pages register the review markdown or the plan text, the Try it page registers the acceptance criteria). "Read this" (spoken or the "Read aloud" button on the page) speaks it sentence by sentence; code blocks become "code block skipped". The transcript strip shows "Reading: sentence 3 of 40" and a Stop button; `Escape` stops.

Never listen while speaking: starting speech aborts listening, and listening cannot start until speech ends, so the microphone does not transcribe the dashboard's own voice. This is a design rule, not a browser feature.

Spoken notifications: `lib/notify.ts` gains a third preference, `speak`. When on, a new notification item is spoken as "{title}. {body}" through the speaker with priority `notification`, which queues behind a reply in progress but ahead of a long read. Which kinds: `input`, `permission`, `ready` and `failed` by default; `finished` and `merged` only when "Also finished and merged runs" is on; `started` never (the bell already excludes it from `notify()`). The per-node graph `notify` settings stay the first filter, since an item that never reaches the bell is never spoken. The last spoken notification's `href` becomes the target of the direct command "open it" for 60 seconds.

Spoken assistant replies: a setting "Speak replies" (default off, as F42). When on, each completed assistant reply is spoken. Streaming replies are not spoken token by token in v1 (open question 4). Text stays on screen.

Settings, all per browser in localStorage under `handoff.voice`:

```
{ lang: "en-US", allowServerRecognition: false,
  speakReplies: false, speakNotifications: false, speakFinished: false,
  voiceURI: null, rate: 1, allowRemoteVoices: false }
```

Read and written through `readVoicePrefs()` and `writeVoicePrefs()` in `apps/web/src/lib/voice/prefs.ts`, built like `readPrefs` in `lib/attention.ts`. A "Voice" tab joins `SETTINGS_TABS` and `settings-nav.tsx`.

### 4. Voice on the Try it page, the code review page and permission cards

Superseded on 2026-10-02 by decision 8: every utterance goes to the assistant, so there are no direct commands, no command registry and no page commands. The text below is kept as the record of the earlier design.

Direct commands bypass the model when the normalized transcript matches a registered phrase. Everything else goes to the assistant.

Direct commands are fast, deterministic and cheap; they do not need a model to map "next" to the "Next criterion" button. They bypass the model only when the phrase is unambiguous on the current page, the effect is visible and reversible, or the command asks for confirmation.

Global commands (registered by `VoiceProvider`): "go to inbox", "go to projects", "go to library", "go to settings", "go to notifications", "go back", "stop", "read this", "open it" (last spoken notification), "what's new" (speaks the unread notification count and the first three titles), "help" (speaks the commands available on this page).

Try it page (`useVoiceCommands` inside `TryReview`): "works" (ticks the current criterion, same effect as the checkbox: collapses and moves on), "doesn't work" or "does not work" (presses the "Doesn't work" button for the current criterion; any text after the phrase, such as "doesn't work, the list is empty after a reload", becomes the note `#try-note-{i}`), "next" and "previous" (criterion), "start the app again", "approve" and "send back". "approve" and "send back" are confirmed: the strip shows "Approve this Try it? Say yes or press Enter", the speaker says the same when speaking is on, and "yes" or Enter runs the existing submit path; anything else or 15 seconds cancels. "Approve" is refused with "2 criteria are not ticked yet" when the page would disable the button.

Code review page (`useVoiceCommands` inside `CodeReview`): "next file", "previous file", "next" and "previous" as synonyms, "whole file" and "changes", "collapse all", "expand all", "approve", "request changes", "approve after fixes", each submit confirmed as above, with the spoken remainder after "request changes" becoming the overall comment `#review-note`. Line comments stay keyboard and mouse only; dictating into an open comment box uses dictation mode.

Permission cards (`useVoiceCommands` inside `PermissionCard`): "allow once", "deny" (remainder becomes the note), "always allow" (confirmed, since it writes a new graph version). When more than one card is on the page, the commands apply to the first unanswered card, and the strip names it.

Everything else, for example "why did the tester fail", "start a run for issue 42", "summarise this review", "approve and merge when CI is green", goes to the assistant as a message. The assistant's own tools decide what happens, with the assistant's approval prompts for destructive tools.

Matching: `matchCommand(transcript, registry)` is pure. It lowercases, strips punctuation, collapses whitespace, then tries exact phrase matches and prefix matches for commands flagged `takesRemainder`. Ties go to the most specific (longest) phrase, page commands beat global ones. No fuzzy matching in v1; "doesn't work" and "does not work" are both registered because Chrome produces both.

Contextual biasing: when `processLocally` is on and `phrases` exists, the hook sets `recognition.phrases` from the registered command phrases (boost 2) plus project names and node keys visible on the page (boost 1), so "approve", "deny" and "planner" are recognised reliably. Errors `phrases-not-supported` clear the list and continue.

### 5. Accessibility

- Keyboard parity: every voice action has a key or a button (`V`, `Escape`, the header button, "Read aloud" buttons, Enter to confirm). Every page action a voice command reaches already has a button; voice calls the same handlers.
- Screen readers: the dashboard cannot detect one. Speaking is off by default so a VoiceOver user is not read to twice. The live region announces listening state only, never transcripts (they are visible text) and never spoken replies (they are on screen). `speechSynthesis` and VoiceOver can talk over each other; the Voice settings tab says so.
- Focus: starting or stopping listening does not move focus. A navigation command moves focus to the page's `h1` after the route change, the pattern F40 used, and the strip says where it went. A confirmed submit follows the existing redirect.
- Visible transcripts: the strip shows interim and final text, the matched command or "Sent to assistant", and errors in words (`not-allowed` becomes "Chrome blocked the microphone. Allow it in the site settings."). The strip is a landmark `role="status"` region that can be collapsed but is on by default.
- Reduced motion: no pulse under `prefers-reduced-motion: reduce`; the state change stays visible through the icon and label.
- Contrast and target size follow the existing shadcn components; the button is the same `Button` the bell uses, sized to 44 px.

### 6. Browser support

Chrome first. Feature detection runs once in `VoiceProvider`:

```
const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
const synth = "speechSynthesis" in window ? window.speechSynthesis : undefined;
```

- No `Recognition`: the header button and the `V` key are absent, the Voice tab shows "Speech recognition is not available in this browser. Chrome on Windows, macOS or Linux supports it." Speaking still works where `synth` exists, since speech synthesis is Baseline.
- `Recognition` present but `available` missing (older Chrome or another Chromium browser): on-device cannot be checked, so the button stays hidden unless `allowServerRecognition` is on, and the tab explains why.
- No `synth`: speaking settings are disabled with a note; listening still works.
- Microphone permission denied (`not-allowed`): the strip explains and the button stays enabled so the user can retry after changing the site setting.
- Nothing renders on the server: the voice components load with `ssr: false` like `notification-settings-loader.tsx`, so hydration never sees a different tree.

### 7. Testing

Seam: the browser speech APIs, faked at the boundary with `vi.stubGlobal`, exactly as `Notification` and `EventSource` are faked today. No test spawns real audio.

Fakes in `apps/web/src/lib/voice/testing/`:

- `FakeSpeechRecognition`: a class recording `start`, `stop`, `abort` calls and the property values set on it (`lang`, `continuous`, `interimResults`, `processLocally`, `phrases`), with helpers `emitInterim(text)`, `emitFinal(text)`, `emitError(code)`, `emitEnd()`. Static `available` and `install` are `vi.fn()` with configurable results. Installed with `vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition)`; a second test installs it only as `webkitSpeechRecognition`.
- `FakeSpeechSynthesis`: records `speak(utterance)` calls, exposes `getVoices()` from a configurable list (`localService` true and false, several `lang`s), `cancel()`, `speaking`, and helpers `finishCurrent()` and `errorCurrent()` that fire the utterance's `end` or `error` events, plus `fireVoicesChanged()`.
- `FakeAssistant`: implements the assistant seam below with `send: vi.fn()` and a `reply(text)` helper.

Pure units get plain unit tests: `matchCommand`, `splitSentences`, `pickVoice`, `readVoicePrefs`. Hooks and components are tested through behaviour with `render`, `fireEvent.keyDown`/`keyUp` and `act`, as the existing tests do. Nothing is asserted through snapshots.

Tests that guard the privacy decisions permanently: "the recognizer is created with processLocally true unless server recognition is allowed", "no utterance uses a remote voice unless remote voices are allowed", "nothing is spoken on page load", "nothing is sent to the assistant while listening is interim".

Manual verification covers what jsdom cannot: real microphone permission, pack installation, the voice list, Chrome ending sessions, and audio echo. See "Verification".

### 8. The voice bubble (decided 2026-10-02)

Voice works without the assistant panel open. The user chose each of these:

- `V` (outside text fields) opens a small bubble at the bottom centre of the page and starts listening for one utterance. The bubble shows the interim text while the person speaks.
- Everything said goes to the assistant as a message with source `voice`, in the conversation the panel has open. There is no command router: navigation, reading and actions go through the assistant's tools, including its UI tools.
- While the agent works, the bubble shows "Thinking" and nothing else: no tool rows and no tool names (#295). When the reply is done, the bubble shows its text and speaks it with the local voice. Stop or `Escape` silences it; `Escape` again closes the bubble. "Open in panel" opens the full conversation. When the reply ends in a question and was spoken to the end, the bubble listens once more ("Listening for your answer"), and the answer goes to the assistant like any other utterance.
- A tool that asks first appears in the bubble as a confirmation card (#295): its title is a question ("Approve the try it?", "Cancel run 7f3a1b2c?"), with Confirm and Cancel and no note field. The speaker reads the question and "Say yes or no", then the bubble listens once. "yes" (or "confirm", "go ahead") confirms; "no" (or "cancel", "stop") cancels, and the words after it become the note. Anything else keeps the card open and says "Say yes or no, or use the buttons." The card keeps the assistant's 5 minute limit. Approval cards in the panel keep Approve, Deny and the note field. This replaces the assistant plan's rule that approving needs a click, for the bubble only. Always allow on a permission card stays a click: answer_permission only allows once or denies.
- Before a page tool's card goes up, the turn asks the page whether it would refuse the call (`ui_check`). A refusal, such as Approve on Try it with an unchecked criterion, shows no card; the model gets the page's reason and the reply says why.
- On a phone (below 768 px) the assist button hides while the bubble is open.
- Dictation is unchanged: listening started from a text field dictates into it, and the transcript strip shows it.
- With the assistant unavailable, the bubble says so and sends nothing.

## The assistant seam

Assumed from `docs/plans/assistant-webmcp.md`, which does not exist yet. Voice compiles against this interface and the assistant plan should implement it, or this section changes:

```ts
// apps/web/src/lib/assistant/port.ts (owned by the assistant plan)
export type AssistantPort = {
  available: boolean;                                   // false until the assistant is configured
  send(text: string, opts?: { source: "voice" | "typed" }): Promise<void>;
  status: "idle" | "streaming";
  onReply(cb: (reply: { id: string; text: string; done: boolean }) => void): () => void;
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;  // where dictation lands when the panel is open
};
export const useAssistant: () => AssistantPort;
```

What voice relies on: `send` accepts a plain string; `onReply` delivers each reply at least once with `done: true` and the full text; the composer, if present, is a normal textarea so dictation mode can insert at the caret. What voice does not rely on: tool calls, approvals, WebMCP registration, streaming granularity. Until the assistant lands, `VoiceProvider` ships with a `NullAssistant` (`available: false`) and an unmatched transcript shows "No assistant yet. Commands on this page: ..." in the strip. PR 4 below is the one that needs the real port; everything else merges before it.

## Design

### Files

```
apps/web/src/lib/voice/
  prefs.ts                 VoicePrefs, readVoicePrefs(), writeVoicePrefs(), VOICE_PREFS_KEY = "handoff.voice"
  support.ts               detectVoiceSupport(win): { recognition?: RecognitionCtor; synth?: SpeechSynthesis; onDeviceCheck: boolean }
  recognition.ts           RecognitionPort: createRecognizer(ctor, opts), checkOnDevice(ctor, lang, quality?), installOnDevice(ctor, lang)
  use-speech-input.ts      useSpeechInput({ lang, mode, processLocally, phrases, onInterim, onFinal, onError }) -> { state, start, stop, abort, interim, error }
  speaker.ts               createSpeaker(synth, prefs): { speak(text, { priority, title }), stop(), state, subscribe }; splitSentences(), pickVoice()
  commands.ts              VoiceCommand { phrases, takesRemainder?, confirm?, run(remainder?) }, matchCommand(transcript, registry), normalize()
  registry.ts              CommandRegistry (context value): register(pageId, commands) -> unregister
  use-voice-commands.ts    useVoiceCommands(commands, deps) registers for the lifetime of the component
  use-read-aloud.ts        useReadAloud({ title, text }) registers readable content for "read this"
  global-commands.ts       navigation, stop, read this, open it, what's new, help
  errors.ts                errorMessage(code) -> sentence
  testing/fake-speech-recognition.ts  fake-speech-synthesis.ts  fake-assistant.ts
apps/web/src/components/voice/
  voice-provider.tsx       "use client"; holds prefs, support, speaker, registry, assistant port, listening state; exposes useVoice()
  voice-loader.tsx         dynamic(() => import("./voice-provider"), { ssr: false }) wrapper used in layout.tsx
  voice-button.tsx         header microphone button, aria-pressed, 44 px, pulse, install affordance
  voice-transcript.tsx     the strip: status, interim, matched command, errors, Stop, confirm prompt, "Reading n of m"
  read-aloud-button.tsx    page-level "Read aloud" button bound to useReadAloud content
  voice-hotkeys.tsx        V and Escape window listeners with the isTyping guard
apps/web/src/components/settings/
  voice-settings.tsx       Voice tab: language, server recognition switch, speak replies, speak notifications, also finished and merged, voice picker (local voices first, remote behind a switch), rate, test buttons
```

Changes to existing files: `app/layout.tsx` wraps the page in `VoiceLoader` and places `VoiceTranscript` under `SiteHeader`; `components/site-header.tsx` renders `VoiceButton` next to `NotificationBell`; `lib/notify.ts` and `lib/attention.ts` gain the `speak` path (`notify` calls `speakNotification(items)` when the pref is on); `lib/settings-tab.ts` and `components/settings/settings-nav.tsx` gain `voice`; `app/settings/page.tsx` renders `VoiceSettings`; `try-review.tsx`, `code-review.tsx` and `permission-card.tsx` call `useVoiceCommands`; the run page and review pages call `useReadAloud`. The `[` and `]` listeners in the review pages are left alone; `voice-hotkeys.tsx` adds its own listener with the same `isTyping` guard.

### UI states

The provider holds one state machine:

```
unsupported -> (never leaves)
idle -> starting (available() in flight, or install offered) -> listening -> idle
idle -> blocked (not-allowed, audio-capture) -> idle on retry
listening -> confirming (a confirm command matched) -> idle
idle | listening -> speaking (speaker active; listening is aborted first) -> idle
```

`speaking` is a parallel flag on the speaker, not a replacement for the listening state, but `start()` refuses while the speaker is active, which gives the "never listen while speaking" rule a single enforcement point.

The strip renders one line per state: "Listening" with the interim text, "Heard: {final}" with "Ran: {command}" or "Sent to assistant", "Approve this Try it? Say yes or press Enter", "Reading: {title}, sentence {n} of {m}", "Chrome blocked the microphone. Allow it in the site settings.", "English (US) is downloading for offline use". It is empty and collapsed when idle and nothing happened in the last 10 seconds.

### Sequence for a command

1. User presses `V` outside a text field. `VoiceHotkeys` calls `voice.start()`.
2. Provider checks the speaker is idle, then `checkOnDevice(ctor, lang)`. `"available"`: creates a recognizer with `processLocally = true`, `continuous = false`, `interimResults = true`, `lang`, `phrases` from the registry. Other results: see "Decisions 1".
3. `start` event: state `listening`, strip shows "Listening", live region announces it.
4. `result` events with `isFinal === false` update `interim` in the strip only.
5. The final `result`: `matchCommand(transcript, registry)`. A match runs `command.run(remainder)` or enters `confirming`. No match: `assistant.send(transcript, { source: "voice" })`, strip shows "Sent to assistant".
6. `end`: state `idle`. In dictation mode, `end` while the user has not stopped restarts once.
7. When `speakReplies` is on, `onReply` with `done: true` calls `speaker.speak(text, { priority: "reply" })`, which aborts any listening first.

## Delivery

Each PR is one branch, one GitHub issue, CI green, `pnpm doctor:react` clean after changes under `apps/web`, and one red-green slice per test named here. Context7 before writing against Next 16, React 19 or Vitest 5. PRs 1 to 3 and 5 to 7 do not need the assistant; PR 4 does.

1. Voice preferences, support detection and the Voice settings tab. Files: `lib/voice/prefs.ts`, `lib/voice/support.ts`, `lib/voice/errors.ts`, `components/settings/voice-settings.tsx`, `lib/settings-tab.ts`, `settings-nav.tsx`, `app/settings/page.tsx`. First tests: `lib/voice/prefs.test.ts` "readVoicePrefs returns defaults with speaking off and server recognition off when nothing is stored"; "writeVoicePrefs round-trips through localStorage and readVoicePrefs tolerates garbage"; `lib/voice/support.test.ts` "detectVoiceSupport finds the webkit-prefixed constructor"; "detectVoiceSupport reports no on-device check when available() is missing"; `components/settings/voice-settings.test.tsx` "the Voice tab says recognition is unavailable when no constructor exists and keeps the speaking switches"; "turning on server recognition writes allowServerRecognition true".

2. Speech input hook, header button, transcript strip and hotkeys (command mode and dictation mode, no router yet: a final transcript only lands in the strip). Files: `lib/voice/recognition.ts`, `lib/voice/use-speech-input.ts`, `components/voice/voice-provider.tsx`, `voice-loader.tsx`, `voice-button.tsx`, `voice-transcript.tsx`, `voice-hotkeys.tsx`, `testing/fake-speech-recognition.ts`, `layout.tsx`, `site-header.tsx`. First tests: `use-speech-input.test.tsx` "start creates a recognizer with processLocally true, interimResults true and the configured lang"; "start with server recognition allowed and no on-device pack creates a recognizer with processLocally false"; "start with no pack and server recognition off does not create a recognizer and reports downloadable"; "interim results update interim and final results call onFinal once"; "abort discards a final result that arrives after it"; "an error not-allowed sets state blocked with a readable message"; "dictation mode restarts once when the recognizer ends on its own and not after stop"; `voice-button.test.tsx` "the button is absent when SpeechRecognition is missing"; "the button has aria-pressed true and the live region says Listening after a click"; "the button offers to install the language pack when available() returns downloadable and calls install on click"; `voice-hotkeys.test.tsx` "V toggles listening outside text fields and does nothing inside a textarea"; "Escape stops listening and leaves an idle page alone"; `voice-provider.test.tsx` "start is refused while the speaker is active".

3. Speaker service and read aloud. Files: `lib/voice/speaker.ts`, `lib/voice/use-read-aloud.ts`, `components/voice/read-aloud-button.tsx`, `testing/fake-speech-synthesis.ts`, run page and review page registrations. First tests: `speaker.test.ts` "splitSentences keeps abbreviations and code fences together and labels code blocks as skipped"; "pickVoice prefers a local voice in the recognition language and never a remote voice unless allowed"; "pickVoice honours a stored voiceURI that still exists and falls back when it is gone"; "speak queues one utterance per sentence and stop cancels the rest"; "a notification queues behind a reply and ahead of a long read"; "nothing is spoken on construction"; `read-aloud-button.test.tsx` "Read aloud on the run page speaks the registered summary and the strip shows sentence progress"; "Escape stops reading"; "speaking aborts an active listening session".

4. The voice bubble (decision 8; replaces the command router below). Files: `components/voice/voice-bubble.tsx`, provider routing of command-mode transcripts to the assistant, spoken replies in the bubble, approvals by voice. First tests: `voice-bubble.test.tsx` "V opens the bubble and the final transcript goes to the assistant with source voice"; "nothing is sent while results are interim"; "the bubble shows the tool status, then the reply, and speaks it"; "an approval is read out and yes approves it"; "no with words after it denies with them as the note"; "anything else keeps the card open"; "Escape stops speech, then closes the bubble"; "with the assistant off the bubble says so and sends nothing". Earlier scope, superseded: Voice command router, global commands and the assistant hand-off. Needs `AssistantPort` from the assistant plan; until then the PR ships against `NullAssistant`. Files: `lib/voice/commands.ts`, `registry.ts`, `use-voice-commands.ts`, `global-commands.ts`, `testing/fake-assistant.ts`, provider wiring. First tests: `commands.test.ts` "matchCommand normalizes case, punctuation and spacing"; "matchCommand prefers the longest phrase and a page command over a global one"; "matchCommand returns the remainder for a takesRemainder command"; "matchCommand returns no match for free text"; `voice-provider.test.tsx` "an unmatched final transcript is sent to the assistant once with source voice"; "nothing is sent while results are interim"; "with no assistant the strip lists the page's commands instead"; `global-commands.test.tsx` "go to inbox navigates and focuses the h1"; "stop cancels speech"; "open it navigates to the last spoken notification within 60 seconds and refuses after"; "help speaks the registered commands".

5. Superseded by decision 8 (no page commands). Earlier scope: Page commands for Try it, code review and permission cards, with confirmation. Files: `try-review.tsx`, `code-review.tsx`, `permission-card.tsx`, provider `confirming` state, strip prompt. First tests: `try-review.test.tsx` additions "works ticks the current criterion and moves to the next unchecked one"; "doesn't work with a remainder presses Doesn't work and fills the note"; "next and previous move the criterion"; "approve is refused while a criterion is unticked"; "approve asks for confirmation and yes calls answerReviewAction with option approve"; "a confirmation times out after 15 seconds"; `code-review.test.tsx` additions "next file and previous file move the file cursor"; "request changes with a remainder fills the overall comment and asks for confirmation"; `permission-card.test.tsx` additions "allow once calls answerPermissionAction with decision once"; "deny with a remainder passes the message"; "always allow asks for confirmation first"; "commands target the first unanswered card".

6. Spoken notifications and spoken replies. Files: `lib/notify.ts`, `lib/attention.ts` (or a `speak` field in `VoicePrefs` read by `notify`), `notification-bell.tsx` unchanged, `voice-settings.tsx` switches, provider `onReply` subscription. First tests: `notify.test.ts` "notify speaks input, permission, ready and failed items when speakNotifications is on"; "finished and merged are spoken only with speakFinished"; "started is never spoken"; "nothing is spoken when the preference is off"; `voice-provider.test.tsx` "a completed assistant reply is spoken when speakReplies is on and not when off"; "a streaming reply is not spoken until done"; "the reply text stays on screen".

7. Contextual biasing, dictation into the assistant composer, help text and docs. Files: `use-speech-input.ts` (phrases, unspokenPunctuation), provider (composer dictation through `assistant.composerRef`), `voice-settings.tsx` (support note and shortcuts list), README section "Voice in Chrome". First tests: `use-speech-input.test.tsx` additions "phrases are set from the registry only when processLocally is true"; "phrases-not-supported clears the list and listening continues"; "unspokenPunctuation is set only when the property exists"; `voice-provider.test.tsx` "dictation inserts final text at the caret of the focused textarea and never inserts interim text".

## Risks

| Risk | Mitigation |
|---|---|
| `available({ processLocally: true })` misbehaves on macOS (Chromium issue 444393111, status unknown) | Manual script step 2 checks it first. If broken on the user's Chrome, the button shows the error and the Voice tab's server recognition switch is the documented workaround until a fix ships. |
| The user's language has no on-device pack | Default `en-US`. Open question 1 decides whether Swedish goes through server recognition or waits for a pack; the Whisper fallback is written up above if neither is acceptable. |
| Chrome ends sessions after silence or on its own | Command mode is one utterance by design. Dictation mode restarts once per `end` while the user has not stopped; the strip shows "Listening" only while a session is open, so a stopped session is visible. |
| The microphone hears the dashboard's own speech | Starting speech aborts listening and listening cannot start while speaking. The manual script tests the echo case with speakers on. |
| A spoken "approve" lands by accident | Submits and "always allow" always confirm. Confirmation times out. The confirm phrase is "yes", never part of a command phrase. |
| Remote voices or server recognition used without the user knowing | Both are off by default, behind switches whose labels say where audio or text goes, and guarded by permanent tests. |
| `speechSynthesis` cuts long utterances | One utterance per sentence; stop granularity benefits too. |
| `webkitSpeechRecognition` only, or a future unprefixed change | `support.ts` reads both names; one test covers the prefixed path. |
| Screen reader and TTS speak at once | Speaking off by default; the Voice tab says so; live region limited to state words. |
| The assistant plan changes the port shape | Voice touches the port in one file (`voice-provider.tsx`) and a fake; PR 4 is the only one that depends on it. |
| Chrome's microphone permission prompt appears on every start | Chrome remembers the decision per origin; the manual script confirms the prompt appears once for `http://127.0.0.1:3000`. |

## Decided questions

The user accepted every recommendation below on 2026-10-01. Each one is now a decision for the implementation.

1. Recognition language. Decided: `en-US` on-device by default. If the user wants Swedish, enable server recognition for `sv-SE` as a conscious opt-in, and revisit Whisper in the browser only if that is unacceptable.
2. Push to talk shape. Decided: `V` toggles and `Escape` stops, matching the single-key style of `[` and `]`. Hold-to-talk on the button can come later without changing the hook.
3. Confirmation for submits. Decided: always confirm "approve", "send back", "request changes", "approve after fixes" and "always allow"; never confirm "works", "doesn't work", "next", "allow once", "deny".
4. Speaking replies while they stream. Decided: speak only completed replies in v1; sentence-level streaming speech is a follow-up once reply lengths are known.
5. Where the microphone button lives when the assistant panel exists. Decided: keep it in the header so it works on every page; the assistant composer gets its own small dictation button that calls the same hook in dictation mode.

## Verification

Automated:

```bash
pnpm test:web
pnpm typecheck && pnpm lint
pnpm doctor:react
```

Manual script in Chrome on macOS, with `pnpm dev:web` on http://127.0.0.1:3000 and speakers on. Record the Chrome version from `chrome://version` and the outcome of every step in the PR description.

1. Open `chrome://components` and note whether any "SODA" language pack is listed. Open the dashboard; the header shows the microphone button. Open DevTools and run `SpeechRecognition.available({ langs: ["en-US"], processLocally: true })` (prefixed if needed) and record the result. Run `speechSynthesis.getVoices().map(v => [v.name, v.lang, v.localService])` and record which voices are local.
2. Settings, Voice tab: language en-US, server recognition off, speaking off. Press `V`. Expect Chrome's microphone prompt once, then "Listening" in the strip and the button pressed. Say "go to inbox". Expect the inbox, focus on its heading, strip "Ran: go to inbox".
3. If step 1 returned `downloadable`, press the button, choose "Install English (US) for offline use", wait for `chrome://components` to show the pack, and repeat step 2.
4. On a run with a pending Try it question, open the Try it page. Say "next", "works", "doesn't work, the list is empty after a reload". Expect the criterion cursor to move, the first criterion ticked, the second marked and its note filled with "the list is empty after a reload". Say "approve". Expect a refusal naming the unticked criteria. Tick everything, say "approve", expect the prompt, say "yes", expect the submit and the redirect to the run page.
5. Open a code review. Say "next file", "whole file", "request changes, the migration is missing a down step". Expect the file cursor and view toggles to change and the overall comment to hold the remainder with the confirmation prompt showing. Press `Escape`. Expect no submit.
6. With a permission request pending, say "allow once". Expect the card answered. On the next one say "deny, use pnpm instead". Expect the note delivered.
7. Voice tab: turn on "Speak notifications". Trigger a notification (`pnpm demo` or answer a question so the run finishes). Expect the toast and the spoken title and body through a local voice, and no speech through a remote voice. Say "open it" within a minute. Expect navigation to the notification's link.
8. On the run page press "Read aloud". Expect sentence-by-sentence reading with progress in the strip. Press `Escape`. Expect silence immediately. While reading, press `V`. Expect no listening to start while speech is active.
9. Echo check: turn on "Speak replies" (needs the assistant from PR 4), say something the assistant answers, and confirm the microphone does not restart while the reply is spoken and the spoken reply is not transcribed.
10. Dictation: focus the Try it note field, press the microphone button, speak two sentences, press `Escape`. Expect the final text in the field at the caret, interim text only in the strip, and nothing sent to the assistant.
11. Settings: turn on "Allow server recognition", set language to sv-SE, say a Swedish sentence. Expect a transcript. Turn it off again. Expect `V` with sv-SE to report that no on-device pack exists.
12. Open the dashboard in Firefox or Safari. Expect no microphone button, the Voice tab's unavailable note, and the speaking switches still present.
13. Reduced motion: enable "Reduce motion" in macOS, press `V`, expect the pressed state without a pulse.
