import { SupabaseClient, createClient } from "@supabase/supabase-js";

import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";

import { Base64 } from "base64";

// Remember to rename these classes and interfaces!

interface CloudAtlasSettings {
	email: string;
	password: string;
	folder: string;
}

interface SupabaseEvent {
	row_id: number;
	commit_timestamp: string;
	response: string;
}

const DEFAULT_SETTINGS: CloudAtlasSettings = {
	email: "",
	password: "",
	folder: "CloudAtlas",
};

export default class CloudAtlas extends Plugin {
	settings: CloudAtlasSettings;

	async handleInserts(payload: SupabaseEvent, supabase: SupabaseClient) {
		const synced_id = payload.row_id;
		const path =
			"CloudAtlas/CA-" +
			payload.commit_timestamp.replaceAll(":", "") +
			".md";
		const contents = Base64.decode(payload.response);
		// console.log(path, contents);
		await this.app.vault.create(path, contents);
		await supabase
			.from("obsidian_sync")
			.insert([{ last_synced: synced_id }])
			.select();
		new Notice(`Added new note at ${path}`);
	}

	async onload() {
		await this.loadSettings();
		const supabase = createClient(
			"https://auegwhnycfvcbloucmhv.supabase.co",
			"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1ZWd3aG55Y2Z2Y2Jsb3VjbWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTc4MTkzMTIsImV4cCI6MjAxMzM5NTMxMn0.q2GoWOzLHecS8wS8GlpFTxN6kzcIE-Xx4KS7Jkr7-30"
		);

		try {
			this.app.vault.createFolder("CloudAtlas");
		} catch (e) {
			console.log("Could not create folder, it likely already exists");
		}

		await supabase.auth.signInWithPassword({
			email: this.settings.email,
			password: this.settings.password,
		});

		const { data: last_synced, error } = await supabase
			.from("obsidian_last_synced")
			.select("last_synced");

		if (error) {
			new Notice("Error fetching sync status");
			console.log(error);
		}

		// console.log(last_synced);

		let unsynced_rows = [];

		if (last_synced && last_synced.length > 0) {
			const { data: gpt_responses, error } = await supabase
				.from("gpt_responses")
				.select("*")
				.gt("id", last_synced[0].last_synced);
			unsynced_rows = gpt_responses || [];
			if (error) {
				new Notice("Error fetching unsynced rows");
				console.log(error);
			}
		} else {
			const { data: gpt_responses, error } = await supabase
				.from("gpt_responses")
				.select("*");
			unsynced_rows = gpt_responses || [];
			if (error) {
				new Notice("Error fetching unsynced rows");
				console.log(error);
			}
		}

		for (let i = 0; i < unsynced_rows.length; i++) {
			const payload = {
				commit_timestamp: unsynced_rows[i].created_at,
				response: unsynced_rows[i].response,
				row_id: unsynced_rows[i].id,
			};
			await this.handleInserts(payload, supabase);
		}

		supabase
			.channel("supabase_realtime")
			.on(
				"postgres_changes",
				{ event: "INSERT", schema: "public", table: "gpt_responses" },
				async (payload) => {
					const data = {
						commit_timestamp: payload.new.created_at,
						response: payload.new.response,
						row_id: payload.new.id,
					};
					try {
						await this.handleInserts(data, supabase);
					} catch (e) {
						console.log(e);
					}
				}
			)
			.subscribe();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new CloudAtlasSettingsTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class CloudAtlasSettingsTab extends PluginSettingTab {
	plugin: CloudAtlas;

	constructor(app: App, plugin: CloudAtlas) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("email")
			.setDesc("Email used to log into Cloud Atlas")
			.addText((text) =>
				text
					.setPlaceholder("")
					.setValue(this.plugin.settings.email)
					.onChange(async (value) => {
						this.plugin.settings.email = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("password")
			.setDesc("Cloud Atlas password")
			.addText((text) =>
				text
					.setPlaceholder("")
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("folder")
			.setDesc(
				"Folder in your vault to store Cloud Atlas notes, this folder will be created on load"
			)
			.addText((text) =>
				text
					.setPlaceholder("CloudAtlas")
					.setValue(this.plugin.settings.folder)
					.onChange(async (value) => {
						this.plugin.settings.folder = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
