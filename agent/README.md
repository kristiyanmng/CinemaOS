# CinemaOS Agent

Persistent local worker for cinema transfers and hardware integrations.

## Current v0.1
- Windows-friendly Node.js service process
- persistent local queue in `%ProgramData%\\CinemaOSAgent\\queue.json`
- agent token stored locally after enrollment
- cloud heartbeat every 15 seconds
- cloud job polling
- survives browser refresh/close because it is independent of the web UI

## First setup
1. Install Node.js 20+ on the cinema PC.
2. Copy the `agent` folder to the PC.
3. In Cloudflare Workers, create secret `AGENT_ENROLLMENT_KEY`.
4. Run `npm start` once. The Agent creates `%ProgramData%\\CinemaOSAgent\\config.json`.
5. Put the same enrollment key into that config file and run again.
6. After successful enrollment the enrollment key is erased from the local config and replaced with an agent-specific token.

Remote filesystem jobs are intentionally not enabled yet. CinemaOS user authentication and authorization must be added first.


## Agent v0.2 - persistent ingest

A local ingest folder is created automatically:

`C:\ProgramData\CinemaOSAgent\Inbox`

Put a DCP ZIP/package file in this folder. The Agent discovers it, adds it to the local persistent queue and uploads it independently of the browser.

Completed files are moved to:

`C:\ProgramData\CinemaOSAgent\Done`

The queue and multipart state are saved in:

`C:\ProgramData\CinemaOSAgent\queue.json`

Because the Agent owns the local file and queue, browser refresh/close does not stop the upload. If the Agent or Windows restarts, it resumes from the saved multipart parts.
