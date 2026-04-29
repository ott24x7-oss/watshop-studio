import {
	BufferTarget,
	EncodedAudioPacketSource,
	EncodedPacket,
	EncodedVideoPacketSource,
	Mp4OutputFormat,
	Output,
	WebMOutputFormat,
} from "mediabunny";
import type { ExportConfig } from "./types";

/**
 * Wraps Mediabunny's `Output` for our two export targets.
 *
 *   Format MP4   →  H.264 (AVC) + AAC, in an .mp4 container with fastStart.
 *   Format WebM  →  VP9 + Opus, in a .webm container.
 *
 * The codec strings used by the encoder are passed in via `config.codec`
 * (selected by the caller in videoExporter.ts); we only tell mediabunny the
 * codec family so it can pick the right packet source.
 */
export class VideoMuxer {
	private output: Output | null = null;
	private videoSource: EncodedVideoPacketSource | null = null;
	private audioSource: EncodedAudioPacketSource | null = null;
	private hasAudio: boolean;
	private target: BufferTarget | null = null;
	private config: ExportConfig;
	private format: "mp4" | "webm";

	constructor(config: ExportConfig, hasAudio = false) {
		this.config = config;
		this.hasAudio = hasAudio;
		this.format = config.format ?? "mp4";
	}

	getFormat(): "mp4" | "webm" {
		return this.format;
	}

	async initialize(): Promise<void> {
		this.target = new BufferTarget();

		this.output = new Output({
			format:
				this.format === "webm"
					? new WebMOutputFormat()
					: new Mp4OutputFormat({ fastStart: "in-memory" }),
			target: this.target,
		});

		// Video codec family for the source. mp4 → "avc"; webm → "vp9".
		this.videoSource = new EncodedVideoPacketSource(this.format === "webm" ? "vp9" : "avc");
		this.output.addVideoTrack(this.videoSource, {
			frameRate: this.config.frameRate,
		});

		if (this.hasAudio) {
			// Both containers can carry Opus, but mp4-Opus is poorly supported by
			// players. Use AAC for mp4, Opus for webm.
			this.audioSource = new EncodedAudioPacketSource(this.format === "webm" ? "opus" : "aac");
			this.output.addAudioTrack(this.audioSource);
		}

		await this.output.start();
	}

	async addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): Promise<void> {
		if (!this.videoSource) {
			throw new Error("Muxer not initialized");
		}
		const packet = EncodedPacket.fromEncodedChunk(chunk);
		await this.videoSource.add(packet, meta);
	}

	async addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): Promise<void> {
		if (!this.audioSource) {
			throw new Error("Audio not configured for this muxer");
		}
		const packet = EncodedPacket.fromEncodedChunk(chunk);
		await this.audioSource.add(packet, meta);
	}

	async finalize(): Promise<Blob> {
		if (!this.output || !this.target) {
			throw new Error("Muxer not initialized");
		}

		await this.output.finalize();
		const buffer = this.target.buffer;

		if (!buffer) {
			throw new Error("Failed to finalize output");
		}

		const mimeType = this.format === "webm" ? "video/webm" : "video/mp4";
		return new Blob([buffer], { type: mimeType });
	}
}
