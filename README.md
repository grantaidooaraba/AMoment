# AMoment

Phase 1 web prototype for the AMoment task initiation journey. React, Vite, TypeScript, and CSS; demo tasks and analytics persist in browser local storage.

## Run locally

```sh
npm install
npm run dev
```

Production build and test commands:

```sh
npm run build
npm test
```

The task planner uses a local editable suggestion and evidence is explicitly demo verification. The Lock-In timer is an interactive browser demonstration; it cannot block other apps and may pause/reset when the tab closes.

Scheduled Calls are saved in this browser's local storage. After notification permission is granted, this page checks reminders while the browser is running, including while the page is in another tab. Calls use the browser Notifications API and a configurable preparation reminder. The generated alert sound is optional and must be enabled from Settings through a user interaction; device/browser support for sound and vibration varies. Times are selected in local time and stored as absolute instants, so travel or a timezone change does not shift an already scheduled Call.

This is local page scheduling, not push delivery. Reminders stop when the browser is fully closed. Calls more than 30 minutes late are marked missed. Browser notification delivery and sound require a supported browser and the site's notification permission. AI planning, PayPal checkout, backend push notifications, and native Android scheduling are not implemented.
