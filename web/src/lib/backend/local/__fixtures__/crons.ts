import { anyApi, cronJobs } from 'convex/server';

const crons = cronJobs();
crons.interval('tick', { seconds: 5 }, anyApi.app.cronTick, {});
export default crons;
