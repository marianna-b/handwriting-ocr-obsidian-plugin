import { TFile } from "obsidian";

export class ProcessingQueue {
	private queue: TFile[] = [];
	private processing = false;
	private onProcess: (file: TFile) => Promise<void>;

	constructor(onProcess: (file: TFile) => Promise<void>) {
		this.onProcess = onProcess;
	}

	add(file: TFile): void {
		if (this.queue.find(f => f.path === file.path)) {
			return;
		}
		
		this.queue.push(file);
		
		if (!this.processing) {
			this.processNext();
		}
	}

	private async processNext(): Promise<void> {
		if (this.queue.length === 0) {
			this.processing = false;
			return;
		}

		this.processing = true;
		const file = this.queue.shift();

		if (file) {
			try {
				await this.onProcess(file);
			} catch (error) {
				console.error(`Failed to process ${file.path}:`, error);
			}
		}

		await this.processNext();
	}

	clear(): void {
		this.queue = [];
		this.processing = false;
	}

	getQueueLength(): number {
		return this.queue.length;
	}
}
