import { ItemView, WorkspaceLeaf, TFile, moment, Notice } from 'obsidian';
import PlanSyncGoPlugin from './main'; // MODIFIED
import { CalendarEvent } from './main';

export const PLANSYNCGO_TIMELINE_VIEW_TYPE = 'plansyncgo-timeline-view'; // MODIFIED

const MINUTE_HEIGHT = 1.5;
const MIN_EVENT_BLOCK_DISPLAY_HEIGHT = 20;
const MIN_TITLE_TEXT_DISPLAY_HEIGHT = 18;
const MIN_TIME_TEXT_DISPLAY_HEIGHT = 32;

interface CalendarEventWithLayout extends CalendarEvent {
    layout?: {
        column: number;
        numColumns: number;
        left?: string;
        width?: string;
    };
    _processed?: boolean;
    _collidesWith?: number[];
}

export class PlanSyncGoTimelineView extends ItemView { // MODIFIED
    plugin: PlanSyncGoPlugin; // MODIFIED
    private currentDailyNoteDate: string | null = null;
    private isCurrentlyRendering: boolean = false;
    private lastEventsSignature: string = "";
    public viewHasRenderedOnceForCurrentDate: boolean = false;

    private currentTimeIndicatorEl: HTMLElement |
    null = null;
    private currentTimeUpdateInterval: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: PlanSyncGoPlugin) { // MODIFIED
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return PLANSYNCGO_TIMELINE_VIEW_TYPE; // MODIFIED
    }

    getDisplayText() {
        return 'PlanSyncGo Timeline'; // MODIFIED
    }

    public getCurrentDailyNoteDate(): string | null {
        return this.currentDailyNoteDate;
    }

    private _hexToRgba(hex: string, alpha: number = 1): string {
        hex = hex.replace('#', '');
        if (hex.length === 3) {
            hex = hex.split('').map(char => char + char).join('');
        }
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) {
            console.warn(`PlanSyncGo: Invalid hex color code for RGBA conversion: #${hex}`); // MODIFIED [cite: 547]
            return `rgba(128, 128, 128, ${alpha})`;
        }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    private _generateEventsSignature(events: CalendarEvent[]): string {
        const simplifiedEvents = events.map(e => ({
            id: e.id,
            title: e.title,
            start: e.start,
            end: e.end,
            desc: e.description ? e.description.substring(0, 60) : ""
        }));
        return JSON.stringify(simplifiedEvents) +
               this.plugin.settings.obsidianTaskEventColor +
               this.plugin.settings.obsidianTaskEventTextColor +
               this.plugin.settings.googleCalendarEventColor +
               this.plugin.settings.googleCalendarEventTextColor;
    }

    async displayCalendarIfNeeded() {
        const calendarPluginId = 'calendar';
        const calendarViewType = 'calendar';

        if (!(this.app as any).plugins.enabledPlugins.has(calendarPluginId)) {
            return;
        }

        const currentTimelineLeaf = this.leaf;
        const root = currentTimelineLeaf.getRoot();
        let targetSidebarSplit: 'left' |
        'right' | null = null;

        if (root === this.app.workspace.leftSplit) {
            targetSidebarSplit = 'left';
        } else if (root === this.app.workspace.rightSplit) {
            targetSidebarSplit = 'right';
        }

        if (!targetSidebarSplit) {
            return;
        }

        let calendarLeaf: WorkspaceLeaf | null |
        undefined = this.app.workspace.getLeavesOfType(calendarViewType)
            .find(leaf => leaf.getRoot() === root);
        if (!calendarLeaf) {
            if (targetSidebarSplit === 'left') {
                calendarLeaf = this.app.workspace.getLeftLeaf(true);
            } else {
                calendarLeaf = this.app.workspace.getRightLeaf(true);
            }

            if (calendarLeaf) {
                const currentState = calendarLeaf.getViewState();
                if (currentState.type === 'empty' || currentState.type === calendarViewType) {
                    await calendarLeaf.setViewState({ type: calendarViewType, active: false });
                } else {
                    calendarLeaf = null;
                }
            } else {
                console.error("PlanSyncGo: Could not get/create a leaf in the target sidebar."); // MODIFIED [cite: 564]
                return;
            }
        }

        if (calendarLeaf) {
            this.app.workspace.revealLeaf(calendarLeaf);
        }
        this.app.workspace.revealLeaf(currentTimelineLeaf);
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        // container.createEl('h4', { text: this.getDisplayText() }); // Überschrift wurde entfernt
        container.createEl('p', { text: 'Loading data...' });

        this.app.workspace.onLayoutReady(async () => {
            await this.displayCalendarIfNeeded();
        });
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', async () => {
                if (this.leaf.getRoot() === this.app.workspace.leftSplit || this.leaf.getRoot() === this.app.workspace.rightSplit) {
                    this.app.workspace.onLayoutReady(async () => {
                        await this.displayCalendarIfNeeded();
                    });
                }
                await this.updateViewForActiveFile();
            })
        );
        this.app.workspace.onLayoutReady(async () => {
            await this.updateViewForActiveFile();
        });
        this.currentTimeUpdateInterval = window.setInterval(() => {
            this.updateCurrentTimeIndicator();
        }, 60 * 1000);
    }

    async onClose() {
        if (this.currentTimeUpdateInterval) {
            window.clearInterval(this.currentTimeUpdateInterval);
            this.currentTimeUpdateInterval = null;
        }
        if (this.currentTimeIndicatorEl) {
            this.currentTimeIndicatorEl.remove();
            this.currentTimeIndicatorEl = null;
        }
    }

    async updateViewForActiveFile() {
        const activeFile = this.app.workspace.getActiveFile();
        let newDate: string | null = null;
        if (activeFile && this.plugin.isDailyNote(activeFile)) {
            const dateMatch = activeFile.basename.match(/^\d{4}-\d{2}-\d{2}/);
            if (dateMatch && dateMatch[0]) newDate = dateMatch[0];
        }

        if (this.currentDailyNoteDate !== newDate) {
            this.currentDailyNoteDate = newDate;
            this.viewHasRenderedOnceForCurrentDate = false;
            this.lastEventsSignature = "";
        }

        if (this.currentDailyNoteDate && (this.leaf.getRoot() === this.app.workspace.leftSplit || this.leaf.getRoot() === this.app.workspace.rightSplit)) {
             this.app.workspace.onLayoutReady(async () => {
                await this.displayCalendarIfNeeded();
            });
        }

        if (this.currentDailyNoteDate) {
            await this.renderTimeline();
        } else {
            this.viewHasRenderedOnceForCurrentDate = false; this.lastEventsSignature = "";
            this.renderEmptyState(activeFile && this.plugin.isDailyNote(activeFile) && !this.currentDailyNoteDate
                ? "Could not recognize date of Daily Note."
                : `Please open a Daily Note to display the ${this.getDisplayText()}.`);
            if (this.currentTimeIndicatorEl) {
                this.currentTimeIndicatorEl.style.display = 'none';
            }
        }
    }

    renderEmptyState(message: string) {
        const container = this.containerEl.children[1];
        container.empty();
        this.currentTimeIndicatorEl = null;
        // container.createEl('h4', { text: this.getDisplayText() });
        container.createEl('p', { text: message });
        this.viewHasRenderedOnceForCurrentDate = false;
        this.lastEventsSignature = "";
    }

    private updateCurrentTimeIndicator() {
        if (!this.currentDailyNoteDate) {
            if (this.currentTimeIndicatorEl) {
                this.currentTimeIndicatorEl.style.display = 'none';
            }
            return;
        }

        const contentArea = this.containerEl.children[1];
        const eventsAreaEl = contentArea.querySelector('.timeline-events-area') as HTMLElement;
        if (!eventsAreaEl) {
            if (this.currentTimeIndicatorEl) {
                this.currentTimeIndicatorEl.remove();
                this.currentTimeIndicatorEl = null;
            }
            return;
        }

        const now = moment();
        if (!now.isSame(moment(this.currentDailyNoteDate, 'YYYY-MM-DD'), 'day')) {
            if (this.currentTimeIndicatorEl) {
                this.currentTimeIndicatorEl.style.display = 'none';
            }
            return;
        }

        const timelineStartHour = this.plugin.settings.timelineStartHour;
        const timelineEndHour = this.plugin.settings.timelineEndHour;
        const viewWindowStartMomentToday = moment(this.currentDailyNoteDate, 'YYYY-MM-DD').startOf('day').hour(timelineStartHour);
        let currentMinutesInView = now.diff(viewWindowStartMomentToday, 'minutes');
        const totalDurationOfViewInMinutes = (timelineEndHour - timelineStartHour + 1) * 60;
        if (currentMinutesInView < 0 || currentMinutesInView >= totalDurationOfViewInMinutes) {
            if (this.currentTimeIndicatorEl) {
                this.currentTimeIndicatorEl.style.display = 'none';
            }
            return;
        }

        if (!this.currentTimeIndicatorEl || !this.currentTimeIndicatorEl.parentElement) {
            if (this.currentTimeIndicatorEl) this.currentTimeIndicatorEl.remove();
            this.currentTimeIndicatorEl = document.createElement('div');
            this.currentTimeIndicatorEl.classList.add('timeline-current-time-indicator');
            eventsAreaEl.appendChild(this.currentTimeIndicatorEl);
        }

        this.currentTimeIndicatorEl.style.top = `${currentMinutesInView * MINUTE_HEIGHT}px`;
        this.currentTimeIndicatorEl.style.display = 'block';
    }

    private _calculateEventLayouts(events: CalendarEventWithLayout[]): void {
        if (!events || events.length === 0) return;
        events.sort((a, b) => {
            const startDiff = moment(a.start).diff(moment(b.start));
            if (startDiff !== 0) return startDiff;
            return moment(b.end).diff(moment(a.end));
        });
        for (const event of events) {
            event.layout = { column: 0, numColumns: 1 };
            event._collidesWith = [];
            event._processed = false;
        }

        for (let i = 0; i < events.length; i++) {
            for (let j = i + 1; j < events.length; j++) {
                if (moment(events[i].start).isBefore(moment(events[j].end)) && moment(events[i].end).isAfter(moment(events[j].start))) {
                    events[i]._collidesWith!.push(j);
                    events[j]._collidesWith!.push(i);
                }
            }
        }

        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (event._processed) continue;

            let currentCluster: CalendarEventWithLayout[] = [event];
            let q = [event];
            event._processed = true;
            let head = 0;
            while(head < q.length){
                let curr = q[head++];
                curr._collidesWith?.forEach(collidingIdx => {
                    if(!events[collidingIdx]._processed){
                        events[collidingIdx]._processed = true;
                        q.push(events[collidingIdx]);
                        currentCluster.push(events[collidingIdx]);
                    }
                });
            }

            currentCluster.sort((a,b)=> {
                 const startDiff = moment(a.start).diff(moment(b.start));
                 if (startDiff !== 0) return startDiff;
                 return moment(a.end).diff(moment(b.end));
            });
            let maxColumnsInCluster = 0;
            const columns: CalendarEventWithLayout[][] = [];

            for(const clusterEvent of currentCluster){
                let k = 0;
                while(true){
                    if(!columns[k]){
                        columns[k] = [clusterEvent];
                        clusterEvent.layout!.column = k;
                        break;
                    }
                    const lastInColumn = columns[k][columns[k].length-1];
                    if(!moment(clusterEvent.start).isBefore(moment(lastInColumn.end))){
                        columns[k].push(clusterEvent);
                        clusterEvent.layout!.column = k;
                        break;
                    }
                    k++;
                }
                maxColumnsInCluster = Math.max(maxColumnsInCluster, k + 1);
            }

            for(const clusterEvent of currentCluster){
                clusterEvent.layout!.numColumns = maxColumnsInCluster;
            }
        }

        for (const event of events) {
            if (!event.layout) continue;
            const numCols = Math.max(1, event.layout.numColumns);
            const colIdx = Math.max(0, event.layout.column);

            const PADDING_BETWEEN_EVENTS_PERCENT = 1;
            let colWidthPercent = (100 - (numCols - 1) * PADDING_BETWEEN_EVENTS_PERCENT) / numCols;
            let leftPercent = colIdx * (colWidthPercent + PADDING_BETWEEN_EVENTS_PERCENT);
            if (numCols === 1) {
                leftPercent = 0;
                colWidthPercent = 100;
                event.layout.left = `0%`;
                event.layout.width = `100%`;
            } else {
                 event.layout.left = `${leftPercent}%`;
                 event.layout.width = `${colWidthPercent}%`;
            }
        }
    }

    async renderTimeline() {
        if (this.isCurrentlyRendering) {
            return;
        }
        this.isCurrentlyRendering = true;
        try {
            if (!this.currentDailyNoteDate) {
                this.renderEmptyState("No date available for the timeline.");
                this.isCurrentlyRendering = false;
                return;
            }

            const rawEvents = await this.plugin.fetchCalendarEventsForDate(this.currentDailyNoteDate);
            const eventsWithLayout: CalendarEventWithLayout[] = rawEvents.map(e => ({...e, _processed: false, _collidesWith: [] }));

            const newSignature = this._generateEventsSignature(eventsWithLayout);
            if (this.viewHasRenderedOnceForCurrentDate && newSignature === this.lastEventsSignature) {
                this.isCurrentlyRendering = false;
                this.updateCurrentTimeIndicator();
                return;
            }

            this._calculateEventLayouts(eventsWithLayout);
            const container = this.containerEl.children[1];
            container.empty();
            this.currentTimeIndicatorEl = null;

            // container.createEl('h4', { text: `${this.getDisplayText()} for: ${this.currentDailyNoteDate}` });

            const timelineStartHour = this.plugin.settings.timelineStartHour;
            const timelineEndHour = this.plugin.settings.timelineEndHour;
            const totalDisplayedHours = timelineEndHour - timelineStartHour + 1;

            const timelineWrapperEl = container.createDiv({ cls: 'timeline-wrapper' });
            const hoursAxisEl = timelineWrapperEl.createDiv({cls: 'timeline-hours-axis'});
            const eventsAreaEl = timelineWrapperEl.createDiv({cls: 'timeline-events-area'});
            eventsAreaEl.style.height = `${totalDisplayedHours * (60 * MINUTE_HEIGHT)}px`;
            for (let i = 0; i <= totalDisplayedHours; i++) {
                const currentHour = timelineStartHour + i;
                const hourLabelContainerEl = hoursAxisEl.createDiv({ cls: 'timeline-hour-label-entry' });
                hourLabelContainerEl.style.height = `${60 * MINUTE_HEIGHT}px`;
                if (i < totalDisplayedHours) {
                    const mainHourTextEl = hourLabelContainerEl.createDiv({ cls: 'timeline-main-hour-text' });
                    mainHourTextEl.setText(`${currentHour.toString().padStart(2, '0')}:00`);

                    const quarterHourMarkers = [15, 30, 45];
                    if ((15 * MINUTE_HEIGHT) >= 12) { // Only show if space permits
                        for (const minute of quarterHourMarkers) {
                            const markerTopOffset = minute * MINUTE_HEIGHT;
                            const quarterHourLabelEl = hourLabelContainerEl.createDiv({ cls: 'timeline-quarter-hour-label' });
                            quarterHourLabelEl.setText(`:${minute.toString().padStart(2, '0')}`);
                            quarterHourLabelEl.style.position = 'absolute';
                            quarterHourLabelEl.style.top = `${markerTopOffset}px`;
                        }
                    }
                }

                const hourLineEl = eventsAreaEl.createDiv({ cls: 'timeline-hour-line' });
                hourLineEl.style.top = `${i * (60 * MINUTE_HEIGHT)}px`;

                if (i < totalDisplayedHours) {
                    const quarterHourLineMinutes = [15, 30, 45];
                    for (const minute of quarterHourLineMinutes) {
                        const currentHourAbsoluteTop = i * (60 * MINUTE_HEIGHT);
                        const subLineTopOffset = currentHourAbsoluteTop + (minute * MINUTE_HEIGHT);

                        const quarterHourGridLineEl = eventsAreaEl.createDiv({ cls: 'timeline-quarter-hour-grid-line' });
                        quarterHourGridLineEl.style.top = `${subLineTopOffset}px`;
                    }
                }
            }

            const viewWindowStartMoment = moment(this.currentDailyNoteDate).startOf('day').hour(timelineStartHour);
            eventsWithLayout.forEach(event => {
                const eventStartMoment = moment(event.start);
                const eventEndMoment = moment(event.end);

                if (eventEndMoment.isBefore(viewWindowStartMoment) || eventStartMoment.isAfter(viewWindowStartMoment.clone().add(totalDisplayedHours, 'hours'))) {
                    return;
                }

                let durationMinutes = eventEndMoment.diff(eventStartMoment, 'minutes');
                if (eventStartMoment.isSame(eventEndMoment, 'day') && !event.start.includes('T') && !event.end.includes('T')) { // All-day event for current day
                    if (durationMinutes <= 0) durationMinutes = 20; // Give all-day events a small visible duration
                } else if (durationMinutes <= 0) { // Default duration for zero/negative duration timed events
                    durationMinutes = this.plugin.settings.defaultEventDuration;
                }

                let startOffsetMinutes = eventStartMoment.diff(viewWindowStartMoment, 'minutes');

                const eventBlockEl = eventsAreaEl.createDiv({ cls: 'timeline-event-block' });
                const transparencyAlpha = 0.75;
                if (event.obsidianTaskIdFromDescription) {
                    eventBlockEl.style.backgroundColor = this._hexToRgba(this.plugin.settings.obsidianTaskEventColor, transparencyAlpha);
                    eventBlockEl.style.color = this.plugin.settings.obsidianTaskEventTextColor;
                } else {
                    eventBlockEl.style.backgroundColor = this._hexToRgba(this.plugin.settings.googleCalendarEventColor, transparencyAlpha);
                    eventBlockEl.style.color = this.plugin.settings.googleCalendarEventTextColor;
                }

                let actualEventHeightBasedOnDuration = durationMinutes * MINUTE_HEIGHT;
                const displayBlockHeight = Math.max(actualEventHeightBasedOnDuration, MIN_EVENT_BLOCK_DISPLAY_HEIGHT);
                let topPosition = startOffsetMinutes * MINUTE_HEIGHT;

                if (topPosition < 0) { // Event started before the timeline view window begins
                    // Adjust height to only show the part visible within the window
                    actualEventHeightBasedOnDuration = Math.max(0, (eventEndMoment.diff(viewWindowStartMoment, 'minutes')) * MINUTE_HEIGHT);
                    topPosition = 0;
                }

                const maxViewHeightForBlock = (totalDisplayedHours * 60 * MINUTE_HEIGHT) - topPosition;
                const finalVisibleHeight = Math.min( Math.max(actualEventHeightBasedOnDuration, MIN_EVENT_BLOCK_DISPLAY_HEIGHT) , maxViewHeightForBlock);


                if (finalVisibleHeight <= 0.5 * MINUTE_HEIGHT) return; // Don't render if too small to be useful

                eventBlockEl.style.top = `${topPosition}px`;
                eventBlockEl.style.height = `${finalVisibleHeight}px`;

                if (event.layout && event.layout.width && event.layout.left) {
                    eventBlockEl.style.width = event.layout.width;
                    eventBlockEl.style.left = event.layout.left;
                } else {
                    eventBlockEl.style.left = `0%`;
                    eventBlockEl.style.width = `100%`;
                }

                if (finalVisibleHeight >= MIN_TITLE_TEXT_DISPLAY_HEIGHT) {
                    eventBlockEl.createEl('div', { text: event.title, cls: 'timeline-event-title' });
                    if (finalVisibleHeight >= MIN_TIME_TEXT_DISPLAY_HEIGHT) {
                        const displayTime = `${eventStartMoment.format('HH:mm')} - ${eventEndMoment.format('HH:mm')}`;
                        eventBlockEl.createEl('div', { text: displayTime, cls: 'timeline-event-time' });
                    }
                } else {
                    eventBlockEl.setAttribute('title', `${event.title} (${eventStartMoment.format('HH:mm')} - ${eventEndMoment.format('HH:mm')})`);
                }
            });

            this.lastEventsSignature = newSignature;
            this.viewHasRenderedOnceForCurrentDate = true;
            this.updateCurrentTimeIndicator();
        } catch (error) {
            console.error("PlanSyncGo: Error rendering timeline in view:", error); // MODIFIED [cite: 660]
            const container = this.containerEl.children[1];
            container.empty();
            this.currentTimeIndicatorEl = null;
            container.createEl('h4', { text: this.getDisplayText() + ' Error' }); // getDisplayText() is now 'PlanSyncGo Timeline'
            container.createEl('p', { text: `Error loading timeline: ${error.message}` });
            this.viewHasRenderedOnceForCurrentDate = false;
            this.lastEventsSignature = "";
        } finally {
            this.isCurrentlyRendering = false;
        }
    }
}
