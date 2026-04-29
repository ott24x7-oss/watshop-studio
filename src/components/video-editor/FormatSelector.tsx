import { Film, Globe, Image } from "lucide-react";
import { useScopedT } from "@/contexts/I18nContext";
import type { ExportFormat } from "@/lib/exporter/types";
import { cn } from "@/lib/utils";

interface FormatSelectorProps {
	selectedFormat: ExportFormat;
	onFormatChange: (format: ExportFormat) => void;
	disabled?: boolean;
}

const formatOptions: Array<{
	value: ExportFormat;
	icon: React.ReactNode;
	label: string;
	description: string;
}> = [
	{ value: "mp4", icon: <Film className="w-5 h-5" />, label: "MP4", description: "H.264 · universal" },
	{ value: "webm", icon: <Globe className="w-5 h-5" />, label: "WebM", description: "VP9 · web-native" },
	{ value: "gif", icon: <Image className="w-5 h-5" />, label: "GIF", description: "animated, no audio" },
];

export function FormatSelector({
	selectedFormat,
	onFormatChange,
	disabled = false,
}: FormatSelectorProps) {
	const t = useScopedT("settings");

	const i18nLabels: Partial<Record<ExportFormat, { label: string; description: string }>> = {
		mp4: { label: t("exportFormat.mp4Video"), description: t("exportFormat.mp4Description") },
		gif: { label: t("exportFormat.gifAnimation"), description: t("exportFormat.gifDescription") },
	};

	return (
		<div className="grid grid-cols-3 gap-2">
			{formatOptions.map((option) => {
				const isSelected = selectedFormat === option.value;
				const labels = i18nLabels[option.value] ?? {
					label: option.label,
					description: option.description,
				};
				return (
					<button
						key={option.value}
						type="button"
						disabled={disabled}
						onClick={() => onFormatChange(option.value)}
						className={cn(
							"relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-200",
							"focus:outline-none focus:ring-2 focus:ring-[#34C77B]/50 focus:ring-offset-2 focus:ring-offset-[#09090b]",
							isSelected
								? "bg-[#34C77B]/10 border-[#34C77B]/50 text-white"
								: "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:border-white/20 hover:text-slate-200",
							disabled && "opacity-50 cursor-not-allowed",
						)}
					>
						<div
							className={cn(
								"w-9 h-9 rounded-full flex items-center justify-center transition-colors",
								isSelected ? "bg-[#34C77B]/20 text-[#34C77B]" : "bg-white/5",
							)}
						>
							{option.icon}
						</div>
						<div className="text-center">
							<div className="font-medium text-sm">{labels.label}</div>
							<div className="text-[10px] text-slate-500 mt-0.5 leading-tight">
								{labels.description}
							</div>
						</div>
						{isSelected && (
							<div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#34C77B]" />
						)}
					</button>
				);
			})}
		</div>
	);
}
