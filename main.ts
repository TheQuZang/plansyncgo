import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, Modal, moment, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { PlanSyncGoTimelineView, PLANSYNCGO_TIMELINE_VIEW_TYPE } from './TimelineView'; // MODIFIED

export interface TimelineSettings {
    googleCalendarApiKey: string;
    calendarId: string;
    workCalendarId: string;
    enableWorkCalendar: boolean;
    timelineStartHour: number;
    timelineEndHour: number;
    autoSyncToCalendar: boolean;
    defaultEventDuration: number;
    autoRefreshInterval: number;
    enableSmartRefresh: boolean;
    lastSyncTimestamp: number;
    googleOAuthClientId: string;
    googleOAuthClientSecret: string;
    googleOAuthAccessToken: string;
    googleOAuthRefreshToken: string;
    googleOAuthTokenExpiry: number;
    tasksPluginSyncTag: string;
    obsidianTaskEventColor: string;
    obsidianTaskEventTextColor: string;
    googleCalendarEventColor: string;
    googleCalendarEventTextColor: string;
    enableInNoteTimeline: boolean;
    dailyNoteFolder: string;
}

export interface CalendarEvent {
    id: string;
    title: string;
    start: string;
    end: string;
    description?: string;
    isFromCalendar: boolean;
    syncToCalendar?: boolean;
    obsidianTaskIdFromDescription?: string;
}

interface TimelineTask {
    id: string;
    originalMarkdown: string;
    lineNumber: number;
    obsidianTaskId?: string;
    content: string;
    time?: string;
    date?: string;
    duration?: number;
    completed: boolean;
    syncToCalendar: boolean;
    calendarEventId?: string;
    path: string;
}

interface ApiTask {
    description: string;
    status: { indicator: string };
    originalMarkdown: string;
    path: string;
    lineNumber: number;
    blockLink?: string;
    tags: string[];
    dueDate: moment.Moment | null;
    scheduledDate: moment.Moment | null;
    startDate: moment.Moment | null;
    doneDate: moment.Moment | null;
    happens: {
        moment: moment.Moment | null;
        date: moment.Moment | null;
        time: moment.Moment |
        null;
    } | null;
}

const DEFAULT_SETTINGS: TimelineSettings = {
    googleCalendarApiKey: '',
    calendarId: '',
    workCalendarId: '',
    enableWorkCalendar: false,
    timelineStartHour: 6,
    timelineEndHour: 22,
    autoSyncToCalendar: false,
    defaultEventDuration: 60,
    autoRefreshInterval: 300,
    enableSmartRefresh: true,
    lastSyncTimestamp: 0,
    googleOAuthClientId: '',
    googleOAuthClientSecret: '',
    googleOAuthAccessToken: '',
    googleOAuthRefreshToken: '',
    googleOAuthTokenExpiry: 0,
    tasksPluginSyncTag: '#gcal',
    obsidianTaskEventColor: '#8A2BE2',
    obsidianTaskEventTextColor: '#FFFFFF',
    googleCalendarEventColor: '#A0D2DB',
    googleCalendarEventTextColor: '#1A1A1A',
    enableInNoteTimeline: false,
    dailyNoteFolder: '',
};
export default class PlanSyncGoPlugin extends Plugin { // MODIFIED
    settings: TimelineSettings;
    refreshInterval: number;
    lastKnownEvents: Map<string, CalendarEvent[]> = new Map();
    tasksPluginApi: any = null;
    private hasAttemptedDefinitiveApiLoad: boolean = false;

    async onload() {
        await this.loadSettings();
        this.tryLoadTasksPluginApi(false);

        this.addCommand({
            id: 'open-daily-timeline',
            name: 'Open Daily Note for PlanSyncGo', // MODIFIED
            callback: () => this.openDailyTimeline()
        });
        this.addCommand({
            id: 'sync-calendar',
            name: 'Sync Tasks with Google Calendar (PlanSyncGo)', // MODIFIED
            callback: () => this.syncObsidianTasksToCalendar()
        });
        this.addCommand({
            id: 'refresh-timeline',
            name: 'Refresh In-Note Timeline (PlanSyncGo)', // MODIFIED
            callback: () => this.forceRefreshInNoteTimeline()
        });
        this.addCommand({
            id: 'google-oauth-start',
            name: 'Connect/Reconnect to Google Calendar (PlanSyncGo)', // MODIFIED
            callback: () => this.startGoogleOAuth()
        });
        this.addCommand({
            id: 'open-plansyncgo-timeline-view', // MODIFIED
            name: 'Open PlanSyncGo Timeline View (Sidebar)', // MODIFIED
            callback: () => {
                this.activateView();
            }
        });
        this.addSettingTab(new PlanSyncGoSettingTab(this.app, this)); // MODIFIED

        this.registerView(
            PLANSYNCGO_TIMELINE_VIEW_TYPE, // MODIFIED
            (leaf) => new PlanSyncGoTimelineView(leaf, this) // MODIFIED
        );
        this.registerEvent(
            this.app.vault.on('modify', (file: TAbstractFile) => {
                if (file instanceof TFile && this.isDailyNote(file) && this.settings.enableSmartRefresh) {
                    this.handleDailyNoteChange(file);
                }
            })
        );
        if (this.settings.enableSmartRefresh) {
            this.startAutoRefresh();
        }

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile && this.isDailyNote(activeFile) && this.settings.enableSmartRefresh) {
                    this.smartRefreshIfNeeded(activeFile);
                }
            })
        );
        if (this.settings.googleOAuthRefreshToken &&
            (!this.settings.googleOAuthAccessToken || this.settings.googleOAuthTokenExpiry <= Date.now())) {
            try {
                new Notice('Attempting to refresh Google Access Token on startup...', 3000);
                await this.getValidAccessToken();
                new Notice('Google Access Token refreshed successfully.', 3000);
            } catch (error) {
                new Notice(`Failed to automatically refresh Google Token: ${error.message}. Please connect manually.`, 7000);
            }
        }
    }

    tryLoadTasksPluginApi(isDefinitiveAttempt: boolean = false) {
        if (this.tasksPluginApi) return;
        // console.log("PlanSyncGo: Attempting to load Tasks API..."); // MODIFIED

        try {
            const tasksPlugin = (this.app as any).plugins.getPlugin('obsidian-tasks-plugin');
            if (tasksPlugin && tasksPlugin.getTasks) {
                this.tasksPluginApi = { getTasks: tasksPlugin.getTasks.bind(tasksPlugin) };
                new Notice('PlanSyncGo: Tasks Plugin API found!', 2500); // MODIFIED
                return;
            }
        } catch (error) {
            console.error("PlanSyncGo: Error accessing getTasks method:", error); // MODIFIED
        }

        try {
            const tasksPlugin = (this.app as any).plugins.getPlugin('obsidian-tasks-plugin');
            if (tasksPlugin && tasksPlugin.cache) {
                if (typeof tasksPlugin.cache.getTasks === 'function') {
                     this.tasksPluginApi = { getTasks: (filePath: string) => tasksPlugin.cache.getTasks(filePath) };
                     new Notice('PlanSyncGo: Tasks Plugin API (Cache) found!', 2500); // MODIFIED
                     return;
                }
            }
        } catch (error) {
            console.error("PlanSyncGo: Error accessing cache or cache.getTasks method:", error); // MODIFIED
        }

        if ((window as any).tasksPluginApi) {
            this.tasksPluginApi = (window as any).tasksPluginApi;
            new Notice('PlanSyncGo: Tasks Plugin API (window) found.', 2500); // MODIFIED
            return;
        }

        if (isDefinitiveAttempt) {
            try {
                const tasksPlugin = (this.app as any).plugins.getPlugin('obsidian-tasks-plugin');
                if (tasksPlugin) {
                    console.warn("PlanSyncGo: Tasks plugin found but no API access method available"); // MODIFIED
                }
            } catch (debugError) {
                console.error("PlanSyncGo: Debug error -", debugError); // MODIFIED
            }
        }
        this.tasksPluginApi = null;
    }

    onunload() {
        if (this.refreshInterval) {
            window.clearInterval(this.refreshInterval);
        }
    }

    async activateView() {
        this.app.workspace.detachLeavesOfType(PLANSYNCGO_TIMELINE_VIEW_TYPE); // MODIFIED
        const leaf = this.app.workspace.getRightLeaf(true);
        if (!leaf) {
            new Notice("Could not find or create a space in the right sidebar.");
            console.error("PlanSyncGo: Failed to get/create a leaf in the right sidebar for PlanSyncGoTimelineView."); // MODIFIED
            return;
        }
        await leaf.setViewState({
            type: PLANSYNCGO_TIMELINE_VIEW_TYPE, // MODIFIED
            active: true,
        });
        this.app.workspace.revealLeaf(leaf);
    }

    triggerTimelineViewRefresh() {
        this.app.workspace.getLeavesOfType(PLANSYNCGO_TIMELINE_VIEW_TYPE).forEach(leaf => { // MODIFIED
            if (leaf.view instanceof PlanSyncGoTimelineView) { // MODIFIED
                leaf.view.viewHasRenderedOnceForCurrentDate = false;
                leaf.view.renderTimeline();
            }
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    escapeRegex(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    extractInlineField(line: string, fieldName: string): string |
    undefined {
        const regex = new RegExp(`\\[${this.escapeRegex(fieldName)}::\\s*([^\\)]+?)\\]`, 'i');
        const match = line.match(regex);
        return match ? match[1].trim() : undefined;
    }

    addOrUpdateInlineField(line: string, fieldName: string, fieldValue: string): string {
        let updatedLine = this.removeInlineField(line, fieldName);
        if (updatedLine.trim() !== '' && !updatedLine.endsWith(' ')) {
            updatedLine += ' ';
        }
        updatedLine += `[${fieldName}::${fieldValue}]`;
        return updatedLine.trimEnd();
    }

    removeInlineField(line: string, fieldName: string): string {
        const regex = new RegExp(`\\s*\\[${this.escapeRegex(fieldName)}::\\s*[^\\)]+?\\]`, 'gi');
        return line.replace(regex, '').trimEnd();
    }

    getGoogleOAuthUrl(): string {
        const clientId = this.settings.googleOAuthClientId;
        const redirectUri = 'urn:ietf:wg:oauth:2.0:oob';
        const scopes = [
            'https://www.googleapis.com/auth/calendar.readonly',
            'https://www.googleapis.com/auth/calendar.events'
        ].join(' ');
        return `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${encodeURIComponent(clientId)}&` +
            `redirect_uri=${encodeURIComponent(redirectUri)}&` +
            `response_type=code&` +
            `scope=${encodeURIComponent(scopes)}&` +
            `access_type=offline&` +
            `prompt=consent`;
    }

    async startGoogleOAuth() {
        if (!this.settings.googleOAuthClientId || !this.settings.googleOAuthClientSecret) {
            new Notice('Please enter Client ID and Client Secret in plugin settings.', 7000);
            return;
        }
        const authUrl = this.getGoogleOAuthUrl();
        new OAuthCodeModal(this.app, authUrl, async (authCode: string) => {
            if (authCode) {
                try {
                    new Notice('Processing authorization code...', 5000);
                    await this.exchangeAuthCodeForTokens(authCode);
                    new Notice('✅ Google Calendar connected successfully!', 5000);
                    await this.saveSettings();
                    if (this.settings.enableInNoteTimeline) {
                        this.forceRefreshInNoteTimeline();
                    }
                    this.triggerTimelineViewRefresh();
                } catch (error) {
                    console.error('PlanSyncGo: OAuth Error during code exchange:', error); // MODIFIED
                    new Notice(`Google Authentication Error: ${error.message}`, 10000);
                }
            }
        }).open();
    }

    async exchangeAuthCodeForTokens(authCode: string) {
        const clientId = this.settings.googleOAuthClientId;
        const clientSecret = this.settings.googleOAuthClientSecret;
        const redirectUri = 'urn:ietf:wg:oauth:2.0:oob';
        const tokenUrl = 'https://oauth2.googleapis.com/token';
        const body = new URLSearchParams({
            code: authCode, client_id: clientId, client_secret: clientSecret,
            redirect_uri: redirectUri, grant_type: 'authorization_code'
        });
        const response = await fetch(tokenUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
        });
        const tokenData = await response.json();
        if (!response.ok) {
            console.error('PlanSyncGo: Token exchange error response:', tokenData); // MODIFIED
            throw new Error(tokenData.error_description || tokenData.error || 'Error exchanging authorization code.');
        }
        this.settings.googleOAuthAccessToken = tokenData.access_token;
        if (tokenData.refresh_token) { this.settings.googleOAuthRefreshToken = tokenData.refresh_token;
        }
        this.settings.googleOAuthTokenExpiry = Date.now() + (tokenData.expires_in * 1000);
        await this.saveSettings();
    }

    async getValidAccessToken(): Promise<string> {
        if (this.settings.googleOAuthAccessToken && this.settings.googleOAuthTokenExpiry > Date.now() + 60000) {
            return this.settings.googleOAuthAccessToken;
        }
        if (!this.settings.googleOAuthRefreshToken) {
            this.settings.googleOAuthAccessToken = '';
            this.settings.googleOAuthTokenExpiry = 0;
            await this.saveSettings();
            throw new Error('No Refresh Token. Please connect to Google Calendar again.');
        }
        new Notice('Refreshing Google Access Token...', 3000);
        const { googleOAuthClientId: clientId, googleOAuthClientSecret: clientSecret, googleOAuthRefreshToken: refreshToken } = this.settings;
        const tokenUrl = 'https://oauth2.googleapis.com/token';
        const body = new URLSearchParams({
            client_id: clientId, client_secret: clientSecret,
            refresh_token: refreshToken, grant_type: 'refresh_token'
        });
        const response = await fetch(tokenUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
        });
        const tokenData = await response.json();
        if (!response.ok) {
            console.error('PlanSyncGo: Token refresh error response:', tokenData); // MODIFIED
            this.settings.googleOAuthAccessToken = ''; this.settings.googleOAuthTokenExpiry = 0;
            if (tokenData.error === 'invalid_grant') {
                this.settings.googleOAuthRefreshToken = '';
                new Notice('Refresh Token invalid. Please reconnect.', 7000);
            }
            await this.saveSettings();
            throw new Error(tokenData.error_description || tokenData.error || 'Error refreshing token.');
        }
        this.settings.googleOAuthAccessToken = tokenData.access_token;
        this.settings.googleOAuthTokenExpiry = Date.now() + (tokenData.expires_in * 1000);
        await this.saveSettings();
        return this.settings.googleOAuthAccessToken;
    }

    async openDailyTimeline() {
        let folder = this.settings.dailyNoteFolder.trim();
        if (folder.startsWith('/')) folder = folder.substring(1);
        if (folder.endsWith('/')) folder = folder.slice(0, -1);

        const dateFormat = 'YYYY-MM-DD';
        const todayMoment = moment();
        const dailyNoteName = todayMoment.format(dateFormat) + '.md';
        const dailyNotePath = folder ? `${folder}/${dailyNoteName}` : dailyNoteName;

        let dailyNoteFile = this.app.vault.getAbstractFileByPath(dailyNotePath) as TFile;
        if (!dailyNoteFile) {
            const newNoteContent = "";
            try {
                if (folder && !await this.app.vault.adapter.exists(folder)) {
                    await this.app.vault.createFolder(folder);
                }
                dailyNoteFile = await this.app.vault.create(dailyNotePath, newNoteContent);
                new Notice(`Daily Note created: ${dailyNotePath}`);
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error) {
                new Notice(`Error creating Daily Note: ${error.message}`);
                console.error("PlanSyncGo: Error creating daily note:", error); // MODIFIED
                return;
            }
        }

        if (this.settings.enableInNoteTimeline && dailyNoteFile) {
            const noteDateStr = dailyNoteFile.basename.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
            || todayMoment.format('YYYY-MM-DD');
            await this.updateTimelineContentInNote(dailyNoteFile, noteDateStr);
        }

        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(dailyNoteFile);
    }

    generateTimelineView(events: CalendarEvent[], dateStr: string): string {
        let timeline = '';
        for (let hour = this.settings.timelineStartHour; hour <= this.settings.timelineEndHour; hour++) {
            const timeSlot = `${hour.toString().padStart(2, '0')}:00`;
            const slotMoment = moment(dateStr, 'YYYY-MM-DD').hour(hour);
            const eventsAtTime = events.filter(event => moment(event.start).isSame(slotMoment, 'hour'));

            timeline += `\n### ${timeSlot}\n`;
            if (eventsAtTime.length > 0) {
                eventsAtTime.forEach(event => {
                    const startTime = moment(event.start).format('HH:mm');
                    const endTime = moment(event.end).format('HH:mm');
                    const displayTime = (moment(event.start).isSame(moment(event.end), 'day') && event.start.includes('T')) ? `(${startTime}-${endTime})` : '(All-day)';
                    timeline += `- [📅] **${event.title}** ${displayTime}\n`;
                    if (event.description) {
                        const shortDesc = event.description.split('\n')[0].substring(0, 100) + (event.description.length > 100 ? '...' : '');
                        timeline += `  *${shortDesc}*\n`;
                    }
                });
            } else {
                timeline += `- [ ] \n`;
            }
        }
        return timeline;
    }

    async fetchCalendarEventsForDate(date: string): Promise<CalendarEvent[]> {
        const startOfDay = moment(date, 'YYYY-MM-DD').startOf('day').toISOString();
        const endOfDay = moment(date, 'YYYY-MM-DD').endOf('day').toISOString();
        let allEvents: CalendarEvent[] = [];
        try {
            const accessToken = await this.getValidAccessToken();
            if (this.settings.calendarId) {
                allEvents.push(...await this.fetchSingleCalendarViaOAuth(this.settings.calendarId, startOfDay, endOfDay, accessToken));
            }
            if (this.settings.enableWorkCalendar && this.settings.workCalendarId) {
                allEvents.push(...await this.fetchSingleCalendarViaOAuth(this.settings.workCalendarId, startOfDay, endOfDay, accessToken));
            }
            return allEvents.sort((a, b) => moment(a.start).diff(moment(b.start)));
        } catch (error) {
            if (this.settings.googleCalendarApiKey && error.message.includes('Token')) {
                new Notice('OAuth access failed, trying API key (read-only access)...', 4000);
                try {
                    allEvents = [];
                    if (this.settings.calendarId) {
                        allEvents.push(...await this.fetchSingleCalendarViaApiKey(this.settings.calendarId, startOfDay, endOfDay));
                    }
                    if (this.settings.enableWorkCalendar && this.settings.workCalendarId) {
                        allEvents.push(...await this.fetchSingleCalendarViaApiKey(this.settings.workCalendarId, startOfDay, endOfDay));
                    }
                    return allEvents.sort((a, b) => moment(a.start).diff(moment(b.start)));
                } catch (apiKeyError) {
                    new Notice('Error loading calendar events (API Key): ' + apiKeyError.message, 7000);
                    console.error("PlanSyncGo: fetchCalendarEventsForDate API key fallback error:", apiKeyError); // MODIFIED
                    return [];
                }
            } else {
                new Notice('Error loading calendar events: ' + error.message, 7000);
                console.error("PlanSyncGo: fetchCalendarEventsForDate error:", error); // MODIFIED
                return [];
            }
        }
    }

    async fetchSingleCalendarViaOAuth(calendarId: string, timeMin: string, timeMax: string, accessToken: string): Promise<CalendarEvent[]> {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || `API Error (OAuth) for calendar ${calendarId}`);
        return this.mapGoogleToCalendarEvents(data.items);
    }

    async fetchSingleCalendarViaApiKey(calendarId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
        if (!this.settings.googleCalendarApiKey) return [];
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?key=${this.settings.googleCalendarApiKey}&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || `API Error (API Key) for calendar ${calendarId}`);
        return this.mapGoogleToCalendarEvents(data.items);
    }

    mapGoogleToCalendarEvents(items: any[]): CalendarEvent[] {
        return items?.map((item: any) => ({
            id: item.id,
            title: item.summary || 'Untitled Event',
            start: item.start.dateTime || item.start.date,
            end: item.end.dateTime || item.end.date,
            description: item.description,
            obsidianTaskIdFromDescription: this.getObsidianTaskIdFromGCalEventDescription(item.description),
            isFromCalendar: true
        })) ||
        [];
    }

    private cleanRawContent(content: string, taskDate?: string, taskTime?: string, tags?: string[]): string {
        let cleanedContent = content;
        if (taskDate) cleanedContent = cleanedContent.replace(new RegExp(`(?:📅\\s*)${this.escapeRegex(taskDate)}(\\s|$)`), ' ').trim();
        if (taskTime) cleanedContent = cleanedContent.replace(new RegExp(`(?:⏰\\s*)${this.escapeRegex(taskTime)}(\\s|$)`), ' ').trim();
        tags?.forEach(tag => {
             cleanedContent = cleanedContent.replace(new RegExp(this.escapeRegex(tag) + '\\b', 'gi'), '').trim();
        });
        cleanedContent = cleanedContent.replace(/\[[\w-]+::[^\]]+\]/g, '').trim(); // Dataview inline fields
        cleanedContent = cleanedContent.replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, '').trim();
        // UUIDs
        cleanedContent = cleanedContent.replace(/\s*(obsidianTaskId|gcalEventId)\s*([a-f0-9-]{10,})?/gi, ' ').trim();
        // Specific old meta
        return cleanedContent.replace(/\s{2,}/g, ' ').trim();
    }

    async parseTasksFromContent(file: TFile, content: string): Promise<TimelineTask[]> {
        if (!this.tasksPluginApi && !this.hasAttemptedDefinitiveApiLoad) {
            this.tryLoadTasksPluginApi(false);
        }

        if (this.tasksPluginApi) {
            try {
                let apiTasks: ApiTask[] = [];
                if (typeof this.tasksPluginApi.getTasks === 'function') {
                    apiTasks = await this.tasksPluginApi.getTasks(file.path);
                } else if (this.tasksPluginApi.getTasks) { // Fallback for older API structure if any
                    apiTasks = await this.tasksPluginApi.getTasks(file.path);
                }

                if (apiTasks && apiTasks.length > 0) {
                    return this.mapApiTasksToTimelineTasks(apiTasks, file.path);
                }
            } catch (error) {
                console.error("PlanSyncGo: Error using Tasks Plugin API. Falling back to manual parsing.", error); // MODIFIED
                new Notice("Error with Tasks Plugin API. Using manual task parsing mode.", 5000);
                this.tasksPluginApi = null;
                // Disable API use on error
            }
        }

        // If API didn't work or not found, try definitive load once, then manual parse
        if (!this.tasksPluginApi) {
             if (!this.hasAttemptedDefinitiveApiLoad) {
                this.tryLoadTasksPluginApi(true);
                // Definitive attempt
                this.hasAttemptedDefinitiveApiLoad = true;
                if (this.tasksPluginApi) { // If now found, retry getting tasks
                     try {
                        let apiTasks: ApiTask[] = [];
                        if (typeof this.tasksPluginApi.getTasks === 'function') {
                            apiTasks = await this.tasksPluginApi.getTasks(file.path);
                        } else if (this.tasksPluginApi.getTasks) {
                            apiTasks = await this.tasksPluginApi.getTasks(file.path);
                        }
                        if (apiTasks && apiTasks.length > 0) {
                            return this.mapApiTasksToTimelineTasks(apiTasks, file.path);
                        }
                    } catch (error) {
                        console.error("PlanSyncGo: Error using Tasks Plugin API after definitive load. Falling back.", error); // MODIFIED
                        this.tasksPluginApi = null;
                    }
                }
            }
        }
        // If still no API after all attempts, parse manually
        if (!this.tasksPluginApi) {
            return this.parseTasksManually(content, file.path);
        }
        return [];
        // Should not be reached if logic is correct
    }

    mapApiTasksToTimelineTasks(apiTasks: ApiTask[], filePath: string): TimelineTask[] {
        const timelineTasks: TimelineTask[] = [];
        const syncTag = this.settings.tasksPluginSyncTag.startsWith('#')
            ?
            this.settings.tasksPluginSyncTag
            : `#${this.settings.tasksPluginSyncTag}`;
        for (const apiTask of apiTasks) {
            if (!apiTask.originalMarkdown) continue;
            let taskDate: string | undefined = undefined;
            let taskTime: string | undefined = undefined;
            const happensMoment = apiTask.happens?.moment ||
            apiTask.scheduledDate || apiTask.startDate || apiTask.dueDate;

            if (happensMoment && happensMoment.isValid()) {
                taskDate = happensMoment.format('YYYY-MM-DD');
                // Check if time is explicitly part of 'happens' or if the moment has a non-midnight time
                if (apiTask.happens?.time || (happensMoment.hour() !== 0 || happensMoment.minute() !== 0 || happensMoment.second() !==0 )) {
                    taskTime = happensMoment.format('HH:mm');
                }
            } else {
                // Fallback: Try to parse from description if Tasks API didn't provide structured date/time
                const dateMatchDesc = apiTask.description.match(/(?:📅\s*)?(\d{4}-\d{2}-\d{2})/);
                if (dateMatchDesc) taskDate = dateMatchDesc[1];
                const timeMatchDesc = apiTask.description.match(/(?:⏰\s*)?(\d{1,2}:\d{2})/);
                if (timeMatchDesc) taskTime = timeMatchDesc[1];
            }

            const hasSyncTag = apiTask.tags.some(tag => {
                const normalizedTag = tag.toLowerCase().trim();
                const normalizedSyncTag = syncTag.toLowerCase().trim();
                // Also check without '#' if the setting has it, as Tasks API might return tags without it
                const normalizedSyncTagWithoutHash = syncTag.startsWith('#') ? syncTag.substring(1).toLowerCase().trim() : normalizedSyncTag;
                return normalizedTag === normalizedSyncTag || normalizedTag === normalizedSyncTagWithoutHash;
            });
            const syncFieldValue = this.extractInlineField(apiTask.originalMarkdown, 'sync');
            const shouldSync = hasSyncTag || syncFieldValue === 'true';

            const durationStr = this.extractInlineField(apiTask.originalMarkdown, 'duration');
            const duration = durationStr ? parseInt(durationStr) : undefined;

            const cleanedContent = this.cleanRawContent(apiTask.description, taskDate, taskTime, apiTask.tags);
            const timelineTask: TimelineTask = {
                id: apiTask.blockLink ||
                `task-line-${apiTask.lineNumber}`, // Use blockLink if available
                originalMarkdown: apiTask.originalMarkdown,
                lineNumber: apiTask.lineNumber,
                obsidianTaskId: this.extractInlineField(apiTask.originalMarkdown, 'obsidianTaskId') ||
                crypto.randomUUID(),
                content: cleanedContent,
                date: taskDate,
                time: taskTime,
                duration: duration,
                completed: apiTask.status.indicator === 'x' ||
                apiTask.status.indicator === 'X' || !!apiTask.doneDate,
                syncToCalendar: shouldSync,
                calendarEventId: this.extractInlineField(apiTask.originalMarkdown, 'gcalEventId'),
                path: filePath,
            };
            timelineTasks.push(timelineTask);
        }
        return timelineTasks;
    }

    parseTasksManually(content: string, filePath: string): TimelineTask[] {
        const tasks: TimelineTask[] = [];
        const lines = content.split('\n');
        const taskRegex = /^- \[( |x)\] (.*)$/;
        // Basic task regex
        const syncTagForManual = this.settings.tasksPluginSyncTag.startsWith('#')
            ?
            this.settings.tasksPluginSyncTag
            : `#${this.settings.tasksPluginSyncTag}`;
        for (let i = 0; i < lines.length; i++) {
            const originalLine = lines[i];
            const lineMatch = originalLine.match(taskRegex);

            if (lineMatch) {
                const completedChar = lineMatch[1];
                let fullTaskText = lineMatch[2].trim(); // Full text after checkbox
                let contentPart = fullTaskText;
                // This will be stripped down

                // Extract known inline fields first
                let obsidianTaskId = this.extractInlineField(contentPart, 'obsidianTaskId');
                contentPart = this.removeInlineField(contentPart, 'obsidianTaskId');
                let calendarEventId = this.extractInlineField(contentPart, 'gcalEventId');
                contentPart = this.removeInlineField(contentPart, 'gcalEventId');
                let durationStr = this.extractInlineField(contentPart, 'duration');
                contentPart = this.removeInlineField(contentPart, 'duration');
                let syncExplicit = this.extractInlineField(contentPart, 'sync');
                contentPart = this.removeInlineField(contentPart, 'sync');
                // Parse old metadata format if new ones weren't found
                const oldMeta = this.parseOldTaskMetadata(contentPart);
                if (!obsidianTaskId && oldMeta.taskId) obsidianTaskId = oldMeta.taskId;
                if (!calendarEventId && oldMeta.eventId) calendarEventId = oldMeta.eventId;
                if (!durationStr && oldMeta.duration) durationStr = oldMeta.duration.toString();
                if (!syncExplicit && oldMeta.sync !== undefined) syncExplicit = oldMeta.sync.toString();
                // Remove old metadata string part
                contentPart = contentPart.replace(/\{[\w-]+\s*:\s*[^}]+\s*\}/g, '').trim();
                if (!obsidianTaskId) obsidianTaskId = crypto.randomUUID();
                const duration = durationStr ? parseInt(durationStr) : undefined;
                // Parse date and time from the remaining contentPart
                let parsedDate: string |
                undefined = undefined;
                let parsedTime: string | undefined = undefined;

                const dateRegexInternal = /(?:📅\s*)?(\d{4}-\d{2}-\d{2})/;
                const dateMatch = contentPart.match(dateRegexInternal);
                if (dateMatch) {
                    parsedDate = dateMatch[1];
                    contentPart = contentPart.replace(dateMatch[0], '').trim();
                }

                const timeRegexInternal = /(?:⏰\s*)?(\b\d{1,2}:\d{2}\b)/;
                // \b for word boundary
                const timeMatch = contentPart.match(timeRegexInternal);
                if (timeMatch) {
                    parsedTime = timeMatch[1];
                    contentPart = contentPart.replace(timeMatch[0], '').trim();
                }

                let syncToCalendar = false;
                if (syncExplicit === 'true') syncToCalendar = true;
                else if (syncExplicit === 'false') syncToCalendar = false;
                else if (fullTaskText.includes(syncTagForManual)) syncToCalendar = true; // Check original full text for tag
                else if (this.settings.autoSyncToCalendar && syncExplicit === undefined && !fullTaskText.includes(syncTagForManual) ) {
                    // Legacy autoSync, only if no explicit sync field and no tag
                    syncToCalendar = true;
                }

                // Clean the sync tag from contentPart
                contentPart = contentPart.replace(new RegExp(this.escapeRegex(syncTagForManual) + '\\b', 'g'), '').trim();
                if (syncTagForManual.startsWith('#')) { // Also remove if tag was written without # initially
                     contentPart = contentPart.replace(new RegExp(this.escapeRegex(syncTagForManual.substring(1)) + '\\b', 'g'), '').trim();
                }

                // Remove remaining common task emojis that aren't part of date/time
                contentPart = contentPart.replace(/[⏳🛫✅➕]/g, '').trim();
                // Keep 📅 and ⏰ if they weren't parsed, cleanRawContent will get them
                const taskTextOnly = this.cleanRawContent(contentPart, parsedDate, parsedTime);
                // Final clean

                if (taskTextOnly.trim() === '' && !calendarEventId) continue;
                // Skip if only metadata and no text

                tasks.push({
                    id: `task-line-${i}`, // Simple ID for manual tasks
                    originalMarkdown: originalLine,
                    lineNumber: i,
                    obsidianTaskId: obsidianTaskId,
                    content: taskTextOnly,
                    date: parsedDate,
                    time: parsedTime,
                    duration: duration,
                    completed: completedChar === 'x',
                    syncToCalendar: syncToCalendar,
                    calendarEventId: calendarEventId,
                    path: filePath,
                });
            }
        }
        return tasks;
    }

    parseOldTaskMetadata(metaString: string): { sync?: boolean, eventId?: string, taskId?: string, duration?: number } {
        const metadata: { sync?: boolean, eventId?: string, taskId?: string, duration?: number } = {};
        const metaRegex = /\{([\w-]+)\s*:\s*([^}]+?)\s*\}/g;
        let m;
        while ((m = metaRegex.exec(metaString)) !== null) {
            const key = m[1].toLowerCase().trim();
            const value = m[2].trim();
            if (key === 'sync') metadata.sync = value === 'true';
            else if (key === 'eventid') metadata.eventId = value;
            else if (key === 'taskid') metadata.taskId = value;
            else if (key === 'duration' && !isNaN(parseInt(value))) metadata.duration = parseInt(value);
        }
        return metadata;
    }

    getObsidianTaskIdFromGCalEventDescription(description: string | undefined): string |
    undefined {
        if (!description) return undefined;
        const match = description.match(/Obsidian Task ID:\s*([a-f0-9-]+)/i);
        return match ? match[1] : undefined;
    }

    // NEU HINZUGEFÜGT: Funktion zum Reformatieren der Task-Zeile
    private reformatTaskLineForTasksPlugin(currentLineContent: string, task: TimelineTask): string {
        let line = currentLineContent;
        // 1. Definiere die Datums- und Zeit-Strings, die am Ende stehen sollen,
        //    basierend auf den geparsten Werten im 'task'-Objekt.
        const dateString = task.date ? `📅 ${task.date}` : '';
        const timeString = task.time ? `⏰ ${task.time}` : '';
        // 2. Entferne alle existierenden Datums- (📅 JJJJ-MM-TT) und Zeit-Emoji-Muster (⏰ HH:MM)
        //    aus der aktuellen Zeile.
        const genericDatePattern = /\s*📅\s*\d{4}-\d{2}-\d{2}\s*/g;
        const genericTimePattern = /\s*⏰\s*\d{1,2}:\d{2}\s*/g;

        // Ersetze gefundene Muster durch ein einzelnes Leerzeichen, um die Formatierung später zu normalisieren.
        line = line.replace(genericDatePattern, ' ');
        line = line.replace(genericTimePattern, ' ');
        // 3. Normalisiere Leerzeichen (mehrere Leerzeichen zu einem, trimmen am Anfang/Ende).
        line = line.replace(/\s{2,}/g, ' ').trim();
        // 4. Füge die gewünschten Teile in der neuen Reihenfolge an:
        //    Erst die Uhrzeit (falls vorhanden), dann das Datum (falls vorhanden).
        const partsToAppend: string[] = [];
        if (timeString) { // Uhrzeit zuerst in die Liste für den Anhang
            partsToAppend.push(timeString);
        }
        if (dateString) { // Datum als zweites (wird also als letztes angehängt)
            partsToAppend.push(dateString);
        }

        if (partsToAppend.length > 0) {
            line = `${line} ${partsToAppend.join(' ')}`.trim();
            // trim() nochmal für den Fall, dass line leer war
        }

        return line;
    }

    async createCalendarEventFromTask(task: TimelineTask, dailyNoteDate: string): Promise<string |
    null> {
        const accessToken = await this.getValidAccessToken();
        const eventDateStr = task.date || dailyNoteDate;
        const eventDateMoment = moment(eventDateStr, "YYYY-MM-DD");
        let startTime: moment.Moment;

        if (task.time) {
            const [hours, minutes] = task.time.split(':').map(Number);
            startTime = eventDateMoment.clone().hour(hours).minute(minutes).second(0);
        } else {
            // Default to a sensible morning hour if no time specified
            startTime = eventDateMoment.clone().hour(this.settings.timelineStartHour < 9 ? 9 : this.settings.timelineStartHour).minute(0).second(0);
        }
        const endTime = startTime.clone().add(task.duration || this.settings.defaultEventDuration, 'minutes');
        const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const eventPayload = {
            summary: task.content.trim() ||
            "Unnamed Task from Obsidian",
            start: { dateTime: startTime.toISOString(), timeZone: userTimeZone },
            end: { dateTime: endTime.toISOString(), timeZone: userTimeZone },
            description: `Created from Obsidian.\nObsidian Task ID: ${task.obsidianTaskId}\nPath: ${task.path}`
        };
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.settings.calendarId)}/events`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
            body: JSON.stringify(eventPayload)
        });
        const responseData = await response.json();
        if (!response.ok) {
            console.error("PlanSyncGo: Create event error from Google:", responseData); // MODIFIED
            throw new Error(responseData.error?.message || 'Error creating calendar event.');
        }
        return responseData.id;
    }

    async updateCalendarEvent(task: TimelineTask, dailyNoteDate: string): Promise<void> {
        if (!task.calendarEventId) return;
        const accessToken = await this.getValidAccessToken();
        const eventDateStr = task.date || dailyNoteDate;
        const eventDateMoment = moment(eventDateStr, "YYYY-MM-DD");
        let startTime: moment.Moment;
        if (task.time) {
            const [hours, minutes] = task.time.split(':').map(Number);
            startTime = eventDateMoment.clone().hour(hours).minute(minutes).second(0);
        } else {
             startTime = eventDateMoment.clone().hour(this.settings.timelineStartHour < 9 ? 9 : this.settings.timelineStartHour).minute(0).second(0);
        }
        const endTime = startTime.clone().add(task.duration || this.settings.defaultEventDuration, 'minutes');
        const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const eventPayload = {
            summary: task.content.trim() ||
            "Unnamed Task from Obsidian",
            start: { dateTime: startTime.toISOString(), timeZone: userTimeZone },
            end: { dateTime: endTime.toISOString(), timeZone: userTimeZone },
            description: `Updated from Obsidian.\nObsidian Task ID: ${task.obsidianTaskId}\nPath: ${task.path}`
        };
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.settings.calendarId)}/events/${task.calendarEventId}`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
            body: JSON.stringify(eventPayload)
        });
        const responseData = await response.json();
        if (!response.ok) {
            console.error("PlanSyncGo: Update event error from Google:", responseData); // MODIFIED
            throw new Error(responseData.error?.message || `Error updating calendar event ${task.calendarEventId}.`);
        }
    }

    async deleteCalendarEvent(eventId: string): Promise<void> {
        if (!this.settings.calendarId) return;
        // Don't attempt if no primary calendar ID
        const accessToken = await this.getValidAccessToken();
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.settings.calendarId)}/events/${encodeURIComponent(eventId)}`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        // Google API returns 204 No Content on successful deletion.
        // Also handle 404 (already deleted) or 410 (gone) gracefully.
        if (!(response.status === 204 || response.status === 404 || response.status === 410) ) {
            const responseData = await response.json().catch(() => ({}));
            // Catch if no JSON body
            console.error("PlanSyncGo: Delete event error from Google:", response.status, responseData); // MODIFIED
            throw new Error(responseData.error?.message || `Error deleting calendar event ${eventId}. Status: ${response.status}`);
        }
    }

    async syncObsidianTasksToCalendar() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file found to sync.');
            return;
        }

        const dailyNoteDateForContext = this.isDailyNote(activeFile)
            ?
            activeFile.basename.match(/\d{4}-\d{2}-\d{2}/)?.[0] || moment().format("YYYY-MM-DD")
            : moment().format("YYYY-MM-DD");
        // Fallback for non-daily notes, context is today

        let fileContent = await this.app.vault.read(activeFile);
        let linesFromFile = fileContent.split('\n');
        let currentObsidianTasks = await this.parseTasksFromContent(activeFile, fileContent);
        const gCalEventsForPrimaryContext = await this.fetchCalendarEventsForDate(dailyNoteDateForContext);
        // For the active daily note's date

        let contentWasModifiedInFile = false;
        let notices: string[] = [];
        let anyChangesMadeThisSync = false;

        // --- Phase 1: GCal -> Obsidian (GCal event deleted -> Mark Obsidian task as done) ---
        for (const task of currentObsidianTasks) {
            if (task.calendarEventId && !task.completed) { // Only process linked, uncompleted tasks
                const taskEffectiveDate = task.date ||
                dailyNoteDateForContext; // Date context for this specific task
                let eventExistsOnGCal = false;
                let eventsToCheckAgainst: CalendarEvent[];

                // Fetch events for the specific task's date if different from current daily note
                if (moment(taskEffectiveDate, "YYYY-MM-DD").isSame(moment(dailyNoteDateForContext, "YYYY-MM-DD"), 'day')) {
                    eventsToCheckAgainst = gCalEventsForPrimaryContext;
                } else {
                    try {
                        eventsToCheckAgainst = await this.fetchCalendarEventsForDate(taskEffectiveDate);
                    } catch (e) {
                        console.error(`PlanSyncGo: Error fetching events for task-specific date ${taskEffectiveDate}: ${e.message}`); // MODIFIED
                        eventsToCheckAgainst = []; // Assume no events if fetch fails
                    }
                }

                eventExistsOnGCal = eventsToCheckAgainst.some(ge => ge.id === task.calendarEventId);
                if (!eventExistsOnGCal) { // Event deleted on GCal
                    let lineToUpdate = linesFromFile[task.lineNumber];
                    const originalLineForCheck = lineToUpdate;

                    lineToUpdate = lineToUpdate.replace(/^- \[\s\]/, '- [x]');
                    // Mark as done
                    lineToUpdate = this.removeInlineField(lineToUpdate, 'gcalEventId');
                    lineToUpdate = this.removeInlineField(lineToUpdate, 'sync');
                    const syncTagToRemove = this.settings.tasksPluginSyncTag.startsWith('#') ? this.settings.tasksPluginSyncTag : `#${this.settings.tasksPluginSyncTag}`;
                    lineToUpdate = lineToUpdate.replace(new RegExp(`\\s*${this.escapeRegex(syncTagToRemove)}\\b`, 'g'), '').trimEnd();
                    // MODIFIZIERT: Task-Zeile reformatieren.
                    // Da der Task jetzt als [x] markiert ist, ist die Formatierung für Tasks-Queries weniger kritisch,
                    // aber für Konsistenz und falls der Task manuell reaktiviert wird.
                    // Verwende den Task-Status *vor* der Markierung als erledigt für die Datums/Zeit-Info.
                    const taskBeforeCompletion = {...task};
                    // Shallow copy, date/time are primitive
                    lineToUpdate = this.reformatTaskLineForTasksPlugin(lineToUpdate, taskBeforeCompletion);
                    if (originalLineForCheck !== lineToUpdate) {
                        linesFromFile[task.lineNumber] = lineToUpdate;
                        task.completed = true; task.calendarEventId = undefined; task.syncToCalendar = false; // Update task object state
                        contentWasModifiedInFile = true;
                        anyChangesMadeThisSync = true;
                        notices.push(`Task "${task.content.substring(0,30)}..." marked as done (GCal event deleted).`);
                    }
                }
            }
        }

        // --- Phase 2: Obsidian -> GCal (Deletions based on Obsidian state) ---
        // (e.g., task completed in Obsidian, sync disabled, or task line deleted)
        const eventsToDeleteOnGCalDueToObsidianState: { gCalEventId: string, taskObsId?: string, reason: string }[] = [];
        for (const task of currentObsidianTasks) { // Iterate over the *current* state of tasks
            if (task.calendarEventId) { // Only if it was linked
                if (task.completed) { // If task is now marked completed
                    eventsToDeleteOnGCalDueToObsidianState.push({ gCalEventId: task.calendarEventId, taskObsId: task.obsidianTaskId, reason: "Obsidian task completed" });
                } else if (!task.syncToCalendar) { // If sync was disabled for an existing linked task
                    eventsToDeleteOnGCalDueToObsidianState.push({ gCalEventId: task.calendarEventId, taskObsId: task.obsidianTaskId, reason: "Sync disabled for Obsidian task" });
                }
            }
        }

        // Check for "orphaned" GCal events (Obsidian task line deleted)
        const allObsidianTaskIdsInCurrentFile = new Set(currentObsidianTasks.map(t => t.obsidianTaskId));
        const uniqueDatesInFileTasks = new Set<string>(currentObsidianTasks.map(t => t.date).filter(d => !!d) as string[]);
        uniqueDatesInFileTasks.add(dailyNoteDateForContext);
        // Always check context date

        let relevantGCalEventsForOrphanCheck: CalendarEvent[] = [];
        for(const dateStr of uniqueDatesInFileTasks){
            try {
                relevantGCalEventsForOrphanCheck.push(...await this.fetchCalendarEventsForDate(dateStr));
            } catch (e) { console.error(`PlanSyncGo: Failed to fetch events for orphan check on date ${dateStr}: ${e.message}`);} // MODIFIED
        }
        // Deduplicate events if fetched from multiple dates (e.g. multi-day events)
        relevantGCalEventsForOrphanCheck = relevantGCalEventsForOrphanCheck.filter((event, index, self) =>
            index === self.findIndex((e) => e.id === event.id)
        );
        for (const gEvent of relevantGCalEventsForOrphanCheck) {
            if (gEvent.obsidianTaskIdFromDescription && !allObsidianTaskIdsInCurrentFile.has(gEvent.obsidianTaskIdFromDescription)) {
                // If GCal event has an Obsidian Task ID, but that ID is no longer in the current file's tasks
                if (!eventsToDeleteOnGCalDueToObsidianState.some(item => item.gCalEventId === gEvent.id)) { // Avoid double-adding
                    eventsToDeleteOnGCalDueToObsidianState.push({ gCalEventId: gEvent.id, taskObsId: gEvent.obsidianTaskIdFromDescription, reason: "Linked Obsidian task line deleted" });
                }
            }
        }

        if (eventsToDeleteOnGCalDueToObsidianState.length > 0) notices.push(`Processing ${eventsToDeleteOnGCalDueToObsidianState.length} deletion candidate(s) on GCal...`);
        for (const item of eventsToDeleteOnGCalDueToObsidianState) {
            try {
                await this.deleteCalendarEvent(item.gCalEventId);
                let noticeMsg = `Event (ID: ${item.gCalEventId.substring(0,10)}...) deleted from calendar (${item.reason}).`;
                anyChangesMadeThisSync = true;
                // Clean up metadata in Obsidian note if the task still exists in our parsed list
                const taskToClean = currentObsidianTasks.find(t => t.obsidianTaskId === item.taskObsId && t.calendarEventId === item.gCalEventId);
                if (taskToClean && taskToClean.lineNumber >= 0 && taskToClean.lineNumber < linesFromFile.length) {
                    let lineToUpdate = linesFromFile[taskToClean.lineNumber];
                    const originalLineForCheck = lineToUpdate;

                    lineToUpdate = this.removeInlineField(lineToUpdate, 'gcalEventId');
                    if (taskToClean.completed || !taskToClean.syncToCalendar) { // If completed or sync disabled, also remove sync field/tag
                        lineToUpdate = this.removeInlineField(lineToUpdate, 'sync');
                        const syncTagToRemove = this.settings.tasksPluginSyncTag.startsWith('#') ? this.settings.tasksPluginSyncTag : `#${this.settings.tasksPluginSyncTag}`;
                        lineToUpdate = lineToUpdate.replace(new RegExp(`\\s*${this.escapeRegex(syncTagToRemove)}\\b`, 'g'), '').trimEnd();
                    }
                    lineToUpdate = lineToUpdate.replace(/\s{2,}/g, ' ').trimEnd();
                    // Clean spaces

                    // MODIFIZIERT: Task-Zeile reformatieren
                    lineToUpdate = this.reformatTaskLineForTasksPlugin(lineToUpdate, taskToClean);
                    if (originalLineForCheck !== lineToUpdate) {
                        linesFromFile[taskToClean.lineNumber] = lineToUpdate;
                        if(taskToClean.calendarEventId === item.gCalEventId) taskToClean.calendarEventId = undefined; // Update task object
                        contentWasModifiedInFile = true;
                        noticeMsg += ` Metadata cleaned up in Obsidian.`;
                    }
                }
                notices.push(noticeMsg);
            } catch (error) {
                notices.push(`Error deleting GCal Event ${item.gCalEventId.substring(0,10)}... (${item.reason}): ${error.message}`);
            }
        }

        // Refresh current tasks if lines were modified in Phase 1 or 2, before Phase 3 processing
        if (contentWasModifiedInFile) {
            currentObsidianTasks = await this.parseTasksFromContent(activeFile, linesFromFile.join('\n'));
        }


        // --- Phase 3: Obsidian -> GCal (Creations/Updates) ---
        const tasksToCreateInGCal: TimelineTask[] = [];
        const tasksToUpdateInGCal: TimelineTask[] = [];

        for (const task of currentObsidianTasks) { // Use potentially updated currentObsidianTasks
            if (task.syncToCalendar && !task.completed) {
                if (!task.calendarEventId) { // No GCal ID -> Needs creation
                    if (task.content.trim() === '') { continue;
                    } // Skip empty tasks

                    // Ensure task has enough info for a calendar event
                    const taskHasSufficientDateForSync = task.date && task.time;
                    // Explicit date and time
                    const taskIsDailyNoteTaskWithTime = this.isDailyNote(activeFile) && task.time && !task.date;
                    // Time in daily note implies date of note

                    if (taskHasSufficientDateForSync || taskIsDailyNoteTaskWithTime) {
                        tasksToCreateInGCal.push(task);
                    }
                } else { // Has GCal ID -> Potentially needs update
                    // Verify event actually exists on GCal before trying to update
                    let eventActuallyExistsOnGCal = false;
                    const taskEffectiveDate = task.date || dailyNoteDateForContext;
                    let eventsToVerifyAgainst: CalendarEvent[];

                    if (moment(taskEffectiveDate, "YYYY-MM-DD").isSame(moment(dailyNoteDateForContext, "YYYY-MM-DD"), 'day')) {
                        eventsToVerifyAgainst = gCalEventsForPrimaryContext;
                    } else {
                        try {
                            eventsToVerifyAgainst = await this.fetchCalendarEventsForDate(taskEffectiveDate);
                        } catch (e) {
                             console.error(`PlanSyncGo: Error fetching events for task-specific date ${taskEffectiveDate} in Phase 3: ${e.message}`); // MODIFIED
                             eventsToVerifyAgainst = [];
                        }
                    }
                    eventActuallyExistsOnGCal = eventsToVerifyAgainst.some(ge => ge.id === task.calendarEventId);
                    if (eventActuallyExistsOnGCal) {
                        tasksToUpdateInGCal.push(task);
                    } else {
                        // Event ID exists on task, but not found on GCal (maybe deleted manually there without PlanSyncGo knowing)
                        // Remove the invalid gcalEventId and treat as a new task for creation if it's still valid
                        if (task.lineNumber >= 0 && task.lineNumber < linesFromFile.length) {
                            let lineToUpdate = linesFromFile[task.lineNumber];
                            const originalLineForCheck = lineToUpdate;
                            lineToUpdate = this.removeInlineField(lineToUpdate, 'gcalEventId');

                            // MODIFIZIERT: Task-Zeile reformatieren
                            lineToUpdate = this.reformatTaskLineForTasksPlugin(lineToUpdate, task);
                            if (originalLineForCheck !== lineToUpdate) {
                                linesFromFile[task.lineNumber] = lineToUpdate;
                                contentWasModifiedInFile = true; // Mark for potential re-parse
                            }
                        }
                        task.calendarEventId = undefined;
                        // Update task object

                        if (task.content.trim() !== '') { // If still a valid task content-wise
                           const taskHasSufficientDateForReSync = task.date && task.time;
                           const taskIsDailyNoteTaskWithTimeForReSync = this.isDailyNote(activeFile) && task.time && !task.date;
                           if (taskHasSufficientDateForReSync || taskIsDailyNoteTaskWithTimeForReSync) {
                               tasksToCreateInGCal.push(task);
                               // Add to creation queue
                           }
                        }
                    }
                }
            }
        }

        // If content was modified by gcalEventId removal, re-parse tasks before creation/update logic
        if (contentWasModifiedInFile && tasksToCreateInGCal.some(t => t.calendarEventId === undefined) ) { // Check if any task had its ID removed
            currentObsidianTasks = await this.parseTasksFromContent(activeFile, linesFromFile.join('\n'));
            // Re-filter tasksToCreateInGCal and tasksToUpdateInGCal based on the re-parsed tasks if necessary,
            // though the current logic of pushing to tasksToCreateInGCal should largely handle it.
        }


        console.log(`PlanSyncGo: Found ${currentObsidianTasks.length} total tasks. ${tasksToCreateInGCal.length} to create on GCal, ${tasksToUpdateInGCal.length} to update on GCal.`); // MODIFIED
        if (tasksToCreateInGCal.length > 0) notices.push(`Creating ${tasksToCreateInGCal.length} new calendar event(s)...`);
        for (const task of tasksToCreateInGCal) {
             try {
                const googleEventId = await this.createCalendarEventFromTask(task, dailyNoteDateForContext);
                if (googleEventId && task.lineNumber >= 0 && task.lineNumber < linesFromFile.length) {
                    let lineToUpdate = linesFromFile[task.lineNumber];
                    const originalLineForCheck = lineToUpdate;

                    lineToUpdate = this.addOrUpdateInlineField(lineToUpdate, 'obsidianTaskId', task.obsidianTaskId!);
                    lineToUpdate = this.addOrUpdateInlineField(lineToUpdate, 'gcalEventId', googleEventId);
                    if (this.tasksPluginApi && !this.extractInlineField(lineToUpdate, 'sync')) { // Add [sync::true] if using Tasks API and not already there
                        lineToUpdate = this.addOrUpdateInlineField(lineToUpdate, 'sync', 'true');
                    }
                    // If task has duration and it's not from Tasks syntax, could add [duration::NN] here
                    // Example: if (task.duration && !this.extractInlineField(lineToUpdate, 'duration')) {
                    //    lineToUpdate = this.addOrUpdateInlineField(lineToUpdate, 'duration', task.duration.toString());
                    // }

                    // MODIFIZIERT: Task-Zeile reformatieren, nachdem alle Felder hinzugefügt wurden
                    lineToUpdate = this.reformatTaskLineForTasksPlugin(lineToUpdate, task);
                    if (originalLineForCheck !== lineToUpdate) {
                        linesFromFile[task.lineNumber] = lineToUpdate;
                        contentWasModifiedInFile = true; anyChangesMadeThisSync = true;
                    }
                    task.calendarEventId = googleEventId;
                    // Update task object
                    notices.push(`Task "${task.content.substring(0,30)}..." successfully created in calendar.`);
                }
            } catch (error) {
                notices.push(`Error creating GCal event for task "${task.content.substring(0,30)}...": ${error.message}`);
            }
        }

        if (tasksToUpdateInGCal.length > 0) notices.push(`Updating ${tasksToUpdateInGCal.length} existing calendar event(s)...`);
        for (const task of tasksToUpdateInGCal) {
            try {
                await this.updateCalendarEvent(task, dailyNoteDateForContext);
                // This updates GCal
                anyChangesMadeThisSync = true;
                notices.push(`Task "${task.content.substring(0,30)}..." successfully updated in calendar.`);

                // If task details (content, date, time) changed in Obsidian and these changes
                // should be reflected in the Obsidian note's line structure (e.g. date/time moved to end).
                // Currently, this loop only updates GCal. If the line needs reformatting based on updated task object:
                if (task.lineNumber >= 0 && task.lineNumber < linesFromFile.length) {
                    let lineToUpdate = linesFromFile[task.lineNumber];
                    const originalLineForCheck = lineToUpdate;
                    // Assume 'task' object is up-to-date from parsing.
                    // Re-apply all our fields and then reformat.
                    // This ensures if obsidianTaskId was missing, it gets added.
                    lineToUpdate = this.addOrUpdateInlineField(lineToUpdate, 'obsidianTaskId', task.obsidianTaskId!);
                    if (task.calendarEventId) lineToUpdate = this.addOrUpdateInlineField(lineToUpdate, 'gcalEventId', task.calendarEventId);
                    if (this.tasksPluginApi && task.syncToCalendar && !this.extractInlineField(lineToUpdate, 'sync')) {
                        lineToUpdate = this.addOrUpdateInlineField(lineToUpdate, 'sync', 'true');
                    } else if (!task.syncToCalendar && this.extractInlineField(lineToUpdate, 'sync') === 'true') {
                        lineToUpdate = this.removeInlineField(lineToUpdate, 'sync');
                    }
                    // Add/update duration field if needed
                    // if (task.duration && this.extractInlineField(lineToUpdate, 'duration') !== task.duration.toString()) {
                    //    lineToUpdate = this.addOrUpdateInlineField(lineToUpdate, 'duration', task.duration.toString());
                    // }

                    lineToUpdate = this.reformatTaskLineForTasksPlugin(lineToUpdate, task);
                    // MODIFIZIERT

                    if (originalLineForCheck !== lineToUpdate) {
                        linesFromFile[task.lineNumber] = lineToUpdate;
                        contentWasModifiedInFile = true;
                    }
                }

            } catch (error) {
                notices.push(`Error updating GCal event for task "${task.content.substring(0,30)}...": ${error.message}`);
                if (error.message.includes("404") || error.message.toLowerCase().includes("not found")) {
                    notices.push(`  -> Event for "${task.content.substring(0,30)}" was not found on GCal. GCalID will be removed.`);
                    if (task.lineNumber >= 0 && task.lineNumber < linesFromFile.length) {
                        let lineToUpdate = linesFromFile[task.lineNumber];
                        const originalLineForCheck = lineToUpdate; // Capture before modification

                        lineToUpdate = this.removeInlineField(lineToUpdate, 'gcalEventId');
                        // MODIFIZIERT: Task-Zeile reformatieren
                        lineToUpdate = this.reformatTaskLineForTasksPlugin(lineToUpdate, task);
                        if (originalLineForCheck !== lineToUpdate) { // Check if line actually changed
                           linesFromFile[task.lineNumber] = lineToUpdate;
                           contentWasModifiedInFile = true; anyChangesMadeThisSync = true;
                        }
                    }
                    task.calendarEventId = undefined;
                    // Update task object
                }
            }
        }

        if (contentWasModifiedInFile) {
            fileContent = linesFromFile.join('\n');
            await this.app.vault.modify(activeFile, fileContent);
            if (!notices.some(n => n.includes("Obsidian note was updated."))) {
                 notices.push("Obsidian note was updated.");
            }
        }

        if (notices.length > 0) {
            const uniqueNotices = [...new Set(notices)];
            // Remove duplicate notices
            const combinedNotice = uniqueNotices.join('\n');
            new Notice(combinedNotice.substring(0, 400) + (combinedNotice.length > 400 ? "..." : ""), Math.min(15000, uniqueNotices.length * 2000 + 3000));
        } else if (!anyChangesMadeThisSync) { // Only show "no changes" if no other notices were generated
             new Notice('Synchronization complete. No changes made.');
        }

        if (anyChangesMadeThisSync) { // If any sync operation caused a change
            // Refresh the timeline view if it's open for the current daily note
            const timelineView = this.app.workspace.getLeavesOfType(PLANSYNCGO_TIMELINE_VIEW_TYPE)[0]?.view as PlanSyncGoTimelineView; // MODIFIED
            if (timelineView && timelineView.getCurrentDailyNoteDate() === dailyNoteDateForContext) {
                await timelineView.renderTimeline();
                // Re-render the view
                new Notice("PlanSyncGo Timeline View (Panel) updated."); // MODIFIED
            }
        }
    }

    isDailyNote(file: TFile): boolean {
        let folder = this.settings.dailyNoteFolder.trim();
        if (folder.startsWith('/')) folder = folder.substring(1);
        if (folder.endsWith('/')) folder = folder.slice(0, -1);

        const fileNamePattern = /^\d{4}-\d{2}-\d{2}.*\.md$/;
        // Allow for suffixes like YYYY-MM-DD - My Note.md
        if (folder === '') { // Vault root
            return !file.path.contains('/') && fileNamePattern.test(file.name);
        } else {
            const pathToCheck = `${folder}/`;
            return file.path.startsWith(pathToCheck) && fileNamePattern.test(file.name);
        }
    }

    async handleDailyNoteChange(file: TFile) {
        if (this.settings.enableSmartRefresh && this.isDailyNote(file)) {
            if(this.settings.enableInNoteTimeline) {
                this.smartRefreshIfNeeded(file);
                // For in-note timeline
            }
        }
        // For sidebar timeline view
        const timelineView = this.app.workspace.getLeavesOfType(PLANSYNCGO_TIMELINE_VIEW_TYPE)[0]?.view as PlanSyncGoTimelineView; // MODIFIED
        const dateMatch = file.basename.match(/^\d{4}-\d{2}-\d{2}/);
        if (timelineView && dateMatch && timelineView.getCurrentDailyNoteDate() === dateMatch[0]) {
             await timelineView.renderTimeline();
             // Re-render if the modified file is the one shown
        }
    }

    startAutoRefresh() {
        if (this.refreshInterval) window.clearInterval(this.refreshInterval);
        this.refreshInterval = window.setInterval(async () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile && this.isDailyNote(activeFile) && this.settings.enableSmartRefresh) {
                const dateForRefresh = activeFile.basename.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
                if (dateForRefresh) {
                    if (this.settings.enableInNoteTimeline) {
                        await this.checkForCalendarChanges(activeFile, dateForRefresh);
                    }
                    // Also refresh sidebar view if it's showing the current day's note
                    const timelineView = this.app.workspace.getLeavesOfType(PLANSYNCGO_TIMELINE_VIEW_TYPE)[0]?.view as // MODIFIED
                    PlanSyncGoTimelineView; // MODIFIED
                    if (timelineView && timelineView.getCurrentDailyNoteDate() === dateForRefresh) {
                         await timelineView.renderTimeline();
                    }
                }
            }
        }, this.settings.autoRefreshInterval * 1000);
    }

    async smartRefreshIfNeeded(file: TFile) {
        if (!this.settings.enableInNoteTimeline) return;
        const now = Date.now();
        // Throttle smart refresh for in-note timeline to avoid excessive updates on rapid changes
        if (this.isDailyNote(file) && now - this.settings.lastSyncTimestamp > Math.max(30000, (this.settings.autoRefreshInterval * 1000) / 10)) {
            const dateForRefresh = file.basename.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
            if (dateForRefresh) {
                new Notice('Smart Refresh (In-Note) triggered...', 2000);
                await this.checkForCalendarChanges(file, dateForRefresh); // This updates in-note timeline
            }
        }
    }

    async checkForCalendarChanges(file: TFile, dateForCheck: string) {
        if (!this.settings.enableInNoteTimeline) return;
        // Only if in-note timeline is on

        const currentEvents = await this.fetchCalendarEventsForDate(dateForCheck);
        const cachedEvents = this.lastKnownEvents.get(dateForCheck) || [];

        if (this.haveEventsChanged(currentEvents, cachedEvents)) {
            new Notice('📅 Calendar events have changed. Updating In-Note Timeline.');
            await this.updateTimelineContentInNote(file, dateForCheck); // This updates the actual note content
            this.lastKnownEvents.set(dateForCheck, currentEvents);
            // Update cache
            this.settings.lastSyncTimestamp = Date.now();
            // Update last sync timestamp
            await this.saveSettings();
        }
    }

    haveEventsChanged(current: CalendarEvent[], cached: CalendarEvent[]): boolean {
        if (current.length !== cached.length) return true;
        // Simple comparison based on stringified essential fields
        const currentSimplified = current.map(e => ({id: e.id, title: e.title, start: e.start, end: e.end, description: e.description?.substring(0,50)}));
        const cachedSimplified = cached.map(e => ({id: e.id, title: e.title, start: e.start, end: e.end, description: e.description?.substring(0,50)}));
        return JSON.stringify(currentSimplified) !== JSON.stringify(cachedSimplified);
    }

    async forceRefreshInNoteTimeline() {
        if (!this.settings.enableInNoteTimeline) {
            new Notice("In-Note Timeline is disabled in settings.", 3000);
            return;
        }
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || !this.isDailyNote(activeFile)) {
            new Notice('Please open a Daily Note to refresh the In-Note Timeline.');
            return;
        }
        const dateForRefresh = activeFile.basename.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
        if (!dateForRefresh) {
            new Notice('Could not extract a valid date from the filename.');
            return;
        }

        new Notice('Refreshing In-Note Timeline...', 2000);
        try {
            // Fetch fresh events and update the note content
            const events = await this.fetchCalendarEventsForDate(dateForRefresh);
            this.lastKnownEvents.set(dateForRefresh, events); // Update cache first
            await this.updateTimelineContentInNote(activeFile, dateForRefresh);
            // Then update note
            this.settings.lastSyncTimestamp = Date.now();
            await this.saveSettings();
            new Notice('✅ In-Note Timeline refreshed successfully!');
        } catch (error) {
            new Notice(`Error refreshing In-Note Timeline: ${error.message}`, 7000);
            console.error("PlanSyncGo: Error during force refresh (in-note):", error); // MODIFIED
        }
    }

    async updateTimelineContentInNote(file: TFile, dateForView: string) {
        let content = await this.app.vault.read(file);
        const originalContentTrimmed = content.trim(); // For comparison later

        // Define headers for sections to manage
        const timelineHeader = "## 📅 Timeline & Tasks\n";
        // Used by this plugin
        const additionalTasksHeader = "## ✅ Additional Tasks\n";
        // A common user-defined header

        // Remove "Additional Tasks" section if it exists, to avoid duplicating tasks listed in timeline
        // This is a bit opinionated;
        // users might want to manage it differently.
        // For now, we assume timeline is primary for time-blocked items.
        let sectionStartIndex = content.indexOf(additionalTasksHeader);
        if (sectionStartIndex !== -1) {
            let sectionEndIndex = content.length;
            // Default to end of file
            // Try to find the end of this section more intelligently
            const nextKnownHeaderRegex = /\n## \w|\n---|\n\*Tags:|\s*$(?![\r\n])/s;
            // Matches next H2, HR, Tags, or end of content
            const searchArea = content.substring(sectionStartIndex + additionalTasksHeader.length);
            const matchNextHeader = searchArea.match(nextKnownHeaderRegex);
            if (matchNextHeader && typeof matchNextHeader.index === 'number') {
                sectionEndIndex = sectionStartIndex + additionalTasksHeader.length + matchNextHeader.index;
            }
            content = content.substring(0, sectionStartIndex) + content.substring(sectionEndIndex);
        }

        // Find or create the "Timeline & Tasks" section for our plugin's output
        sectionStartIndex = content.indexOf(timelineHeader);
        let timelineEndIndex = -1; // Used to determine where the old timeline content ends

        if (sectionStartIndex !== -1) { // Timeline header exists
            timelineEndIndex = content.length;
            // Default to end of file
            const searchArea = content.substring(sectionStartIndex + timelineHeader.length);
            const nextKnownHeaderRegex = /\n## \w|\n---|\n\*Tags:|\s*$(?![\r\n])/s;
            const matchNextHeader = searchArea.match(nextKnownHeaderRegex);
            if (matchNextHeader && typeof matchNextHeader.index === 'number') {
                timelineEndIndex = sectionStartIndex + timelineHeader.length + matchNextHeader.index;
            }
        }

        if (this.settings.enableInNoteTimeline) {
            const events = this.lastKnownEvents.get(dateForView) ||
            await this.fetchCalendarEventsForDate(dateForView);
            if (!this.lastKnownEvents.has(dateForView)) this.lastKnownEvents.set(dateForView, events); // Cache if freshly fetched

            const newTimelineString = this.generateTimelineView(events, dateForView);
            if (sectionStartIndex !== -1) { // Header exists, replace content
                const before = content.substring(0, sectionStartIndex + timelineHeader.length);
                const after = content.substring(timelineEndIndex);
                content = before + newTimelineString.trimEnd() + (after.startsWith("\n") ? after : "\n" + after) ;
            } else { // Header doesn't exist, append new section
                content = content.trimEnd() + "\n\n" + timelineHeader + newTimelineString.trimEnd() + "\n";
            }
            // this.settings.lastSyncTimestamp = Date.now();
            // Already set by checkForCalendarChanges or forceRefresh
            // await this.saveSettings();
        } else { // In-note timeline is disabled, remove the section if it exists
            if (sectionStartIndex !== -1) {
                const before = content.substring(0, sectionStartIndex);
                const after = content.substring(timelineEndIndex);
                content = before + after; // Remove the whole section
            }
        }

        content = content.replace(/\n{3,}/g, '\n\n').trim();
        // Clean up excessive newlines
        if (content.length > 0) { // Ensure a trailing newline if content exists
            content += '\n';
        }

        if (originalContentTrimmed !== content.trim()) { // Only modify if actual changes were made
            await this.app.vault.modify(file, content);
            if (!this.settings.enableInNoteTimeline && sectionStartIndex !== -1 && originalContentTrimmed.includes(timelineHeader)) {
                 new Notice("In-Note Timeline removed from note.");
            }
        }
    }
}

class OAuthCodeModal extends Modal {
    private authUrl: string;
    private onSubmit: (code: string) => void;
    private codeInput: HTMLInputElement;

    constructor(app: App, authUrl: string, onSubmit: (code: string) => void) {
        super(app);
        this.authUrl = authUrl;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        titleEl.setText('Google Calendar Authorization');

        contentEl.createEl('p', { text: 'Please follow these steps:' });
        const ol = contentEl.createEl('ol');
        const li1 = ol.createEl('li');
        li1.setText('Click the link to open the Google Authorization page: ');
        li1.createEl('a', { href: this.authUrl, text: 'Google Authorization URL', attr: { target: '_blank', rel: 'noopener noreferrer' } });
        ol.createEl('li', { text: 'Sign in and grant the requested calendar permissions.' });
        ol.createEl('li', { text: 'Google will then show you an authorization code. Copy this code.' });
        ol.createEl('li', { text: 'Paste the code here and click "Submit".' });

        contentEl.createEl('p');
        // Spacer
        this.codeInput = contentEl.createEl('input', { type: 'text', placeholder: 'Paste authorization code here' });
        this.codeInput.style.width = '100%';
        this.codeInput.style.marginBottom = '1em';
        this.codeInput.style.padding = '0.5em';

        const submitButton = contentEl.createEl('button', { text: 'Submit', cls: 'mod-cta' });
        submitButton.onclick = () => {
            const code = this.codeInput.value.trim();
            if (code) {
                this.close();
                this.onSubmit(code);
            } else {
                new Notice('Please enter the authorization code.');
                this.codeInput.focus();
            }
        };
        setTimeout(() => this.codeInput.focus(), 50);
        // Auto-focus on input
    }

    onClose() {
        this.contentEl.empty();
    }
}

class PlanSyncGoSettingTab extends PluginSettingTab { // MODIFIED
    plugin: PlanSyncGoPlugin; // MODIFIED
    private connectionStatusEl: HTMLElement;
    constructor(app: App, plugin: PlanSyncGoPlugin) { // MODIFIED
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'PlanSyncGo Settings' }); // MODIFIED

        // --- Google OAuth Section ---
        containerEl.createEl('h3', { text: 'Google Calendar Connection (OAuth 2.0)' });
        new Setting(containerEl)
            .setName('Google OAuth Client ID')
            .setDesc('Your OAuth 2.0 Client ID (Type: Desktop app). You need to create this in the Google Cloud Console and enter it here.')
            .addText(text => text
                .setPlaceholder('Enter Client ID here')
                .setValue(this.plugin.settings.googleOAuthClientId)
                .onChange(async (value) => {
                    this.plugin.settings.googleOAuthClientId = value.trim();
                    await this.plugin.saveSettings();
                    if (this.connectionStatusEl) this.updateConnectionStatus(this.connectionStatusEl); // Update status on change
                }));

        new Setting(containerEl)
            .setName('Google OAuth Client Secret')
            .setDesc('Your OAuth 2.0 Client Secret.')
            .addText(text => text
                .setPlaceholder('Enter Client Secret here')
                .setValue(this.plugin.settings.googleOAuthClientSecret)
                .onChange(async (value) => {
                    this.plugin.settings.googleOAuthClientSecret = value.trim();
                    await this.plugin.saveSettings();
                    if (this.connectionStatusEl) this.updateConnectionStatus(this.connectionStatusEl); // Update status on change
                }));
        new Setting(containerEl)
            .setName('Connect to Google Calendar')
            .setDesc('Click here to start the authorization process or to renew the connection.')
            .addButton(button => button
                .setButtonText(this.plugin.settings.googleOAuthRefreshToken ? 'Reconnect to Google' : 'Connect to Google')
                .setCta()
                .onClick(() => {
                    if (!this.plugin.settings.googleOAuthClientId || !this.plugin.settings.googleOAuthClientSecret) {
                        new Notice("Please enter Client ID and Client Secret first!", 5000);
                        return;
                    }
                    this.plugin.startGoogleOAuth();
                }));
        this.connectionStatusEl = containerEl.createEl('div'); // Element to show connection status
        this.updateConnectionStatus(this.connectionStatusEl);
        // --- Daily Notes Section ---
        containerEl.createEl('h3', { text: 'Daily Notes Configuration' });
        new Setting(containerEl)
            .setName('Daily Notes Folder')
            .setDesc('Path to the folder where your daily notes are stored (e.g., "Daily_Notes" or "Journal/Daily"). Leave empty if your daily notes are in the vault root.')
            .addText(text => text
                .setPlaceholder('e.g., Daily_Notes or empty for root')
                .setValue(this.plugin.settings.dailyNoteFolder)
                .onChange(async (value) => {
                    this.plugin.settings.dailyNoteFolder = value.trim();
                    await this.plugin.saveSettings();
                    new Notice("Daily Notes folder setting saved.");
                }));

        // --- API Key Fallback Section ---
        containerEl.createEl('h3', { text: 'Google Calendar API Key (Optional/Fallback)' });
        containerEl.createEl('p', { text: 'An API Key can be used for read-only access to public calendars if OAuth fails or for quick setup. OAuth is required for write access (task syncing).'});
        new Setting(containerEl)
            .setName('Google Calendar API Key')
            .addText(text => text
                .setPlaceholder('Enter API Key (optional)')
                .setValue(this.plugin.settings.googleCalendarApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.googleCalendarApiKey = value.trim();
                    await this.plugin.saveSettings();
                }));
        // --- Calendar IDs Section ---
        containerEl.createEl('h3', { text: 'Calendar IDs' });
        new Setting(containerEl)
            .setName('Main Calendar ID')
            .setDesc('The ID of your primary Google Calendar (often your email address, or "primary").')
            .addText(text => text
                .setPlaceholder('e.g., your.email@gmail.com or primary')
                .setValue(this.plugin.settings.calendarId)
                .onChange(async (value) => {
                    this.plugin.settings.calendarId = value.trim();
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName('Enable Work Calendar')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableWorkCalendar)
                .onChange(async (value) => {
                    this.plugin.settings.enableWorkCalendar = value;
                    await this.plugin.saveSettings();
                    this.display(); // Re-render settings to show/hide work calendar ID field
                }));
        if (this.plugin.settings.enableWorkCalendar) {
            new Setting(containerEl)
                .setName('Work Calendar ID')
                .setDesc('ID of your work calendar.')
                .addText(text => text
                    .setPlaceholder('e.g., work.email@company.com')
                    .setValue(this.plugin.settings.workCalendarId)
                    .onChange(async (value) => {
                        this.plugin.settings.workCalendarId = value.trim();
                        await this.plugin.saveSettings();
                    }));
        }

        // --- In-Note Timeline Section ---
        containerEl.createEl('h3', { text: 'In-Note Display' });
        new Setting(containerEl)
            .setName('Show/Manage Text Timeline in Daily Note')
            .setDesc('If enabled, a text-based timeline will be inserted and updated directly in the Daily Note. Default: Disabled.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableInNoteTimeline)
                .onChange(async (value) => {
                    this.plugin.settings.enableInNoteTimeline = value;
                    await this.plugin.saveSettings();
                    // Try to update current daily note immediately if one is active
                    const activeFile = this.app.workspace.getActiveFile();
                    if (activeFile && this.plugin.isDailyNote(activeFile)) {
                        const noteDateStr = activeFile.basename.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || moment().format('YYYY-MM-DD');
                        await this.plugin.updateTimelineContentInNote(activeFile, noteDateStr);
                    }
                    new Notice(`In-Note Timeline ${value ? 'enabled' : 'disabled'}.`);
                }));
        // --- Event Colors Section ---
        containerEl.createEl('h3', { text: 'Timeline Event Colors (Sidebar View)' });
        new Setting(containerEl)
            .setName('Background Color for Obsidian Tasks')
            .setDesc('Color for events created from Obsidian Tasks and synced to Google Calendar.')
            .addColorPicker(color => color
                .setValue(this.plugin.settings.obsidianTaskEventColor)
                .onChange(async (value) => {
                    this.plugin.settings.obsidianTaskEventColor = value;
                    await this.plugin.saveSettings();
                    this.plugin.triggerTimelineViewRefresh(); // Refresh view to show new color
                }));
        new Setting(containerEl)
            .setName('Text Color for Obsidian Tasks')
            .addColorPicker(color => color
                .setValue(this.plugin.settings.obsidianTaskEventTextColor)
                .onChange(async (value) => {
                    this.plugin.settings.obsidianTaskEventTextColor = value;
                    await this.plugin.saveSettings();
                    this.plugin.triggerTimelineViewRefresh();
                }));
        new Setting(containerEl)
            .setName('Background Color for Google Calendar Events')
            .setDesc('Color for pure Google Calendar events (not linked to Obsidian tasks).')
            .addColorPicker(color => color
                .setValue(this.plugin.settings.googleCalendarEventColor)
                .onChange(async (value) => {
                    this.plugin.settings.googleCalendarEventColor = value;
                    await this.plugin.saveSettings();
                    this.plugin.triggerTimelineViewRefresh();
                }));
        new Setting(containerEl)
            .setName('Text Color for Google Calendar Events')
            .addColorPicker(color => color
                .setValue(this.plugin.settings.googleCalendarEventTextColor)
                .onChange(async (value) => {
                    this.plugin.settings.googleCalendarEventTextColor = value;
                    await this.plugin.saveSettings();
                    this.plugin.triggerTimelineViewRefresh();
                }));
        // --- Timeline Display Section ---
        containerEl.createEl('h3', { text: 'Timeline Display (General)' });
        new Setting(containerEl)
            .setName('Timeline Start Hour')
            .setDesc('The first hour displayed in the timelines (0-23).')
            .addSlider(slider => slider
                .setLimits(0, 23, 1)
                .setValue(this.plugin.settings.timelineStartHour)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.timelineStartHour = value;
                    await this.plugin.saveSettings();
                    this.plugin.triggerTimelineViewRefresh(); // Refresh view with new hours
                    if (this.plugin.settings.enableInNoteTimeline) this.plugin.forceRefreshInNoteTimeline(); // Also refresh in-note if active
                }));
        new Setting(containerEl)
            .setName('Timeline End Hour')
            .setDesc('The last hour displayed in the timelines (must be >= start hour, 0-23).')
            .addSlider(slider => slider
                .setLimits(0, 23, 1)
                .setValue(this.plugin.settings.timelineEndHour)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    if (value >= this.plugin.settings.timelineStartHour) {
                        this.plugin.settings.timelineEndHour = value;
                        await this.plugin.saveSettings();
                        this.plugin.triggerTimelineViewRefresh();
                        if (this.plugin.settings.enableInNoteTimeline) this.plugin.forceRefreshInNoteTimeline();
                    }
                }));
        // --- Synchronization Section ---
        containerEl.createEl('h3', { text: 'Synchronization' });
        new Setting(containerEl)
            .setName('Sync Tag for Tasks Plugin')
            .setDesc('Tag that marks tasks for sync (e.g., #gcal). Also recognized in manual mode. Ensure it does not conflict with other tags.')
            .addText(text => text
                .setPlaceholder('#gcal')
                .setValue(this.plugin.settings.tasksPluginSyncTag)
                .onChange(async (value) => {
                    this.plugin.settings.tasksPluginSyncTag = value.trim() || DEFAULT_SETTINGS.tasksPluginSyncTag;
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName('Sync tasks to calendar by default (manual mode)')
            .setDesc('LEGACY SETTING: If enabled and NO sync tag/field ([sync::true]) is present, tasks in manual parsing mode will be synced. Recommendation: Use the sync tag or [sync::true] field for clarity.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSyncToCalendar)
                .onChange(async (value) => {
                    this.plugin.settings.autoSyncToCalendar = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName('Default Event Duration (minutes)')
            .setDesc('Duration for new calendar events from tasks without an explicit duration (e.g., [duration::NNN] or Tasks plugin syntax).')
            .addText(textComponent => textComponent
                .setValue(this.plugin.settings.defaultEventDuration.toString())
                .setPlaceholder('60')
                .onChange(async (value: string) => {
                    const numValue = parseInt(value);
                    if (!isNaN(numValue) && numValue > 0) {
                        this.plugin.settings.defaultEventDuration = numValue;
                    } else { // Reset to default if invalid
                        this.plugin.settings.defaultEventDuration = DEFAULT_SETTINGS.defaultEventDuration; // Use actual default
                        textComponent.setValue(this.plugin.settings.defaultEventDuration.toString()); // Update UI
                        new Notice("Invalid input for event duration. Reset to default.", 3000);
                    }
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName('Enable Smart Refresh (Sidebar & In-Note Timeline)')
            .setDesc('Automatically refresh timelines when calendar events might have changed or the daily note is opened/modified. Checks periodically.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableSmartRefresh)
                .onChange(async (value) => {
                    this.plugin.settings.enableSmartRefresh = value;
                    await this.plugin.saveSettings();
                    if (value) this.plugin.startAutoRefresh(); // Start interval if enabled
                    else if (this.plugin.refreshInterval) window.clearInterval(this.plugin.refreshInterval); // Stop if disabled
                }));
        new Setting(containerEl)
            .setName('Auto-Refresh Interval (seconds)')
            .setDesc('How often to check for calendar changes in the background (if Smart Refresh is active). Minimum 60s.')
            .addSlider(slider => slider
                .setLimits(60, 1800, 60) // e.g., 1min to 30min, in 1min steps
                .setValue(this.plugin.settings.autoRefreshInterval)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.autoRefreshInterval = value;
                    await this.plugin.saveSettings();
                    if (this.plugin.settings.enableSmartRefresh) this.plugin.startAutoRefresh(); // Restart with new interval
                }));
        // --- Usage Guide Section ---
        containerEl.createEl('h3', { text: 'Usage Guide (Updated)' });
        const usageEl = containerEl.createEl('div');
        // Corrected Template Literal:
        usageEl.innerHTML = `
            <p><strong>Setup:</strong></p>
            <ol>
                <li>Google Cloud Console: Create OAuth Client ID & Secret (Type: Desktop app). Enable the Google Calendar API for your project.</li>
                <li>Enter Client ID and Client Secret here in the PlanSyncGo settings.</li> <li>(Optional) Specify your Daily Notes folder if not in the vault root.</li>
                <li>Click "Connect to Google" and follow the authorization prompts.</li>
                <li>Enter Calendar IDs (e.g., "primary" or your email for the main calendar).</li>
                <li>(Optional) Customize the sync tag (Default: <code>${DEFAULT_SETTINGS.tasksPluginSyncTag}</code>).</li>
            </ol>
            <p><strong>Daily Notes & Templates:</strong></p>
            <ul>
                <li>The command "PlanSyncGo: Open Daily Note for PlanSyncGo" creates new daily notes in the configured folder (or vault root) named <code>YYYY-MM-DD.md</code>.</li> <li>These notes are created <strong>empty</strong> by PlanSyncGo. This allows you to use Obsidian's native Templater or other templating plugins to populate new daily notes. Configure your templates as usual.</li> <li>Use the "Show/Manage Text Timeline in Daily Note" setting to control if PlanSyncGo inserts its text-based hourly timeline into the note.</li> </ul>
            <p><strong>Task Synchronization (Obsidian as primary source for task details):</strong></p>
            <ul>
                <li>Use "PlanSyncGo: Sync Tasks with Google Calendar (PlanSyncGo)" (operates on the currently active file).</li> <li><strong>Obsidian Task -&gt; Google Calendar Event:</strong> Creates, updates, or deletes events on Google Calendar based on changes to tasks in Obsidian.</li>
                <li><strong>Google Calendar Event (created by PlanSyncGo) deleted in GCal -&gt; Obsidian Task:</strong> The linked Obsidian task is marked as completed (<code>- [x]</code>) and its GCal link is removed.</li> <li><strong>Important:</strong> Direct changes to event titles or times in Google Calendar are <em>not</em> synced back to the Obsidian task. Obsidian is the source of truth for task content and its specific date/time.</li>
                <li><strong>Task Syntax for Syncing:</strong>
                    <ul>
                        <li>Must contain the sync tag (e.g., <code>${this.plugin.settings.tasksPluginSyncTag}</code>) OR an inline field <code>[sync::true]</code>.</li>
                        <li>Must have a date (<code>📅YYYY-MM-DD</code>) and a time (<code>⏰ HH:MM</code>) for a precise calendar entry. If in a daily note, time alone is sufficient (date is inferred from note title).</li>
                        <li>Optional: duration via <code>[duration::NNN]</code> (in minutes).</li>
                        <li>The plugin will add/manage <code>[obsidianTaskId::...]</code> and <code>[gcalEventId::...]</code>.</li>
                        <li><strong>Correct Order for Tasks Plugin:</strong> Ensure date/time emojis are at the end of the task line, ideally <code>... ⏰ HH:MM 📅 YYYY-MM-DD</code>. PlanSyncGo attempts to reformat this automatically.</li> </ul>
                </li>
                <li><strong>Example (with Tasks Plugin):</strong><br>
                    <code>- [ ] Call John ⏰ 14:30 📅 2025-07-15 ${this.plugin.settings.tasksPluginSyncTag} [duration::30]</code>
                </li>
                <li><strong>Manual Mode (if Tasks Plugin not detected):</strong> Syntax is similar. Inline fields are generally more reliable.</li>
            </ul>
            <p><strong>Sidebar Timeline View:</strong></p>
            <ul>
                <li>Opens via command "PlanSyncGo: Open PlanSyncGo Timeline View (Sidebar)".</li> <li>Shows events for the date of the currently active daily note.</li>
                <li>Displays current time with a red line (for today's date only).</li>
            </ul>
        `;
    } // Closes display()

    updateConnectionStatus(element: HTMLElement) {
        element.empty();
        if (this.plugin.settings.googleOAuthRefreshToken) {
            const expiryDate = new Date(this.plugin.settings.googleOAuthTokenExpiry);
            const isTokenValid = expiryDate > new Date(Date.now() + 60000); // Check if valid for at least 1 more minute
            element.createEl('p', {
                text: `Status: Connected. ${isTokenValid ? 'Access Token valid until: ' + expiryDate.toLocaleString() : 'Access Token expired or invalid.'}`,
                cls: isTokenValid ? 'timeline-sync-success' : 'timeline-sync-warning' // Use CSS classes for styling
            });
            if (!isTokenValid && this.plugin.settings.googleOAuthRefreshToken) {
                 element.createEl('p', { text: 'The plugin will attempt to renew the token automatically. If issues persist, please use the "Reconnect to Google" button.', cls: 'timeline-sync-warning'});
            }
        } else {
            if (!this.plugin.settings.googleOAuthClientId || !this.plugin.settings.googleOAuthClientSecret) {
                element.createEl('p', { text: 'Status: Not connected. Please enter Client ID and Client Secret, then connect.', cls: 'timeline-sync-error' });
            } else {
                element.createEl('p', { text: 'Status: Not connected to Google Calendar. Click the button above to connect.', cls: 'timeline-sync-error' });
            }
        }
    }
} // Closes PlanSyncGoSettingTab // MODIFIED
