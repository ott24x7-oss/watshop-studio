import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	session,
	systemPreferences,
	Tray,
} from "electron";
import { mainT, setMainLocale } from "./i18n";
import { registerIpcHandlers } from "./ipc/handlers";
import { LICENSE_BUY_URL } from "./license-config";
import {
	activateLicense,
	clearLicense,
	deactivateLicense,
	getLicenseInfo,
	getMachineId,
	getMachineName,
	hasValidLocalLicense,
	maybeHeartbeat,
} from "./license-manager";
import {
	createAnnotationOverlayWindow,
	createCountdownOverlayWindow,
	createEditorWindow,
	createHudOverlayWindow,
	createLicenseWindow,
	createSourceSelectorWindow,
} from "./windows";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use Screen & System Audio Recording permissions instead of CoreAudio Tap API on macOS.
// CoreAudio Tap requires NSAudioCaptureUsageDescription in the parent app's Info.plist,
// which doesn't work when running from a terminal/IDE during development, makes my life easier
if (process.platform === "darwin") {
	app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
}

export const RECORDINGS_DIR = path.join(app.getPath("userData"), "recordings");

async function ensureRecordingsDir() {
	try {
		await fs.mkdir(RECORDINGS_DIR, { recursive: true });
		console.log("RECORDINGS_DIR:", RECORDINGS_DIR);
		console.log("User Data Path:", app.getPath("userData"));
	} catch (error) {
		console.error("Failed to create recordings directory:", error);
	}
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, "public")
	: RENDERER_DIST;

// Window references
let mainWindow: BrowserWindow | null = null;
let licenseWindow: BrowserWindow | null = null;
let sourceSelectorWindow: BrowserWindow | null = null;
let countdownOverlayWindow: BrowserWindow | null = null;
let annotationOverlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let selectedSourceName = "";
const isMac = process.platform === "darwin";
const trayIconSize = isMac ? 16 : 24;

// Tray Icons
const defaultTrayIcon = getTrayIcon("openscreen.png", trayIconSize);
const recordingTrayIcon = getTrayIcon("rec-button.png", trayIconSize);

function createWindow() {
	mainWindow = createHudOverlayWindow();
}

function showMainWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) {
		if (mainWindow.isMinimized()) {
			mainWindow.restore();
		}
		mainWindow.show();
		mainWindow.focus();
		return;
	}

	createWindow();
}

function isEditorWindow(window: BrowserWindow) {
	return window.webContents.getURL().includes("windowType=editor");
}

function sendEditorMenuAction(
	channel: "menu-load-project" | "menu-save-project" | "menu-save-project-as",
) {
	let targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;

	if (!targetWindow || targetWindow.isDestroyed() || !isEditorWindow(targetWindow)) {
		createEditorWindowWrapper();
		targetWindow = mainWindow;
		if (!targetWindow || targetWindow.isDestroyed()) return;

		targetWindow.webContents.once("did-finish-load", () => {
			if (!targetWindow || targetWindow.isDestroyed()) return;
			targetWindow.webContents.send(channel);
		});
		return;
	}

	targetWindow.webContents.send(channel);
}

function setupApplicationMenu() {
	const isMac = process.platform === "darwin";
	const template: Electron.MenuItemConstructorOptions[] = [];

	if (isMac) {
		template.push({
			label: app.name,
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" },
			],
		});
	}

	template.push(
		{
			label: mainT("common", "actions.file") || "File",
			submenu: [
				{
					label: mainT("dialogs", "unsavedChanges.loadProject") || "Load Project…",
					accelerator: "CmdOrCtrl+O",
					click: () => sendEditorMenuAction("menu-load-project"),
				},
				{
					label: mainT("dialogs", "unsavedChanges.saveProject") || "Save Project…",
					accelerator: "CmdOrCtrl+S",
					click: () => sendEditorMenuAction("menu-save-project"),
				},
				{
					label: mainT("dialogs", "unsavedChanges.saveProjectAs") || "Save Project As…",
					accelerator: "CmdOrCtrl+Shift+S",
					click: () => sendEditorMenuAction("menu-save-project-as"),
				},
				...(isMac ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
			],
		},
		{
			label: mainT("common", "actions.edit") || "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: mainT("common", "actions.view") || "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: mainT("common", "actions.window") || "Window",
			submenu: isMac
				? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
				: [{ role: "minimize" }, { role: "close" }],
		},
	);

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}

function createTray() {
	tray = new Tray(defaultTrayIcon);
	tray.on("click", () => {
		showMainWindow();
	});
	tray.on("double-click", () => {
		showMainWindow();
	});
}

function getTrayIcon(filename: string, size: number) {
	return nativeImage
		.createFromPath(path.join(process.env.VITE_PUBLIC || RENDERER_DIST, filename))
		.resize({
			width: size,
			height: size,
			quality: "best",
		});
}

function updateTrayMenu(recording: boolean = false) {
	if (!tray) return;
	const trayIcon = recording ? recordingTrayIcon : defaultTrayIcon;
	const trayToolTip = recording ? `Recording: ${selectedSourceName}` : "WatShop Studio";
	const menuTemplate: Electron.MenuItemConstructorOptions[] = recording
		? [
				{
					label: mainT("common", "actions.stopRecording") || "Stop Recording",
					click: () => {
						if (mainWindow && !mainWindow.isDestroyed()) {
							mainWindow.webContents.send("stop-recording-from-tray");
						}
					},
				},
			]
		: [
				{
					label: mainT("common", "actions.open") || "Open",
					click: () => {
						showMainWindow();
					},
				},
				{ type: "separator" },
				{
					label: "License",
					submenu: [
						{
							label: "View license info…",
							click: async () => {
								const info = await getLicenseInfo();
								const { dialog } = await import("electron");
								if (!info) {
									dialog.showMessageBox({
										type: "info",
										message: "No license found",
										detail: "WatShop Studio is not activated on this PC.",
									});
									return;
								}
								dialog.showMessageBox({
									type: "info",
									message: "WatShop Studio License",
									detail: [
										`Key:        ${info.licenseKey}`,
										`Plan:       ${info.plan}`,
										`Activated:  ${new Date(info.activatedAt).toLocaleString()}`,
										`Last check: ${new Date(info.lastHeartbeat).toLocaleString()}`,
										`Expires:    ${new Date(info.expiresAt).toLocaleString()}`,
									].join("\n"),
								});
							},
						},
						{
							label: "Sign out of this PC…",
							click: async () => {
								const { dialog } = await import("electron");
								const choice = dialog.showMessageBoxSync({
									type: "warning",
									buttons: ["Sign out", "Cancel"],
									defaultId: 1,
									cancelId: 1,
									title: "Sign out",
									message: "Sign out of this PC?",
									detail:
										"Your license will be released so you can activate it on another computer. WatShop Studio will close and re-prompt for the key on next launch.",
								});
								if (choice !== 0) return;
								await deactivateLicense();
								for (const w of BrowserWindow.getAllWindows()) {
									if (!w.isDestroyed()) w.close();
								}
								mainWindow = null;
								showLicenseWindow();
							},
						},
					],
				},
				{ type: "separator" },
				{
					label: mainT("common", "actions.quit") || "Quit",
					click: () => {
						app.quit();
					},
				},
			];
	tray.setImage(trayIcon);
	tray.setToolTip(trayToolTip);
	tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

let editorHasUnsavedChanges = false;
let isForceClosing = false;

ipcMain.on("set-has-unsaved-changes", (_, hasChanges: boolean) => {
	editorHasUnsavedChanges = hasChanges;
});

function forceCloseEditorWindow(windowToClose: BrowserWindow | null) {
	if (!windowToClose || windowToClose.isDestroyed()) return;

	isForceClosing = true;
	setImmediate(() => {
		try {
			if (!windowToClose.isDestroyed()) {
				windowToClose.close();
			}
		} finally {
			isForceClosing = false;
		}
	});
}

function createEditorWindowWrapper() {
	if (mainWindow) {
		isForceClosing = true;
		mainWindow.close();
		isForceClosing = false;
		mainWindow = null;
	}
	mainWindow = createEditorWindow();
	editorHasUnsavedChanges = false;

	mainWindow.on("close", (event) => {
		if (isForceClosing || !editorHasUnsavedChanges) return;

		event.preventDefault();

		const choice = dialog.showMessageBoxSync(mainWindow!, {
			type: "warning",
			buttons: [
				mainT("dialogs", "unsavedChanges.saveAndClose"),
				mainT("dialogs", "unsavedChanges.discardAndClose"),
				mainT("common", "actions.cancel"),
			],
			defaultId: 0,
			cancelId: 2,
			title: mainT("dialogs", "unsavedChanges.title"),
			message: mainT("dialogs", "unsavedChanges.message"),
			detail: mainT("dialogs", "unsavedChanges.detail"),
		});

		const windowToClose = mainWindow;
		if (!windowToClose || windowToClose.isDestroyed()) return;

		if (choice === 0) {
			// Save & Close — tell renderer to save, then close
			windowToClose.webContents.send("request-save-before-close");
			ipcMain.once("save-before-close-done", (_, shouldClose: boolean) => {
				if (!shouldClose) return;
				forceCloseEditorWindow(windowToClose);
			});
		} else if (choice === 1) {
			// Discard & Close
			forceCloseEditorWindow(windowToClose);
		}
		// choice === 2: Cancel — do nothing, window stays open
	});
}

function createSourceSelectorWindowWrapper() {
	sourceSelectorWindow = createSourceSelectorWindow();
	sourceSelectorWindow.on("closed", () => {
		sourceSelectorWindow = null;
	});
	return sourceSelectorWindow;
}

function createCountdownOverlayWindowWrapper() {
	if (countdownOverlayWindow && !countdownOverlayWindow.isDestroyed()) {
		return countdownOverlayWindow;
	}

	countdownOverlayWindow = createCountdownOverlayWindow();
	countdownOverlayWindow.on("closed", () => {
		countdownOverlayWindow = null;
	});
	return countdownOverlayWindow;
}

// On macOS, applications and their menu bar stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
	// Keep app running (macOS behavior)
});

app.on("activate", () => {
	// On OS X it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	const hasVisibleWindow = BrowserWindow.getAllWindows().some((window) => {
		if (window.isDestroyed() || !window.isVisible()) {
			return false;
		}

		const url = window.webContents.getURL();
		const isCountdownOverlayWindow = url.includes("windowType=countdown-overlay");
		return !isCountdownOverlayWindow;
	});
	if (!hasVisibleWindow) {
		showMainWindow();
	}
});

function showLicenseWindow() {
	if (licenseWindow && !licenseWindow.isDestroyed()) {
		licenseWindow.focus();
		return;
	}
	licenseWindow = createLicenseWindow();
	licenseWindow.on("closed", () => {
		licenseWindow = null;
	});
}

function closeLicenseWindow() {
	if (licenseWindow && !licenseWindow.isDestroyed()) {
		const w = licenseWindow;
		licenseWindow = null;
		w.close();
	}
}

ipcMain.handle("license:status", async () => {
	const valid = await hasValidLocalLicense();
	const info = await getLicenseInfo();
	return {
		valid,
		machineId: getMachineId(),
		machineName: getMachineName(),
		buyUrl: LICENSE_BUY_URL,
		license: info,
	};
});

ipcMain.handle("license:activate", async (_, key: string) => {
	const result = await activateLicense(String(key ?? ""));
	if (result.ok) {
		// Close license window (if open) and proceed with normal launch.
		closeLicenseWindow();
		showMainWindow();
	}
	return result;
});

ipcMain.handle("license:open-buy-page", async () => {
	const { shell } = await import("electron");
	await shell.openExternal(LICENSE_BUY_URL);
	return { ok: true };
});

ipcMain.handle("license:deactivate", async () => {
	await deactivateLicense();
	// Close all main windows and pop the license gate.
	for (const w of BrowserWindow.getAllWindows()) {
		if (w !== licenseWindow && !w.isDestroyed()) w.close();
	}
	mainWindow = null;
	showLicenseWindow();
	return { ok: true };
});

ipcMain.handle("annotation:toggle", () => {
	if (annotationOverlayWindow && !annotationOverlayWindow.isDestroyed()) {
		const w = annotationOverlayWindow;
		annotationOverlayWindow = null;
		w.close();
		return { active: false };
	}
	annotationOverlayWindow = createAnnotationOverlayWindow();
	annotationOverlayWindow.on("closed", () => {
		annotationOverlayWindow = null;
	});
	return { active: true };
});

ipcMain.handle("annotation:close", () => {
	if (annotationOverlayWindow && !annotationOverlayWindow.isDestroyed()) {
		const w = annotationOverlayWindow;
		annotationOverlayWindow = null;
		w.close();
	}
	return { ok: true };
});

ipcMain.handle("annotation:set-mouse-passthrough", (_, passthrough: boolean) => {
	if (annotationOverlayWindow && !annotationOverlayWindow.isDestroyed()) {
		annotationOverlayWindow.setIgnoreMouseEvents(passthrough, { forward: true });
	}
	return { ok: true };
});

// Register all IPC handlers when app is ready
app.whenReady().then(async () => {
	// Allow microphone/media permission checks
	session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
		const allowed = ["media", "audioCapture", "microphone", "videoCapture", "camera"];
		return allowed.includes(permission);
	});

	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
		const allowed = ["media", "audioCapture", "microphone", "videoCapture", "camera"];
		callback(allowed.includes(permission));
	});

	// Request microphone permission from macOS
	if (process.platform === "darwin") {
		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (micStatus !== "granted") {
			await systemPreferences.askForMediaAccess("microphone");
		}
	}

	// Listen for HUD overlay quit event (macOS only)
	ipcMain.on("hud-overlay-close", () => {
		app.quit();
	});
	ipcMain.handle("set-locale", (_, locale: string) => {
		setMainLocale(locale);
		setupApplicationMenu();
		updateTrayMenu();
	});

	createTray();
	updateTrayMenu();
	setupApplicationMenu();
	// Ensure recordings directory exists
	await ensureRecordingsDir();

	function switchToHudWrapper() {
		if (mainWindow) {
			isForceClosing = true;
			mainWindow.close();
			isForceClosing = false;
			mainWindow = null;
		}
		showMainWindow();
	}

	registerIpcHandlers(
		createEditorWindowWrapper,
		createSourceSelectorWindowWrapper,
		createCountdownOverlayWindowWrapper,
		() => mainWindow,
		() => sourceSelectorWindow,
		() => countdownOverlayWindow,
		(recording: boolean, sourceName: string) => {
			selectedSourceName = sourceName;
			if (!tray) createTray();
			updateTrayMenu(recording);
			if (!recording) {
				showMainWindow();
			}
		},
		switchToHudWrapper,
	);

	// License gate: if no valid local license, show the license window only.
	// All IPC handlers are already registered above so the gate UI works.
	const licensed = await hasValidLocalLicense();
	if (!licensed) {
		showLicenseWindow();
		return;
	}

	createWindow();

	// Background: heartbeat if due. If the server tells us the license was
	// revoked or the device removed, drop the local license and show the gate.
	// If the server gave us a refreshed token, notify the renderer so it can
	// show a small "license renewed" toast.
	maybeHeartbeat()
		.then((res) => {
			if (!res) return;
			if (res.ok === true) {
				if (res.refreshed) {
					for (const w of BrowserWindow.getAllWindows()) {
						if (!w.isDestroyed()) w.webContents.send("license-refreshed");
					}
				}
				return;
			}
			if ("offline" in res && res.offline) return;
			console.warn("[license] heartbeat rejected:", res.reason);
			clearLicense().then(() => {
				for (const w of BrowserWindow.getAllWindows()) {
					if (!w.isDestroyed()) w.close();
				}
				mainWindow = null;
				showLicenseWindow();
			});
		})
		.catch((err) => console.warn("[license] heartbeat error:", err));
});
