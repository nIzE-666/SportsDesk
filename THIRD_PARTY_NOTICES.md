# Third-Party Notices

## KinoWatch (MIT)

Protocol details for the KinoPub device-code login flow and TV channel
retrieval, as well as the general shape of the HLS player integration, were
adapted from the KinoWatch project authored by its respective MIT-licensed
authors. Only protocol/route knowledge and general approach were reused; no
personal tokens, credentials, or settings were copied.

Source: https://github.com/ (KinoWatch upstream repository)
License: MIT

All KinoPub client configuration (base URL, client id, client secret) used by
SportsDesk is read at runtime from a DPAPI-encrypted file prepared by the
user. No secrets are stored in this repository or shipped with the app.

## Libraries

- React, Vite, TypeScript, lucide-react, recharts, hls.js: their respective
  licenses (MIT / Apache-2.0) apply.
- Tauri 2 and official plugins: MIT / Apache-2.0.
