import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { importSPKI, jwtVerify } from "jose";
import {
	LICENSE_HEARTBEAT_INTERVAL_MS,
	LICENSE_PUBLIC_KEY,
	LICENSE_SERVER_URL,
} from "./license-config";

const LICENSE_FILE = "license.json";

type StoredLicense = {
	token: string;
	expiresAt: number;
	licenseKey: string;
	deviceId: number;
	plan: string;
	features: Record<string, unknown>;
	machineId: string;
	lastHeartbeat: number;
	activatedAt: number;
};

type ActivateResponse = {
	token: string;
	expiresAt: number;
	plan: string;
	features: Record<string, unknown>;
	licenseKey: string;
	deviceId: number;
};

type ApiError = { error: string; hint?: string; reason?: string; maxDevices?: number };

let cachedLicense: StoredLicense | null = null;
let cachedMachineId: string | null = null;

function licensePath(): string {
	return path.join(app.getPath("userData"), LICENSE_FILE);
}

export function getMachineId(): string {
	if (cachedMachineId) return cachedMachineId;
	const hostname = os.hostname();
	const platform = os.platform();
	const arch = os.arch();
	const ifaces = os.networkInterfaces();
	let mac = "";
	for (const name of Object.keys(ifaces)) {
		for (const iface of ifaces[name] ?? []) {
			if (!iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00") {
				mac = iface.mac;
				break;
			}
		}
		if (mac) break;
	}
	cachedMachineId = crypto
		.createHash("sha256")
		.update(`watshop|${platform}|${arch}|${hostname}|${mac}`)
		.digest("hex");
	return cachedMachineId;
}

export function getMachineName(): string {
	return os.hostname();
}

async function readLicenseFile(): Promise<StoredLicense | null> {
	try {
		const raw = await fs.readFile(licensePath(), "utf8");
		return JSON.parse(raw) as StoredLicense;
	} catch {
		return null;
	}
}

async function writeLicenseFile(license: StoredLicense): Promise<void> {
	await fs.writeFile(licensePath(), JSON.stringify(license, null, 2), "utf8");
	cachedLicense = license;
}

export async function clearLicense(): Promise<void> {
	try {
		await fs.unlink(licensePath());
	} catch {}
	cachedLicense = null;
}

export async function loadLicense(): Promise<StoredLicense | null> {
	if (cachedLicense) return cachedLicense;
	cachedLicense = await readLicenseFile();
	return cachedLicense;
}

async function verifyToken(
	token: string,
): Promise<{ valid: boolean; payload?: Record<string, unknown>; reason?: string }> {
	try {
		const key = await importSPKI(LICENSE_PUBLIC_KEY, "RS256");
		const { payload } = await jwtVerify(token, key, { issuer: "watshop-studio" });
		return { valid: true, payload };
	} catch (err: unknown) {
		const reason = err instanceof Error ? err.message : String(err);
		return { valid: false, reason };
	}
}

/**
 * Returns true if the app currently has a valid, locally-verifiable license.
 * Does NOT contact the server — used for fast startup gating.
 */
export async function hasValidLocalLicense(): Promise<boolean> {
	const lic = await loadLicense();
	if (!lic) return false;
	if (lic.machineId !== getMachineId()) return false;
	if (lic.expiresAt < Date.now()) return false;
	const verified = await verifyToken(lic.token);
	return verified.valid;
}

export async function getLicenseInfo() {
	const lic = await loadLicense();
	if (!lic) return null;
	return {
		licenseKey: lic.licenseKey,
		plan: lic.plan,
		features: lic.features,
		expiresAt: lic.expiresAt,
		activatedAt: lic.activatedAt,
		lastHeartbeat: lic.lastHeartbeat,
	};
}

/**
 * Activates a license key with the license server.
 */
export async function activateLicense(
	rawKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const key = rawKey.trim().toUpperCase();
	if (!key) return { ok: false, error: "Please enter a license key." };

	const machineId = getMachineId();
	const machineName = getMachineName();

	let res: Response;
	try {
		res = await fetch(`${LICENSE_SERVER_URL}/api/activate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				key,
				machineId,
				machineName,
				os: process.platform,
				appVersion: app.getVersion(),
			}),
		});
	} catch (err) {
		console.error("[license] activate network error:", err);
		return { ok: false, error: "Cannot reach the license server. Check your internet connection." };
	}

	let body: ActivateResponse | ApiError;
	try {
		body = (await res.json()) as ActivateResponse | ApiError;
	} catch {
		return { ok: false, error: `Server returned ${res.status} (invalid response).` };
	}

	if (!res.ok || "error" in body) {
		const err = body as ApiError;
		return { ok: false, error: friendlyError(err) };
	}

	const ok = body as ActivateResponse;

	// Verify the JWT signature locally before trusting it.
	const verified = await verifyToken(ok.token);
	if (!verified.valid) {
		return {
			ok: false,
			error: "Activation succeeded but the response signature is invalid. Please contact support.",
		};
	}

	const stored: StoredLicense = {
		token: ok.token,
		expiresAt: ok.expiresAt,
		licenseKey: ok.licenseKey,
		deviceId: ok.deviceId,
		plan: ok.plan,
		features: ok.features,
		machineId,
		activatedAt: Date.now(),
		lastHeartbeat: Date.now(),
	};
	await writeLicenseFile(stored);
	return { ok: true };
}

/**
 * Hits the heartbeat endpoint. Refreshes the local token if the server gave us
 * a new one. Returns ok=false if the server says license is revoked / removed,
 * in which case the caller should clear the license and re-prompt.
 *
 * Network errors are NOT treated as failures here — we keep the cached token
 * so the user can keep working offline.
 */
export async function heartbeat(): Promise<
	| { ok: true; refreshed: boolean }
	| {
			ok: false;
			reason: "revoked" | "device_not_active" | "machine_mismatch" | "missing";
			offline?: false;
	  }
	| { ok: false; reason: "offline"; offline: true }
> {
	const lic = await loadLicense();
	if (!lic) return { ok: false, reason: "missing" };

	let res: Response;
	try {
		res = await fetch(`${LICENSE_SERVER_URL}/api/heartbeat`, {
			method: "POST",
			headers: { Authorization: `Bearer ${lic.token}` },
		});
	} catch (err) {
		console.warn("[license] heartbeat offline:", err);
		return { ok: false, reason: "offline", offline: true };
	}

	if (res.ok) {
		const body = (await res.json()) as {
			valid: boolean;
			refreshed?: boolean;
			token?: string;
			expiresAt?: number;
		};
		const updated: StoredLicense = { ...lic, lastHeartbeat: Date.now() };
		if (body.refreshed && body.token && body.expiresAt) {
			updated.token = body.token;
			updated.expiresAt = body.expiresAt;
		}
		await writeLicenseFile(updated);
		return { ok: true, refreshed: !!body.refreshed };
	}

	if (res.status === 401 || res.status === 403) {
		const body = (await res.json().catch(() => ({}))) as ApiError;
		const reason = (body.error ?? "revoked") as
			| "revoked"
			| "device_not_active"
			| "machine_mismatch";
		return { ok: false, reason };
	}

	console.warn("[license] heartbeat unexpected status:", res.status);
	return { ok: false, reason: "offline", offline: true };
}

/**
 * Releases the device slot so the user can move to a new PC.
 */
export async function deactivateLicense(): Promise<{ ok: boolean }> {
	const lic = await loadLicense();
	if (!lic) {
		await clearLicense();
		return { ok: true };
	}
	try {
		await fetch(`${LICENSE_SERVER_URL}/api/deactivate`, {
			method: "POST",
			headers: { Authorization: `Bearer ${lic.token}` },
		});
	} catch {
		// Ignore network errors — clear locally regardless.
	}
	await clearLicense();
	return { ok: true };
}

/**
 * Background heartbeat scheduler. Run once at startup; does heartbeat if
 * lastHeartbeat is older than the interval. Returns the heartbeat result
 * so the caller can react to revocation.
 */
export async function maybeHeartbeat(): Promise<Awaited<ReturnType<typeof heartbeat>> | null> {
	const lic = await loadLicense();
	if (!lic) return null;
	const due = Date.now() - lic.lastHeartbeat > LICENSE_HEARTBEAT_INTERVAL_MS;
	if (!due) return null;
	return heartbeat();
}

function friendlyError(err: ApiError): string {
	switch (err.error) {
		case "invalid_key":
			return "That license key format isn't right. It should look like WATS-XXXX-XXXX-XXXX-XXXX.";
		case "unknown_key":
			return "We couldn't find that license. Double-check the key, or buy one at watshop.in/studio.";
		case "license_revoked":
			return "This license has been revoked. Contact hello@watshop.in if this is a mistake.";
		case "device_limit_reached":
			return (
				err.hint ??
				`This license is already in use on another PC (limit: ${err.maxDevices ?? 1}). Ask support to release it.`
			);
		case "invalid_machine_id":
			return "We couldn't identify this PC. Try restarting WatShop Studio.";
		default:
			return err.hint ?? `Activation failed: ${err.error}`;
	}
}
