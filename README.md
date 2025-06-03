# PlanSyncGo for Obsidian

Welcome to PlanSyncGo! This plugin for Obsidian helps you plan your day by displaying your Google Calendar events as a visual timeline directly within Obsidian and enabling synchronization of your Obsidian tasks with your Google Calendar.
[cite: 666]
## Screenshots

# With IDs
![Screenshot](./Assets/screenshot.png)

## Features

* **Google Calendar Integration:**
    * Secure authentication via OAuth 2.0. [cite: 667]
    * Support for a primary and optionally a secondary (work) calendar. [cite: 668]
    * Automatic token renewal. [cite: 668]
* **Sidebar Timeline View:**
    * Graphical, block-based timeline for the date of the active daily note. [cite: 669]
    * Configurable start and end hours. [cite: 670]
    * 15-minute grid lines and labels for detailed planning. [cite: 670]
    * Automatic layout adjustment for overlapping events. [cite: 671]
    * Red line indicator for the current time (on the current day only). [cite: 671]
    * Configurable colors for different event types. [cite: 672]
    * Creates the view directly below the Calendar plugin. [cite: 672]
    * If the Calendar Plugin is not installed, the Timeline will be in its own side panel. [cite: 673]
* **Task Synchronization (2-way, with Obsidian as the source of truth for content/time):**
    * Synchronize Obsidian tasks with Google Calendar (create, update, delete). [cite: 674]
    * Task detection via the Obsidian Tasks Plugin (recommended) or manual parsing. [cite: 675]
    * Support for sync tags (e.g., `#gcal`), date (`📅YYYY-MM-DD`), time (`⏰ HH:MM`), and duration (`[duration::NNN]`) specifications. [cite: 676]
    * If an event created by PlanSyncGo is deleted in Google Calendar, the linked Obsidian task is marked as completed. [cite: 677]
* **In-Note Timeline (Optional):**
    * Generates a text-based timeline directly into your daily note. [cite: 678]
* **Configurable Daily Notes Folder:**
    * Define the folder where your daily notes are located. [cite: 679]
* **Flexibility:**
    * Creates empty daily notes to ensure full compatibility with templating plugins. [cite: 680]
## Installation

**Manual Installation (Current Method):**

1.  Download the latest `plansyncgo.zip` from the [Releases page on GitHub](https://github.com/TheQuZang/plansyncgo/releases). (Assuming new zip name and repo URL) [cite: 681]
2.  Unzip the `plansyncgo.zip` file. You will get `main.js`, `styles.css`, and `manifest.json`. [cite: 682]
3.  In your Obsidian vault, create a new folder under `.obsidian/plugins/plansyncgo`. [cite: 683]
4.  Copy the three unzipped files (`main.js`, `styles.css`, `manifest.json`) into this newly created `.obsidian/plugins/plansyncgo/` folder. [cite: 684]
5.  Open Obsidian, go to `Settings` -> `Community Plugins`, find "PlanSyncGo" in the list of installed plugins, and enable it using the toggle switch. [cite: 685]
## Setup and Configuration

After installation, you need to configure the plugin to allow it to communicate with your Google Calendar.
[cite: 686]
**1. Create Google Cloud Project and OAuth 2.0 Credentials:**

For PlanSyncGo to access your Google Calendar, you must create your own project in the Google Cloud Console and generate OAuth 2.0 credentials (Client ID and Client Secret).
[cite: 687]
* **Important:** When creating credentials, select "Desktop app" as the application type. [cite: 688]
* You can find a detailed guide on how to create these credentials here: [Setting up OAuth 2.0](https://support.google.com/googleapi/answer/6158849?hl=de). [cite: 689]

**2. Configure PlanSyncGo Plugin Settings in Obsidian:**

Go to `Settings` -> `Community Plugins` -> `PlanSyncGo` in Obsidian. [cite: 690]
* **Google OAuth Client ID:** Enter the Client ID you created in the Google Cloud Console. [cite: 691]
* **Google OAuth Client Secret:** Enter the Client Secret. [cite: 692]
* **Daily Notes Folder:** Specify the path to your daily notes folder (e.g., `Daily_Notes` or `Journal/Daily`). [cite: 692]
* Leave blank if your daily notes are in the vault root. [cite: 693]
* **Connect to Google Calendar:** Click this button and follow the prompts to connect PlanSyncGo to your Google Account. [cite: 694]
* **Main Calendar ID:** Enter the ID of your primary Google Calendar (often your email address). [cite: 695]
* **(Optional) Work Calendar:** Enable and configure a second calendar. [cite: 696]
* **Other Settings:** Customize colors, sync behavior, timeline hours, etc., according to your preferences. [cite: 697]
## Usage

* **Sidebar Timeline:** Opens automatically when you open a daily note (that matches the configured folder and the `YYYY-MM-DD*.md` naming pattern). [cite: 698]
* **Commands (via the Command Palette `Ctrl/Cmd+P`):** [cite: 699]
    * `PlanSyncGo: Open Daily Note for PlanSyncGo`: Opens today's daily note (creates it if it doesn't exist) in the configured folder. [cite: 699]
    * `PlanSyncGo: Sync Tasks with Google Calendar (PlanSyncGo)`: Synchronizes tasks in the **currently active file**. [cite: 700]
    * `PlanSyncGo: Open PlanSyncGo Timeline View (Sidebar)`: Opens the sidebar view manually. [cite: 701]
**Task Syntax for Synchronization:**

To synchronize a task with Google Calendar, it must:
1.  Contain the sync tag specified in the settings (default: `#gcal`) OR the inline field `[sync::true]`. [cite: 702]
2.  Have a date (`📅YYYY-MM-DD`) and a time (`⏰ HH:MM`). [cite: 703]
    * If a task is in a daily note and only has a time, the date of the daily note will be used. [cite: 704]
3.  Optionally, a duration in minutes: `[duration::60]`. [cite: 705]

Example (with Tasks Plugin):
`- [ ] Important call 📅 2025-06-02 ⏰ 14:30 #gcal [duration::30]`

## Hide IDs
![Screenshot - hidden ids](./Assets/screenshot_hidden_ids.png)
To reduce visual clutter, you can hide the IDs of the synced tasks.
Download the [hide-task-metadata.css](./hide_id_css/hide-task-metadata.css) and apply it in your Vault in the "Appearance" settings. [cite: 706]
They are still there (and essential!) and visible in Source Mode, but hidden in Live Preview and Reading Mode. [cite: 707]
## Inspiration & Mentions

* The design of the daily timeline view is inspired by layouts seen in apps like Noteplan, aiming to bring a similar productive overview to Obsidian. [cite: 708]
* Thanks to the Tasks and Calendar plugins! [cite: 709]

## License

This plugin is released under the **MIT License**. [cite: 709]
See the `LICENSE` file for details. [cite: 710]
In short: You are free to do almost anything you want with the software, as long as you include the original copyright and license notice. [cite: 710]
It's provided "AS IS", without warranty. [cite: 711]

## Author

TheQuZang
(https://github.com/TheQuZang)

---
