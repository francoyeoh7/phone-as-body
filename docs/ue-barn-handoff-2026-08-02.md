# Corridor 617 UE Barn Handoff - 2026-08-02

## GitHub

- Private repo: https://github.com/francoyeoh7/corridor-617
- Branch used today: `main`

## Web Phone Bridge

- Start server: `npm start`
- Default local URL: `http://localhost:4174/ue-bridge`
- The bridge page creates the QR room automatically and forwards the existing phone controller packets to Unreal over UDP.
- Unreal input target: `127.0.0.1:61717`
- The phone controller logic remains the same: full-screen hold+drag movement, tap interact, gyro look.

## Unreal Project

- Local project path on this machine: `E:\Corridor617\Corridor617BarnUE\Corridor617BarnUE.uproject`
- Portable project package for the next computer: `E:\Corridor617\handoff\Corridor617BarnUE-handoff-20260802-225758.tar`
- Unpack command on Windows: `tar -xf E:\Corridor617\handoff\Corridor617BarnUE-handoff-20260802-225758.tar -C E:\Corridor617`
- Unreal Engine path used today: `E:\EPIC\UE_5.7`
- Main map: `/Game/Corridor617/Maps/L_BarnNight`
- Caches/logs are pointed to E drive:
  - `E:\UnrealCaches\DDC`
  - `E:\UnrealCaches\Zen\Data`
  - `E:\UnrealCaches\Logs\UBT`

## Implemented Today

- Added UE C++ first-person character, HUD reticle, flashlight, UDP phone input receiver, and ladder interaction marker.
- Added two ladder markers in `L_BarnNight`:
  - `Corridor617_LadderUp`
  - `Corridor617_LadderDown`
- Reticle starts as a dot and animates into a diamond while aiming at a ladder marker.
- Interact works from keyboard `E` and from phone short tap through the bridge.
- Player starts inside the barn near the ladder area.

## Verified

- `npm test`
- `npm run build`
- UE editor target build:
  `Build.bat Corridor617BarnUEEditor Win64 Development -Project=E:\Corridor617\Corridor617BarnUE\Corridor617BarnUE.uproject -WaitMutex -NoHotReloadFromIDE`
- UE game target build:
  `Build.bat Corridor617BarnUE Win64 Development -Project=E:\Corridor617\Corridor617BarnUE\Corridor617BarnUE.uproject -WaitMutex -NoHotReloadFromIDE`
- Runtime smoke test:
  - Game loads `L_BarnNight`
  - UE listens on UDP `61717`
  - `/api/ue-bridge/input` returns `{ "ok": true }`
  - `/api/ue-bridge/action` returns `{ "ok": true }`

## Next Work

- Manually playtest ladder placement in the barn and adjust marker/target coordinates if needed.
- Package or copy the UE project folder to the next computer; the Fab asset content is not committed into the web GitHub repo.
- If using a real phone outside localhost, set `PUBLIC_CONTROLLER_ORIGIN` to the HTTPS address the phone can access.
