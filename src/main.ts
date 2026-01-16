import { Editor, Notice, Plugin, TFile, TFolder, MenuItem, setIcon, EventRef } from "obsidian";
import { HandwritingOCRSettings, DEFAULT_SETTINGS, HandwritingOCRSettingTab } from "./settings";
import { HandwritingOCRAPI } from "./api";
import { extractFilePathFromSelection, getFileFromPath, fileToBlob, validateFileSize } from "./utils";
import { ProcessingQueue } from "./queue";
import { AutoProcessor } from "./auto-processor";

export default class HandwritingOCRPlugin extends Plugin {
	settings: HandwritingOCRSettings;
	api: HandwritingOCRAPI | null = null;
	processingQueue: ProcessingQueue;
	autoProcessor: AutoProcessor | null = null;
	private vaultCreateListener: EventRef | null = null;
	private vaultModifyListener: EventRef | null = null;

	async onload() {
		await this.loadSettings();

		// Initialize API if we have a key
		if (this.settings.apiKey) {
			this.api = new HandwritingOCRAPI(this.settings.apiKey);
		}

		// Create image folder if thumbnails are enabled
		if (this.settings.includeThumbnails) {
			await this.createImageFolderIfNeeded();
		}

		// Add commands
		this.addCommand({
			id: "replace-selection",
			name: "Replace selection",
			editorCallback: (editor: Editor) => {
				this.processSelection(editor, "replace");
			}
		});

		this.addCommand({
			id: "append-to-selection",
			name: "Append to selection",
			editorCallback: (editor: Editor) => {
				this.processSelection(editor, "append");
			}
		});

		// Add context menu
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFile && this.isSupportedFile(file)) {
					// Add separator before our menu items
					menu.addSeparator();

					menu.addItem((item: MenuItem) => {
						item
							.setTitle("Extract text to clipboard (Handwriting OCR)")
							.setIcon("clipboard-copy")
							.onClick(async () => {
								await this.extractToClipboard(file);
							});
					});

					menu.addItem((item: MenuItem) => {
						item
							.setTitle("Extract to new note (Handwriting OCR)")
							.setIcon("file-plus")
							.onClick(async () => {
								await this.extractToNewNote(file);
							});
					});

					menu.addItem((item: MenuItem) => {
						item
							.setTitle("Append OCR to active note (Handwriting OCR)")
							.setIcon("file-plus-2")
							.onClick(async () => {
								await this.appendToActiveNote(file);
							});
					});
				}
			})
		);

		// Initialize processing queue
		this.processingQueue = new ProcessingQueue(async (file) => {
			if (this.autoProcessor) {
				await this.autoProcessor.processFile(
					file,
					(f) => this.extractToNewNote(f),
					(f) => this.appendToSourceNote(f)
				);
			}
		});

		// Initialize auto-processor if enabled
		this.initializeAutoProcessor();

		// Add settings tab
		this.addSettingTab(new HandwritingOCRSettingTab(this.app, this));
	}

	onunload() {
		this.cleanupAutoProcessor();
		this.processingQueue.clear();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update API instance when settings change
		if (this.settings.apiKey) {
			this.api = new HandwritingOCRAPI(this.settings.apiKey);
		} else {
			this.api = null;
		}
		// Reinitialize auto-processor when settings change
		this.initializeAutoProcessor();
	}

	private initializeAutoProcessor() {
		this.cleanupAutoProcessor();
		
		if (this.settings.enableAutoProcessing && this.settings.watchFolder) {
			this.autoProcessor = new AutoProcessor(this.app, this.settings);
			
			// Defer vault event registration to avoid processing on startup
			// This prevents re-processing files when Obsidian restarts
			setTimeout(() => {
				// Register vault event listeners
				this.vaultCreateListener = this.app.vault.on('create', async (file) => {
					if (file instanceof TFile && this.autoProcessor) {
						if (await this.autoProcessor.shouldProcess(file)) {
							this.processingQueue.add(file);
						}
					}
				});
				
				this.vaultModifyListener = this.app.vault.on('modify', async (file) => {
					if (file instanceof TFile && this.autoProcessor) {
						if (await this.autoProcessor.shouldProcess(file)) {
							this.processingQueue.add(file);
						}
					}
				});
			}, 1000);
		}
	}
	
	private cleanupAutoProcessor() {
		if (this.vaultCreateListener) {
			this.app.vault.offref(this.vaultCreateListener);
			this.vaultCreateListener = null;
		}
		if (this.vaultModifyListener) {
			this.app.vault.offref(this.vaultModifyListener);
			this.vaultModifyListener = null;
		}
		this.autoProcessor = null;
	}

	private isSupportedFile(file: TFile): boolean {
		const supportedExtensions = [
			'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 
			'heic', 'webp', 'pdf'
		];
		return supportedExtensions.includes(file.extension.toLowerCase());
	}

	private getUserFriendlyErrorMessage(error: Error): string {
		const message = error.message.toLowerCase();
		
		// API key related errors
		if (message.includes('invalid api key') || message.includes('401') || message.includes('unauthorized')) {
			return "API key invalid. Please update your API key in plugin settings.";
		}
		
		// Credit/subscription related errors
		if (message.includes('insufficient credits') || message.includes('403')) {
			return "Insufficient credits. Please check your account balance or upgrade your plan.";
		}
		
		// File format errors
		if (message.includes('unsupported file type') || message.includes('415')) {
			return "Unsupported file format. Please use JPG, PNG, PDF, or other supported image formats.";
		}
		
		// File size errors
		if (message.includes('file too large') || message.includes('413')) {
			return "File too large. Maximum file size is 20MB.";
		}
		
		// Network/timeout errors
		if (message.includes('timeout') || message.includes('processing timeout')) {
			return "Processing timeout. The document may be too complex or the service is busy. Please try again.";
		}
		
		// Network errors
		if (message.includes('network') || message.includes('fetch')) {
			return "Network error. Please check your internet connection and try again.";
		}
		
		// Default fallback with original message
		return `OCR failed: ${error.message}`;
	}

	private async processSelection(editor: Editor, mode: "replace" | "append") {
		if (!this.api) {
			new Notice("Please configure your API key in settings");
			return;
		}

		const selection = editor.getSelection();
		if (!selection) {
			new Notice("Please select an image or PDF link");
			return;
		}

		const filePath = extractFilePathFromSelection(selection);
		if (!filePath) {
			new Notice("Could not extract file path from selection");
			return;
		}

		const file = await getFileFromPath(this.app, filePath);
		if (!file) {
			new Notice("File not found in vault");
			return;
		}

		if (!validateFileSize(file)) {
			new Notice("File too large (max 20MB)");
			return;
		}

		const notice = new Notice("Processing with Handwriting OCR...", 0);
		// Add spinner icon to notice
		notice.messageEl.prepend(this.createSpinnerIcon());
		
		try {
			const fileBlob = await fileToBlob(this.app, file);
			const result = await this.api.processDocument(fileBlob);
			
			// Combine all page transcripts for editor insertion
			const text = result.results.map(page => page.transcript).join('\n\n');
			
			notice.hide();

			if (mode === "replace") {
				editor.replaceSelection(text);
			} else {
				editor.replaceSelection(`${selection}\n\n${text}`);
			}

			new Notice("Text extracted successfully!");

		} catch (error) {
			notice.hide();
			new Notice(this.getUserFriendlyErrorMessage(error));
		}
	}

	private async extractToClipboard(file: TFile) {
		if (!this.api) {
			new Notice("Please configure your API key in settings");
			return;
		}

		if (!validateFileSize(file)) {
			new Notice("File too large (max 20MB)");
			return;
		}

		const notice = new Notice("Processing with Handwriting OCR...", 0);
		// Add spinner icon to notice
		notice.messageEl.prepend(this.createSpinnerIcon());
		
		try {
			const fileBlob = await fileToBlob(this.app, file);
			const result = await this.api.processDocument(fileBlob);
			
			// Combine all page transcripts for clipboard
			const text = result.results.map(page => page.transcript).join('\n\n');
			
			notice.hide();

			await navigator.clipboard.writeText(text);
			new Notice("Text copied to clipboard!");

		} catch (error) {
			notice.hide();
			new Notice(this.getUserFriendlyErrorMessage(error));
		}
	}

	private async extractToNewNote(file: TFile) {
		if (!this.api) {
			new Notice("Please configure your API key in settings");
			return;
		}

		if (!validateFileSize(file)) {
			new Notice("File too large (max 20MB)");
			return;
		}

		const notice = new Notice("Processing with Handwriting OCR...", 0);
		// Add spinner icon to notice
		notice.messageEl.prepend(this.createSpinnerIcon());
		
		try {
			const fileBlob = await fileToBlob(this.app, file);
			const result = await this.api.processDocument(fileBlob);
			
			notice.hide();

			// Create note content with pages and optional thumbnails
			let noteContent = `# OCR Extract from ${file.basename}\n\n`;
			const noteName = `OCR - ${file.basename.replace(/\.[^/.]+$/, "")}`;
			
			for (const pageResult of result.results) {
				if (this.settings.includeThumbnails && result.thumbnails) {
					const thumbnail = result.thumbnails.find(t => t.page_number === pageResult.page_number);
					if (thumbnail) {
						// Download and save thumbnail locally
						try {
							const thumbnailData = await this.api.downloadThumbnail(thumbnail.url);
							const thumbnailPath = await this.saveThumbnail(thumbnailData, noteName, pageResult.page_number);
							
							// Use Obsidian's wiki-link format for better compatibility
							noteContent += `## Page ${pageResult.page_number}\n\n![[${thumbnailPath}]]\n\n`;
						} catch (error) {
							noteContent += `## Page ${pageResult.page_number}\n\n`;
						}
					}
				} else {
					noteContent += `## Page ${pageResult.page_number}\n\n`;
				}
				noteContent += `${pageResult.transcript}\n\n`;
			}
			
			noteContent += `---\n\nSource: [[${file.path}]]`;
			
			// Small delay to ensure all thumbnails are saved before creating the note
			await new Promise(resolve => setTimeout(resolve, 100));
			
			// Determine note path based on settings
			let notePath = this.settings.noteFolder 
				? `${this.settings.noteFolder}/${noteName}.md`
				: `${noteName}.md`;
			
			// Ensure note folder exists
			if (this.settings.noteFolder) {
				const folderExists = this.app.vault.getAbstractFileByPath(this.settings.noteFolder) instanceof TFolder;
				if (!folderExists) {
					await this.app.vault.createFolder(this.settings.noteFolder);
				}
			}
			
			// Check if file already exists and find unique name
			let counter = 1;
			let basePath = notePath;
			while (this.app.vault.getAbstractFileByPath(notePath)) {
				const baseFolder = this.settings.noteFolder || '';
				const nameWithCounter = `${noteName} ${counter}`;
				notePath = baseFolder 
					? `${baseFolder}/${nameWithCounter}.md`
					: `${nameWithCounter}.md`;
				counter++;
			}
			
			const newFile = await this.app.vault.create(
				notePath,
				noteContent
			);

			// Open the new note
			await this.app.workspace.getLeaf().openFile(newFile);
			
			new Notice("Text extracted to new note!");

		} catch (error) {
			notice.hide();
			new Notice(this.getUserFriendlyErrorMessage(error));
		}
	}

	private async saveThumbnail(thumbnailData: ArrayBuffer, noteName: string, pageNumber: number): Promise<string> {
		// Create image folder if it doesn't exist
		const imageFolder = this.settings.imageFolder;
		const folderExists = this.app.vault.getAbstractFileByPath(imageFolder) instanceof TFolder;
		if (!folderExists) {
			await this.app.vault.createFolder(imageFolder);
		}

		// Create subfolder for this document
		const docFolder = `${imageFolder}/${noteName}`;
		const docFolderExists = this.app.vault.getAbstractFileByPath(docFolder) instanceof TFolder;
		if (!docFolderExists) {
			await this.app.vault.createFolder(docFolder);
		}

		// Save thumbnail image
		const thumbnailPath = `${docFolder}/page-${pageNumber}.jpg`;
		await this.app.vault.adapter.writeBinary(thumbnailPath, thumbnailData);
		
		return thumbnailPath;
	}

	private async createImageFolderIfNeeded() {
		const imageFolder = this.settings.imageFolder;
		try {
			const folderExists = this.app.vault.getAbstractFileByPath(imageFolder) instanceof TFolder;
			if (!folderExists) {
				await this.app.vault.createFolder(imageFolder);
			}
		} catch (error) {
			// Folder creation failed, but don't interrupt the flow
		}
	}

	private async appendToActiveNote(file: TFile) {
		if (!this.api) {
			new Notice("Please configure your API key in settings");
			return;
		}

		// Check if there's an active note
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("No active note to append to");
			return;
		}

		if (!validateFileSize(file)) {
			new Notice("File too large (max 20MB)");
			return;
		}

		const notice = new Notice("Processing with Handwriting OCR...", 0);
		// Add spinner icon to notice
		notice.messageEl.prepend(this.createSpinnerIcon());
		
		try {
			const fileBlob = await fileToBlob(this.app, file);
			const result = await this.api.processDocument(fileBlob);
			
			notice.hide();

			// Create append content with pages and optional thumbnails
			let appendContent = `\n\n---\n\n# OCR Extract from ${file.basename}\n\n`;
			
			for (const pageResult of result.results) {
				if (this.settings.includeThumbnails && result.thumbnails) {
					const thumbnail = result.thumbnails.find(t => t.page_number === pageResult.page_number);
					if (thumbnail) {
						try {
							const thumbnailData = await this.api.downloadThumbnail(thumbnail.url);
							const thumbnailPath = await this.saveThumbnail(thumbnailData, `${file.basename}-append`, pageResult.page_number);
							
							appendContent += `## Page ${pageResult.page_number}\n\n![[${thumbnailPath}]]\n\n`;
						} catch (error) {
							appendContent += `## Page ${pageResult.page_number}\n\n`;
						}
					}
				} else {
					appendContent += `## Page ${pageResult.page_number}\n\n`;
				}
				appendContent += `${pageResult.transcript}\n\n`;
			}
			
			appendContent += `Source: [[${file.path}]]`;
			
			// Append to the active note
			await this.app.vault.append(activeFile, appendContent);
			
			new Notice("Text appended to active note!");

		} catch (error) {
			notice.hide();
			new Notice(this.getUserFriendlyErrorMessage(error));
		}
	}

	private async appendToSourceNote(file: TFile) {
		if (!this.api) {
			new Notice("Please configure your API key in settings");
			return;
		}

		if (!validateFileSize(file)) {
			new Notice("File too large (max 20MB)");
			return;
		}

		const notice = new Notice("Processing with Handwriting OCR...", 0);
		notice.messageEl.prepend(this.createSpinnerIcon());
		
		try {
			const fileBlob = await fileToBlob(this.app, file);
			const result = await this.api.processDocument(fileBlob);
			
			notice.hide();

			// Determine companion note path
			const baseName = file.basename;
			const dirPath = file.parent?.path || '';
			const notePath = dirPath ? `${dirPath}/${baseName}.md` : `${baseName}.md`;
			
			// Create append content
			let appendContent = '';
			let existingNote = this.app.vault.getAbstractFileByPath(notePath);
			
			if (existingNote instanceof TFile) {
				// Append to existing note
				appendContent = `\n\n---\n\n# OCR Extract from ${file.basename}\n\n`;
			} else {
				// Create new note with header
				appendContent = `# ${baseName}\n\n`;
			}
			
			for (const pageResult of result.results) {
				if (this.settings.includeThumbnails && result.thumbnails) {
					const thumbnail = result.thumbnails.find(t => t.page_number === pageResult.page_number);
					if (thumbnail) {
						try {
							const thumbnailData = await this.api.downloadThumbnail(thumbnail.url);
							const thumbnailPath = await this.saveThumbnail(thumbnailData, baseName, pageResult.page_number);
							
							appendContent += `## Page ${pageResult.page_number}\n\n![[${thumbnailPath}]]\n\n`;
						} catch (error) {
							appendContent += `## Page ${pageResult.page_number}\n\n`;
						}
					}
				} else {
					appendContent += `## Page ${pageResult.page_number}\n\n`;
				}
				appendContent += `${pageResult.transcript}\n\n`;
			}
			
			appendContent += `Source: [[${file.path}]]`;
			
			if (existingNote instanceof TFile) {
				await this.app.vault.append(existingNote, appendContent);
			} else {
				// Check if metadata indicates already processed to avoid duplicate content
				if (this.autoProcessor && await this.autoProcessor.isProcessed(file)) {
					new Notice("File already processed, skipping");
					return;
				}
				await this.app.vault.create(notePath, appendContent);
			}
			
			new Notice("Text appended to source note!");

		} catch (error) {
			notice.hide();
			new Notice(this.getUserFriendlyErrorMessage(error));
		}
	}

	private createSpinnerIcon(): HTMLElement {
		const spinnerContainer = document.createElement("span");
		spinnerContainer.addClass("handwriting-ocr-spinner");
		
		// Use Obsidian's built-in loader-circle icon
		setIcon(spinnerContainer, "loader-circle");
		
		return spinnerContainer;
	}
}
