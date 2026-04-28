import { LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type LicenseInfo = {
	licenseKey: string;
	plan: string;
	activatedAt: number;
	lastHeartbeat: number;
};

/**
 * Compact "License" block shown at the bottom of the editor's settings panel.
 * Displays the active license key (masked), and a "Sign out of this PC" button
 * that frees the device slot so the user can move to a new computer.
 */
export function LicenseFooter() {
	const [info, setInfo] = useState<LicenseInfo | null>(null);
	const [signingOut, setSigningOut] = useState(false);

	useEffect(() => {
		let cancelled = false;
		window.electronAPI?.licenseStatus()
			.then((s) => {
				if (cancelled) return;
				if (s.license) setInfo(s.license);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	if (!info) return null;

	// "WATS-A8K3-J2P9-M5Q7-X4R2"  →  "WATS-…-X4R2"
	const masked = (() => {
		const parts = info.licenseKey.split("-");
		if (parts.length < 3) return info.licenseKey;
		return `${parts[0]}-…-${parts[parts.length - 1]}`;
	})();

	const handleSignOut = async () => {
		const ok = window.confirm(
			"Sign out of this PC?\n\nYour license slot will be released so you can activate it on another computer. WatShop Studio will close and re-prompt for the key on next launch.",
		);
		if (!ok) return;
		setSigningOut(true);
		try {
			await window.electronAPI?.licenseDeactivate?.();
			// main process closes all windows + opens license gate; this UI may unmount
		} catch (err) {
			toast.error("Could not sign out. Try again.");
			console.error("[license] deactivate failed:", err);
			setSigningOut(false);
		}
	};

	return (
		<div className="mt-4 pt-3 border-t border-white/5">
			<div className="flex items-center justify-between gap-2 mb-2">
				<div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wider">
					<ShieldCheck className="w-3 h-3 text-[#34C77B]" />
					Licensed
				</div>
				<div className="font-mono text-[10px] text-slate-400" title={info.licenseKey}>
					{masked}
				</div>
			</div>
			<button
				type="button"
				onClick={handleSignOut}
				disabled={signingOut}
				className="w-full flex items-center justify-center gap-1.5 text-[10px] text-slate-500 hover:text-red-400 py-1.5 transition-colors disabled:opacity-50"
			>
				<LogOut className="w-3 h-3" />
				{signingOut ? "Signing out…" : "Sign out of this PC"}
			</button>
		</div>
	);
}
