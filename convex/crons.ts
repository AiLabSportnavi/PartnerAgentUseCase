import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sync partners every hour
crons.interval("sync partners", { hours: 1 }, internal.sync.syncPartners);

export default crons;
