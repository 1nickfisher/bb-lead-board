The factory lead keeps a board of what it needs from you. This panel shows that
board beside the lead thread, so you stop scrolling for decisions.

## What you get

- **Needs you now** on top: each decision with its context, one button per
  option, the lead's recommendation starred and a one-line reason.
- **Coming up**, **In flight** (grouped by project) and **Done today**, each
  collapsed.
- An "updated N min ago" label, and a warning when the board is more than
  15 minutes old.

## How it works

The panel reads `board.json` from the factory control host through bb's file
API every 20 seconds. Tapping an option posts its exact phrase to the lead
thread as your own message, the same as typing it. Production, security and
money decisions ask you to confirm first. The panel never approves anything by
itself: the lead still reads production approvals back to you in the thread.

Optional voice controls (off by default) read the decisions aloud and let you
dictate a note. You always see and confirm a voice note before it is sent.
