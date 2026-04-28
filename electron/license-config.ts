/**
 * License-server connection config baked into the desktop app.
 *
 * To re-target a different license server (e.g. production at
 * https://licenses.watshop.in), update LICENSE_SERVER_URL and replace
 * LICENSE_PUBLIC_KEY with the matching server's RS256 public key
 * (from <server>/data/jwt-public.pem). Then rebuild the .exe.
 */

export const LICENSE_SERVER_URL =
	process.env.LICENSE_SERVER_URL ?? "https://licenses.watshop.in";

export const LICENSE_BUY_URL =
	process.env.LICENSE_BUY_URL ?? "https://watshop.in/studio";

export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAo0w+yQeVSVKtcKF5Be4o
qVAoGfO8Bg5xMirSFcCPRJxajRzNUNHuJVuvcOtprFhMkvGCDKBpij2EDsgWJteN
z5MFXu58o8r9m8dqoVUj+xYxGycsTPdq9E2YVdDFm1CjWP++O3tYneh2RONPhak8
B8HntaA4n0FY6W5rZXP2BcuY15tklzTSwhaURIQhuUBB67z/3I19+B6jOGft9/Nu
JXB8WfIC7JxAx2FlDn2tTczrBzptBP8OeZcM05ygiZYtTbY2/ZXRZ653qOTnr3HG
zRBaH2a7syGwn2gjMHWF4lDlRhYeHvQ5zbCFwOs1zx3enozID/tWxANGzc5Tp8wP
HQIDAQAB
-----END PUBLIC KEY-----`;

export const LICENSE_HEARTBEAT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
