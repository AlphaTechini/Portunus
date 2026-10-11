import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Backstop for every time-based step (details 14.3): re-runs anything missed or failed.
crons.daily('portunus backstop sweep', { hourUTC: 2, minuteUTC: 0 }, internal.sweep.run, {});
// Live only (no-op in sim): pick up guard receipts that arrived outside the app.
crons.interval('portunus index guard receipts', { minutes: 5 }, internal.sweep.indexReceipts, {});

export default crons;
