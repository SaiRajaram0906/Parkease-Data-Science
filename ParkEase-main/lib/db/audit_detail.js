import pg from "pg";
const { Client } = pg;

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:root@localhost:5432/parkease"
  });
  await client.connect();
  
  const spots = await client.query("SELECT * FROM spots WHERE id = 11 OR id = 2");
  const bookings = await client.query("SELECT * FROM bookings WHERE spot_id = 11 OR spot_id = 2 ORDER BY created_at DESC");
  
  console.log("DATA_START");
  console.log(JSON.stringify({ spots: spots.rows, bookings: bookings.rows }, null, 2));
  console.log("DATA_END");
  
  await client.end();
}

run().catch(console.error);
