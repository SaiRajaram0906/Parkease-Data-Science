import pg from "pg";
const { Client } = pg;

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:root@localhost:5432/parkease"
  });
  await client.connect();
  
  const spots = await client.query("SELECT id, name, total_slots FROM spots");
  console.log("--- SPOTS ---");
  console.table(spots.rows);
  
  const bookings = await client.query("SELECT id, spot_id, start_time, end_time, status FROM bookings ORDER BY created_at DESC LIMIT 10");
  console.log("\n--- BOOKINGS ---");
  console.table(bookings.rows);
  
  await client.end();
}

run().catch(console.error);
