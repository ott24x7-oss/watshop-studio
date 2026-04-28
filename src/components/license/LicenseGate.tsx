import { useEffect, useRef, useState } from "react";

type Status = Awaited<ReturnType<NonNullable<Window["electronAPI"]>["licenseStatus"]>>;

/**
 * Format the user's typing into WATS-XXXX-XXXX-XXXX-XXXX as they go.
 * Strips invalid chars, uppercases, inserts dashes.
 */
function formatKey(raw: string): string {
	const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
	const prefix = cleaned.startsWith("WATS") ? "WATS" : cleaned.slice(0, 4);
	const rest = cleaned.startsWith("WATS") ? cleaned.slice(4) : cleaned.slice(4);
	const parts: string[] = [];
	for (let i = 0; i < rest.length && parts.length < 4; i += 4) {
		parts.push(rest.slice(i, i + 4));
	}
	return prefix + (parts.length ? "-" + parts.join("-") : "");
}

export function LicenseGate() {
	const [key, setKey] = useState("WATS-");
	const [status, setStatus] = useState<Status | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		window.electronAPI?.licenseStatus().then(setStatus).catch(console.error);
		setTimeout(() => inputRef.current?.focus(), 50);
	}, []);

	const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const next = formatKey(e.target.value);
		setKey(next);
		setError(null);
	};

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!window.electronAPI) return;
		setSubmitting(true);
		setError(null);
		const res = await window.electronAPI.licenseActivate(key.trim());
		if (!res.ok) {
			setError(res.error);
			setSubmitting(false);
			inputRef.current?.focus();
			inputRef.current?.select();
		}
		// On success, the main process closes this window — no further UI work needed.
	};

	const onBuy = async () => {
		await window.electronAPI?.licenseOpenBuyPage();
	};

	return (
		<div style={S.root}>
			<div style={S.inner}>
				<div style={S.brand}>
					<span style={S.dot} />
					<span style={S.brandText}>watshop studio</span>
				</div>

				<h1 style={S.title}>Activate your license</h1>
				<p style={S.subtitle}>
					Enter the license key you received with your purchase. One key activates one PC for life.
				</p>

				<form onSubmit={onSubmit}>
					<label style={S.label}>License key</label>
					<input
						ref={inputRef}
						type="text"
						value={key}
						onChange={onChange}
						placeholder="WATS-XXXX-XXXX-XXXX-XXXX"
						spellCheck={false}
						autoComplete="off"
						style={S.input}
						maxLength={24}
						disabled={submitting}
					/>

					{error && <div style={S.errorBox}>{error}</div>}

					<button
						type="submit"
						disabled={submitting || key.length < 24}
						style={{ ...S.primaryBtn, ...(submitting || key.length < 24 ? S.disabled : null) }}
					>
						{submitting ? "Activating…" : "Activate"}
					</button>
				</form>

				<div style={S.divider}>
					<span style={S.dividerText}>Don't have a key yet?</span>
				</div>

				<button type="button" onClick={onBuy} style={S.ghostBtn}>
					Buy a license at watshop.in →
				</button>

				<div style={S.footer}>
					<div>
						<span style={S.footLabel}>This PC</span>
						<span style={S.footValue}>{status?.machineName ?? "—"}</span>
					</div>
					<div>
						<span style={S.footLabel}>Machine ID</span>
						<span
							style={{
								...S.footValue,
								fontFamily: "ui-monospace, JetBrains Mono, Consolas, monospace",
								fontSize: 10,
							}}
						>
							{status?.machineId ? status.machineId.slice(0, 16) + "…" : "—"}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}

const S: Record<string, React.CSSProperties> = {
	root: {
		minHeight: "100vh",
		width: "100%",
		background: "#0F1F1A",
		color: "#FBFAF7",
		fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		padding: 20,
	},
	inner: {
		width: "100%",
		maxWidth: 380,
	},
	brand: {
		display: "flex",
		alignItems: "center",
		gap: 8,
		marginBottom: 28,
		justifyContent: "center",
	},
	dot: {
		width: 10,
		height: 10,
		borderRadius: 999,
		background: "#34C77B",
		boxShadow: "0 0 12px rgba(52,199,123,0.6)",
	},
	brandText: { fontSize: 14, fontWeight: 600, letterSpacing: 0.2, color: "#F4F1EA" },
	title: { fontSize: 22, fontWeight: 700, letterSpacing: -0.01, marginBottom: 8 },
	subtitle: { fontSize: 13, color: "#5A6B66", lineHeight: 1.5, marginBottom: 24 },
	label: {
		fontSize: 11,
		color: "#5A6B66",
		textTransform: "uppercase",
		letterSpacing: 0.6,
		marginBottom: 6,
		display: "block",
	},
	input: {
		width: "100%",
		padding: "12px 14px",
		background: "rgba(0,0,0,0.25)",
		border: "1px solid rgba(244,241,234,0.10)",
		borderRadius: 10,
		color: "#FBFAF7",
		fontFamily: "ui-monospace, 'JetBrains Mono', Consolas, monospace",
		fontSize: 14,
		letterSpacing: 1.5,
		textAlign: "center",
		outline: "none",
		boxSizing: "border-box",
	},
	errorBox: {
		marginTop: 12,
		padding: "10px 12px",
		background: "rgba(229,72,77,0.10)",
		border: "1px solid rgba(229,72,77,0.40)",
		color: "#FFB4B4",
		borderRadius: 8,
		fontSize: 12,
		lineHeight: 1.5,
	},
	primaryBtn: {
		width: "100%",
		marginTop: 16,
		padding: "12px 18px",
		background: "#34C77B",
		color: "#0F1F1A",
		border: "none",
		borderRadius: 10,
		fontSize: 14,
		fontWeight: 600,
		cursor: "pointer",
		fontFamily: "inherit",
	},
	disabled: { opacity: 0.4, cursor: "not-allowed" },
	divider: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		margin: "24px 0 12px",
		color: "#5A6B66",
		fontSize: 11,
	},
	dividerText: { padding: "0 10px", textTransform: "uppercase", letterSpacing: 0.6 },
	ghostBtn: {
		width: "100%",
		padding: "11px 18px",
		background: "transparent",
		color: "#34C77B",
		border: "1px solid rgba(52,199,123,0.40)",
		borderRadius: 10,
		fontSize: 13,
		fontWeight: 500,
		cursor: "pointer",
		fontFamily: "inherit",
	},
	footer: {
		display: "flex",
		justifyContent: "space-between",
		gap: 16,
		marginTop: 32,
		paddingTop: 20,
		borderTop: "1px solid rgba(244,241,234,0.06)",
		fontSize: 11,
	},
	footLabel: {
		color: "#5A6B66",
		display: "block",
		textTransform: "uppercase",
		letterSpacing: 0.6,
		marginBottom: 4,
	},
	footValue: { color: "#F4F1EA", display: "block" },
};
