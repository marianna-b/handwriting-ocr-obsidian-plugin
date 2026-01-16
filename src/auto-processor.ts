import { App, TFile, Notice } from "obsidian";
import { HandwritingOCRSettings } from "./settings";
import { getFileHash, getMetadataFilePath, ProcessedMetadata, validateFileSize } from "./utils";
import { DocumentResult } from "./api";

export class AutoProcessor {
	constructor(
		private app: App,
		private settings: HandwritingOCRSettings
	) {}

	async shouldProcess(file: TFile): Promise<boolean> {
		if (!this.settings.enableAutoProcessing || !this.settings.watchFolder) {
			return false;
		}

		if (!this.isInWatchFolder(file)) {
			return false;
		}

		if (!this.isSupportedFile(file)) {
			return false;
		}

		if (!validateFileSize(file)) {
			return false;
		}

		const isProcessed = await this.isProcessed(file);
		return !isProcessed;
	}

	private isInWatchFolder(file: TFile): boolean {
		const watchFolder = this.settings.watchFolder.replace(/^\/+|\/+$/g, '');
		const filePath = file.path;
		
		return filePath.startsWith(watchFolder + '/') || 
		       filePath.startsWith(watchFolder) && file.parent?.path === watchFolder;
	}

	private isSupportedFile(file: TFile): boolean {
		const supportedExtensions = [
			'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 
			'heic', 'webp', 'pdf'
		];
		return supportedExtensions.includes(file.extension.toLowerCase());
	}

	public async isProcessed(file: TFile): Promise<boolean> {
		const metadataPath = getMetadataFilePath(file);
		const metadataFile = this.app.vault.getAbstractFileByPath(metadataPath);
		
		if (!(metadataFile instanceof TFile)) {
			return false;
		}

		try {
			const content = await this.app.vault.read(metadataFile);
			const metadata: ProcessedMetadata = JSON.parse(content);
			
			const currentHash = getFileHash(file);
			return metadata.fileHash === currentHash && metadata.status === 'success';
		} catch (error) {
			return false;
		}
	}

	async markAsProcessed(file: TFile, status: 'success' | 'error', errorMessage?: string): Promise<void> {
		const metadataPath = getMetadataFilePath(file);
		const metadata: ProcessedMetadata = {
			processedAt: Date.now(),
			fileHash: getFileHash(file),
			status,
			errorMessage
		};

		try {
			const existingFile = this.app.vault.getAbstractFileByPath(metadataPath);
			if (existingFile instanceof TFile) {
				await this.app.vault.modify(existingFile, JSON.stringify(metadata, null, 2));
			} else {
				await this.app.vault.create(metadataPath, JSON.stringify(metadata, null, 2));
			}
		} catch (error) {
			console.error(`Failed to create metadata file for ${file.path}:`, error);
		}
	}

	async processFile(
		file: TFile,
		extractToNewNote: (file: TFile) => Promise<void>,
		appendToSourceNote: (file: TFile) => Promise<void>
	): Promise<void> {
		try {
			new Notice(`Auto-processing: ${file.name}`);
			
			if (this.settings.autoProcessingAction === 'new-note') {
				await extractToNewNote(file);
			} else {
				await appendToSourceNote(file);
			}
			
			await this.markAsProcessed(file, 'success');
		} catch (error) {
			console.error(`Auto-processing failed for ${file.path}:`, error);
			await this.markAsProcessed(file, 'error', error.message);
			throw error;
		}
	}
}
