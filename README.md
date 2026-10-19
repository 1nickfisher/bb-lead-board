# Lead board (bb plugin)

A bb panel that shows the decisions the factory lead needs from Nick, with the
lead's recommendation on every option. It reads the `factory board` state
(`~/.local/state/factory/board.json` on cloudroom3, schema 1, TYP-1568) and
stays in step with the lead by polling it every 20 seconds.

## Surfaces

- **Thread side panel:** in the lead thread, open the right panel, choose
  New tab, then **Lead board** under Actions.
- **Sidebar page:** `/plugins/lead-board/board`, for a full-width view.

## Behaviour

- Tapping an option posts its `phrase`, verbatim, to the lead thread with
  `useSdk().threads.send` under the signed-in user's session, so it is Nick's
  own message. It queues if the lead is mid-turn.
- `risk` of `production`, `security` or `money` opens a confirmation dialog
  first. The plugin never approves anything itself; the lead's read-back
  rules still apply.
- A sent card shows "Sent: waiting for the lead" until the board drops the
  decision or changes it; nothing else clears it. One store per window
  (`components/sent-store.ts`, persisted to local storage) holds the marks and
  the sends in flight, so every open panel shows the card as sent and a
  second tap anywhere sends nothing.
- Phrases are kept exactly as the feed wrote them, in what the panel shows and
  sends. An empty phrase, one with leading or trailing whitespace or one over
  the feed's 500-unit limit, or a decision with more than 8 options, disables
  that decision's buttons with a "malformed option" note.
- A legacy decision TYP-1568 marks `invalidLegacy` shows "Needs repair:
  <invalidReason>" with every option disabled; it is never sendable. Each
  decision parses on its own, so one the panel cannot read becomes a
  needs-repair card instead of hiding the board.
- Field lengths are never a parse error. Long text is clipped for display
  only, using `BOARD_LIMITS` in `lib/board.ts` (UTF-16 units). It mirrors
  `schemas/board-limits.json` from TYP-1568; `lib/board-limits.test.ts`
  fails on drift once that file is in the repo, and the panel should then
  read the file instead of duplicating it. Phrases are always sent whole.
  Legacy `needs add` asks arrive as ordinary single-option
  decisions; an empty tag falls back to the project.
- After 15 minutes without an update the panel shows a stale banner. A read
  or parse failure shows an error and keeps the last good board.
- Voice controls (setting `voice`, off by default): **Read aloud** uses
  `speechSynthesis`. **Hold to talk** records a short note, transcribes it with
  bb's configured voice service (`sdk.system.transcribeVoice`), or with the
  browser's Web Speech API when recording or bb transcription is unavailable,
  then shows the text to edit. It is sent only when Nick presses **Send as my
  message**.

## Settings

`bb plugin config lead-board` shows them; the three required settings have no
defaults. Until all are set (and valid) the panel shows "Not configured" and
neither polls nor sends anything.

| Key | Example | Meaning |
| --- | --- | --- |
| `boardHostId` | `host_…` | Host that holds board.json |
| `boardPath` | `/path/to/board.json` | Absolute path on that host |
| `leadThreadId` | `thr_…` | Thread that receives option phrases |
| `voice` | `false` (default) | Show the voice controls |

## Develop

```sh
npm install --include=dev
npm test            # vitest + the bb plugin test harness
npx tsc --noEmit
bb plugin build .
```

On cloudroom3 the bb CLI's own npm lookup fails during the first build
(`Cannot find module 'npm/package.json'`). Run the build with the system npm
on the module path: `NODE_PATH=/usr/local/lib/node_modules bb plugin build .`

## Install

This repository holds only the panel; it is published from the factory repo's `plugins/lead-board` folder.

```sh
bb plugin install git:https://github.com/1nickfisher/bb-lead-board.git@main
bb plugin config lead-board set boardHostId <host id that holds board.json>
bb plugin config lead-board set boardPath </absolute/path/to/board.json>
bb plugin config lead-board set leadThreadId <lead thread id>
bb plugin config lead-board set voice true   # optional
```

Until all three are set, the panel shows "Not configured" and sends nothing.
