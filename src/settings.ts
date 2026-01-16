import { App, PluginSettingTab, Setting, Notice, TFolder } from "obsidian";
import HandwritingOCRPlugin from "./main";
import { HandwritingOCRAPI } from "./api";

export interface HandwritingOCRSettings {
	apiKey: string;
	includeThumbnails: boolean;
	noteFolder: string;
	imageFolder: string;
	enableAutoProcessing: boolean;
	watchFolder: string;
	autoProcessingAction: 'new-note' | 'append-source';
}

export const DEFAULT_SETTINGS: HandwritingOCRSettings = {
	apiKey: "",
	includeThumbnails: false,
	noteFolder: "",
	imageFolder: "OCR Thumbnails",
	enableAutoProcessing: false,
	watchFolder: "",
	autoProcessingAction: "new-note"
};

export class HandwritingOCRSettingTab extends PluginSettingTab {
	plugin: HandwritingOCRPlugin;
	private creditDisplay: HTMLElement | null = null;

	constructor(app: App, plugin: HandwritingOCRPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Add introductory text
		const introDiv = containerEl.createDiv({ cls: "handwriting-ocr-intro" });
		
		introDiv.createEl("p", {
			text: "Transform handwritten documents and scanned images into editable text with our AI-powered OCR technology. Perfect for digitizing handwritten notes, converting legacy documents, and making your analog content searchable within Obsidian."
		});
		
		introDiv.createEl("p", {
			text: "Extract text directly to your clipboard, create new notes with formatted content, or append OCR results to your existing notes. Supports PDFs and common image formats (JPG, PNG, TIFF, etc.)."
		});
		
		const ctaP = introDiv.createEl("p");
		ctaP.createEl("span", { text: "Get started with " });
		ctaP.createEl("a", {
			text: "free trial credits",
			href: "https://www.handwritingocr.com/register"
		});
		ctaP.createEl("span", { text: " to test the service." });

		// API Key setting
		new Setting(containerEl)
			.setName("API key")
			.setDesc("Enter your Handwriting OCR API key")
			.addText(text => text
				.setPlaceholder("Enter your API key")
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		// Add a button to validate the API key
		new Setting(containerEl)
			.setName("Validate API key")
			.setDesc("Check if your API key is valid and view your credit balance")
			.addButton(button => button
				.setButtonText("Validate")
				.onClick(async () => {
					await this.validateApiKey();
				}));

		// Credit balance display area
		this.creditDisplay = containerEl.createDiv({ cls: "handwriting-ocr-credit-display" });
		
		// If we have an API key, automatically validate it
		if (this.plugin.settings.apiKey) {
			this.validateApiKey();
		}

		// Note folder setting
		new Setting(containerEl)
			.setName("Note folder")
			.setDesc("Folder where new OCR notes will be created (leave empty for vault root)")
			.addText(text => text
				.setPlaceholder("e.g., OCR Notes")
				.setValue(this.plugin.settings.noteFolder)
				.onChange(async (value) => {
					this.plugin.settings.noteFolder = value.trim();
					await this.plugin.saveSettings();
				}));

		// Thumbnail setting
		new Setting(containerEl)
			.setName("Include thumbnails")
			.setDesc("Include page thumbnails in extracted notes")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.includeThumbnails)
				.onChange(async (value) => {
					this.plugin.settings.includeThumbnails = value;
					await this.plugin.saveSettings();
					
					// Create image folder when enabled
					if (value) {
						await this.createImageFolder();
					}
				}));

		// Image folder setting
		new Setting(containerEl)
			.setName("Image folder")
			.setDesc("Folder where OCR thumbnails will be stored")
			.addText(text => text
				.setPlaceholder("e.g., OCR Thumbnails")
				.setValue(this.plugin.settings.imageFolder)
				.onChange(async (value) => {
					this.plugin.settings.imageFolder = value.trim() || "OCR Thumbnails";
					await this.plugin.saveSettings();
				}));

		// Auto-processing section header
		containerEl.createEl("h3", { text: "Automatic Processing" });
		
		// Enable auto-processing toggle
		new Setting(containerEl)
			.setName("Enable automatic processing")
			.setDesc("Automatically process new files added to the watch folder")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableAutoProcessing)
				.onChange(async (value) => {
					this.plugin.settings.enableAutoProcessing = value;
					await this.plugin.saveSettings();
				}));
		
		// Watch folder setting
		new Setting(containerEl)
			.setName("Watch folder")
			.setDesc("Folder to monitor for new files (leave empty to disable)")
			.addText(text => text
				.setPlaceholder("e.g., Inbox")
				.setValue(this.plugin.settings.watchFolder)
				.onChange(async (value) => {
					this.plugin.settings.watchFolder = value.trim();
					await this.plugin.saveSettings();
				}));
		
		// Auto-processing action setting
		new Setting(containerEl)
			.setName("Auto-processing action")
			.setDesc("What to do with extracted text from auto-processed files")
			.addDropdown(dropdown => dropdown
				.addOption("new-note", "Create new note")
				.addOption("append-source", "Append to source note")
				.setValue(this.plugin.settings.autoProcessingAction)
				.onChange(async (value: 'new-note' | 'append-source') => {
					this.plugin.settings.autoProcessingAction = value;
					await this.plugin.saveSettings();
				}));
		
		// Warning about credits
		containerEl.createDiv({ 
			cls: "setting-item-description", 
			text: "⚠️ Auto-processing consumes credits for each file. Monitor your balance regularly."
		});

		// Add help text
		containerEl.createDiv({ cls: "setting-item-description", text: "Get your API key from " })
			.createEl("a", { 
				text: "handwritingocr.com/settings/api",
				href: "https://www.handwritingocr.com/settings/api"
			});
	}

	private async validateApiKey() {
		if (!this.plugin.settings.apiKey) {
			new Notice("Please enter an API key first");
			return;
		}

		if (!this.creditDisplay) return;

		try {
			this.creditDisplay.setText("Validating API key...");
			
			const api = new HandwritingOCRAPI(this.plugin.settings.apiKey);
			const userInfo = await api.validateApiKey();
			
			// Display success message with credit balance
			this.creditDisplay.empty();
			this.creditDisplay.createEl("div", { 
				text: `✓ API key is valid`,
				cls: "handwriting-ocr-success"
			});
			this.creditDisplay.createEl("div", {
				text: `Account: ${userInfo.name} (${userInfo.email})`,
				cls: "handwriting-ocr-info"
			});
			this.creditDisplay.createEl("div", {
				text: `Credits remaining: ${userInfo.balance}`,
				cls: "handwriting-ocr-info"
			});
			this.creditDisplay.createEl("div", {
				text: `Account type: ${userInfo.type}`,
				cls: "handwriting-ocr-info"
			});
			
			new Notice("API key validated successfully!");
			
		} catch (error) {
			// Display error message
			this.creditDisplay.empty();
			const errorMessage = error.message.toLowerCase().includes('invalid api key') || error.message.includes('401') 
				? 'Invalid API key' 
				: error.message;
			
			this.creditDisplay.createEl("div", { 
				text: `✗ ${errorMessage}`,
				cls: "handwriting-ocr-error"
			});
			
			const noticeMessage = error.message.toLowerCase().includes('invalid api key') || error.message.includes('401')
				? 'API key is invalid. Please check your API key and try again.'
				: `API key validation failed: ${error.message}`;
			
			new Notice(noticeMessage);
		}
	}

	private async createImageFolder() {
		const imageFolder = this.plugin.settings.imageFolder;
		try {
			const folderExists = this.app.vault.getAbstractFileByPath(imageFolder) instanceof TFolder;
			if (!folderExists) {
				await this.app.vault.createFolder(imageFolder);
				new Notice(`Created '${imageFolder}' folder for storing page images`);
			}
		} catch (error) {
			// Folder creation failed silently
		}
	}
}