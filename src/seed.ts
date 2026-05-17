import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

// Trigger initial partner sync via Convex HTTP endpoint
const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL || "http://127.0.0.1:3211";

async function seed() {
  console.log("🔄 Triggering initial partner sync...");
  console.log(`   Convex URL: ${CONVEX_SITE_URL}`);

  const res = await fetch(`${CONVEX_SITE_URL}/api/sync`, { method: "POST" });

  if (!res.ok) {
    console.error(`❌ Sync failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const result = await res.json();
  console.log("✅ Sync complete:");
  console.log(`   Added: ${result.added}`);
  console.log(`   Updated: ${result.updated}`);
  console.log(`   Removed: ${result.removed}`);
  console.log(`   Total: ${result.total}`);
}

seed().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
