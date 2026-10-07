# Windows quick setup

1. Install Node.js 20+ (LTS) on the cinema PC.
2. Download/copy this entire `agent` folder to the cinema PC.
3. Double-click `Setup-Agent.ps1` using **Run with PowerShell**.
4. Open:
   `C:\ProgramData\CinemaOSAgent\config.json`
5. Put the same secret value you created in Cloudflare into:
   `"enrollmentKey": "..."`
6. Save the file.
7. Double-click `Start-Agent.bat`.

On first successful connection the Agent:
- registers with CinemaOS;
- receives its own token;
- removes the enrollment key from the local config;
- starts sending a heartbeat every 15 seconds;
- appears under **CinemaOS → Settings → CinemaOS Agents**.

Keep the enrollment key private. Do not send it in chat or screenshots.
