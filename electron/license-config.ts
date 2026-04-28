/**
 * License-server connection config baked into the desktop app.
 *
 * To re-target a different license server, update LICENSE_SERVER_URL and
 * replace LICENSE_PUBLIC_KEY with the matching server's RS256 public key
 * (visible in the admin panel under /admin/integration). Then rebuild the .exe.
 */

export const LICENSE_SERVER_URL =
	process.env.LICENSE_SERVER_URL ?? "https://studiokey.watshop.in";

export const LICENSE_BUY_URL =
	process.env.LICENSE_BUY_URL ?? "https://watshop.in/studio";

export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApZF88erwh4cRh/DuWoLx
BdLEr9Ba3TBRyzDED9bqK83NCkNZM57k5cRiuFwel1KpTO5WzpdOfBlSLNGpj661
LFt9PxxUIRZjX7c3U8X8FpYEPP42Qz0SZyUOKA5pWn/ErRh0ZhA5Thf7/DxOwxwa
ST4nlRrnOe4+IaZMA/D184ZIODIIweHPdf+0gM4+CA7zOoMdhz+hFdER+xy5yUH3
b02fMZRYgkh9xq4BQxw3V146v+2isrgjiVguD2HF9XD9fzq6xnQUES1J4uhL8X2l
XOUnoh4RCNQZxDtSZiaM/QPddO8+jDpb2B6y5wqbypxzn75feB5vazh4GF0ea7pC
oQIDAQAB
-----END PUBLIC KEY-----`;

export const LICENSE_HEARTBEAT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
