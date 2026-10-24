# ACT Companion: interaction notes

Static design export. Markup uses only classes from `companion.css`; icons come from `icons.svg` (`<svg class="icon"><use href="icons.svg#i-name"></use></svg>`). No inline scripts or `onclick`; wire everything from a separate JS file. All motion is disabled under `prefers-reduced-motion`.

## Fonts and icons
- Inter (SIL Open Font License 1.1). Add `fonts/InterVariable.woff2` from the official Inter release; until then the system UI font is used.
- Phosphor Icons, regular weight (MIT). The sprite holds only the icons used.

## Themes
- `data-theme` on `<html>`: `nocturne`, `graphite`, `daylight`, `paper`. No attribute = follow the system (Nocturne when dark, Daylight when light).
- `theme.js` applies the saved choice before first paint. Settings > Appearance writes `localStorage.theme` (`system` removes the key), sets the attribute, and shows the toast "Theme set to …".
- Theme previews in Settings carry their own `data-theme`, so they always render in that theme's colors.

## Shell
- Desktop (wider than 760px): left sidebar, sticky. The current page has `aria-current="page"`. Counts in the nav update with the data.
- Phone (760px or narrower, a container query on `.viewport`): top bar with search and notifications, bottom tab bar Home, Planner, Courses, Messages, More. More opens a list: Deadlines, Grades, Notifications, Settings.
- Search: `Ctrl K` or `/` (when focus is not in a text field) opens the palette from anywhere.

## Search palette
- Opens over the page (`.palette-backdrop`); focus goes to the input; the page behind is inert.
- Results filter as you type, grouped Pages, Courses, Deadlines, Files and activities. Up and Down arrows move `aria-selected` across groups; Enter opens; Esc or a backdrop click closes and returns focus to where it was.
- Fade in 120 ms; no motion with reduced motion.

## Home
- Each count links to its page (due this week and overdue to Deadlines, unread to Notifications or Messages).
- "New in your courses" block: render only when Course changes alerts are on. It uses the same `.block` + `.note-row` pattern, placed under Latest notifications.

## Planner
- Week grid: Overdue column, then today and the next six days. "Previous week" and "Next week" move one week at a time (also Alt+Left and Alt+Right, and swipe on phones); "This week" jumps back and is disabled when you are already on it. The week is kept in the URL (`#/planner?week=2026-W44`).
- Overdue stays pinned on the left whatever week is shown. For past and future weeks the list below is titled "Due in week N" and shows only that week's items.
- Clicking a `.due` item opens the assignment in Moodle. On phones the days scroll sideways with scroll snap.
- Up next: sorted by due time. Countdown shows hours under 24 h, days after; overdue shows days late in the danger color.

## Deadlines
- Groups: Overdue, Today, Tomorrow, Next 7 days, Later. Empty groups are hidden. With nothing in the first four, show the "You're all caught up" empty state.
- Course select filters rows in place.
- The action button text is Moodle's own label (Add submission, View, Attempt quiz) and opens Moodle in a new tab.

## Course page
- Tabs: arrow keys move between tabs (`role="tablist"`), the selected tab is underlined in the course color. Tab state lives in the URL hash.
- Content filter: filters on every keystroke, debounced 100 ms. Matches in names get `<mark>`; non-matching items hide; sections with no matches hide; each section count reads "n of m". Clearing the filter restores the previous collapse state.
- Sections: the header button toggles `aria-expanded`; the caret rotates 160 ms. "Collapse all" becomes "Expand all" when every section is collapsed. Remember collapse state per course.
- File rows: Download fetches through the local file proxy and shows a "Downloading …" toast. Open in Moodle opens a new tab. Row actions are always visible on touch screens.
- Forums: forum list, then discussions, then a discussion. Post bodies render inside `iframe.post-frame` with `sandbox` (no scripts) and auto height; author, time and attachments are app markup around it.

## Course order and colors (Settings > Courses)
- Order: drag a row by its handle, or use the up and down arrow buttons (keyboard-accessible; focus stays on the moved row). While dragging, the row lifts and an accent line marks the drop position. Esc cancels the drag.
- Color: clicking the swatch toggles an inline row of the 8 palette colors (`role="radiogroup"`, arrow keys move, Enter or Space picks). Two courses may share a color.
- Saved instantly with a "Saved" toast. Order applies to Home, Courses, Grades, search results and the sidebar course lists; color applies everywhere a course code, bar or tint appears. New courses take the next unused color.
- Reset restores Moodle's order and colors assigned in order. Courses page links here with "Order and colors".

## Messages
- Two panes on desktop. Selecting a conversation sets `aria-current="true"` and loads the thread. On phones the list and thread are separate screens with a back button.
- Read-only. "Reply in Moodle" opens the conversation on activity.act.edu.

## Notifications
- Grouped by day. Unread rows show the accent dot. Opening one marks it read.
- "Mark all as read" clears the dots and shows the toast "Marked 32 as read".

## Settings
- Every change saves immediately and shows a "Saved" toast. No Save button.
- Sub-settings (reminder hours, show grade in alert) are disabled while their parent toggle is off.
- Reminder hours: comma-separated numbers; invalid input sets `aria-invalid` and is not saved.
- Courses to watch: "Selected" reveals a checklist of courses.
- Check now: the button shows a spinner, then the status line updates.
- Quit asks for confirmation in a dialog, then shows a final screen that says the app has stopped.

## Sign in
- Submit disables the fields and shows a spinner in the button ("Signing in").
- Wrong credentials: keep the values, set `aria-invalid` on the password, show "Wrong username or password" in an `role="alert"` box, and focus the password field.

## System states
- Loading: skeletons that match the final layout; shimmer 1.4 s, static with reduced motion. Show them only after 300 ms to avoid a flash.
- Error: `.error-box` with Retry. Keep stale data visible when there is any, with the age in the message.
- Toasts: bottom right on desktop, above the tab bar on phones, `aria-live="polite"`. Success closes after 3 s, errors stay until dismissed. At most 3; newest on top. Slide up 8 px and fade in 200 ms.
