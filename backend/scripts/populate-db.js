/**
 * Populate database with test entries
 * - Fetches user_id from auth by email (default: poppetew)
 * - Creates N test entries (default: 5, configurable via --entries)
 * - 10 customer identities with consistent addresses but name inconsistencies
 * - Realistic job summaries with semantic variation for embedding testing
 * 
 * Usage:
 *   USE_MOCK_APIS=true node scripts/populate-db.js                    # 5 entries for poppetew
 *   USE_MOCK_APIS=true node scripts/populate-db.js --entries 50       # 50 entries for poppetew
 *   USE_MOCK_APIS=true node scripts/populate-db.js --email user@test  # 5 entries for user@test
 *   USE_MOCK_APIS=true node scripts/populate-db.js --entries 100 --email user@test
 */

import dotenv from 'dotenv';
dotenv.config();

import readline from 'readline';
import { createClient } from '@supabase/supabase-js';
import { getEmbeddingService, EMBEDDING_MODEL } from '../src/services/embedding.js';
import { createJobDoneDb } from '../src/services/postgresDb.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const postgresUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_KEY required');
}

if (!postgresUrl) {
  throw new Error('SUPABASE_DB_URL or DATABASE_URL required');
}

const supabase = createClient(supabaseUrl, supabaseKey);
const jobdoneDb = createJobDoneDb({
  connectionString: postgresUrl,
  schema: process.env.SUPABASE_DB_SCHEMA || 'jobdone',
});
const embeddingService = getEmbeddingService();

// ---------------------------------------------------------------------------
// CLI Arguments
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    email: 'poppetew@gmail.com',
    entries: 5,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) {
      config.email = args[i + 1];
      i++;
    } else if (args[i] === '--entries' && args[i + 1]) {
      config.entries = parseInt(args[i + 1], 10);
      if (isNaN(config.entries) || config.entries < 1) {
        console.error('❌ --entries must be a positive number');
        process.exit(1);
      }
      i++;
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// User Input
// ---------------------------------------------------------------------------

function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function getUserIdByEmail(email) {
  try {
    // Query auth.users via admin endpoint
    const { data, error } = await supabase.auth.admin.listUsers();

    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }

    let user = data.users.find(u => u.email === email);
    
    if (!user) {
      console.warn(`⚠️  User with email "${email}" not found\n`);
      console.log('Available users:');
      if (data.users.length === 0) {
        console.log('   (none)');
        console.error('\n❌ No users found in auth');
        process.exit(1);
      }
      data.users.slice(0, 10).forEach((u, i) => {
        console.log(`   ${i + 1}. ${u.email} (${u.id})`);
      });
      
      // Prompt for email
      const selectedEmail = await prompt('\nEnter email of user to populate (or Ctrl+C to exit): ');
      user = data.users.find(u => u.email === selectedEmail);
      if (!user) {
        console.error(`❌ User with email "${selectedEmail}" not found`);
        process.exit(1);
      }
    }

    return user;
  } catch (err) {
    console.error(`❌ Auth error: ${err.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Database Setup
// ---------------------------------------------------------------------------

async function resetEntriesTable() {
  console.log('🔄 Clearing existing entries...');
  
  try {
    // Delete all existing entries
    const { error } = await jobdoneDb
      .from('entries')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
    
    if (error) {
      console.warn('   ⚠️  Could not clear entries:', error.message);
    } else {
      console.log('   ✅ Entries cleared');
    }
  } catch (err) {
    console.warn('   ⚠️  Error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Customer Identities
// ---------------------------------------------------------------------------

const customers = [
  {
    id: 'cust-smith-family',
    nameVariants: ['Mrs Smith', 'Mrs. Smith', 'Smith residence', 'Jane Smith', 'J. Smith'],
    addressVariants: ['42 Oak Street, Croydon', '42 Oak St, Croydon', 'The Smiths, 42 Oak Street', '42 Oak Street'],
    jobTypes: ['tap repairs', 'radiator maintenance', 'leak fixes', 'boiler service', 'pipe replacement'],
  },
  {
    id: 'cust-jones-office',
    nameVariants: ['Jones & Co', 'Jones Ltd', 'Mr Jones', 'John Jones', 'Jones Office Building'],
    addressVariants: ['15-17 Business Park, Croydon', '15-17 Business Park', 'Jones Office, Croydon', 'Business Park'],
    jobTypes: ['main line repair', 'emergency callout', 'leak detection', 'pipe work', 'water pressure issue'],
  },
  {
    id: 'cust-henderson',
    nameVariants: ['Henderson', 'Mrs Henderson', 'The Hendersons', 'H. Henderson', 'Henderson Kitchen'],
    addressVariants: ['Ivy Lane, Croydon', '28 Ivy Lane, Croydon', 'Ivy Lane', '28 Ivy Lane'],
    jobTypes: ['kitchen tap replacement', 'sink repair', 'waste pipe fix', 'kitchen fitting', 'mixing valve service'],
  },
  {
    id: 'cust-london-tower',
    nameVariants: ['London Tower Building', 'Tower Management', 'LT Building', 'London Towers', 'Tower Block'],
    addressVariants: ['High Street Tower, Central Croydon', 'Tower Block, High Street', 'Central Tower', 'High Street'],
    jobTypes: ['multi-unit plumbing', 'common area maintenance', 'building pipework', 'emergency response', 'valve service'],
  },
  {
    id: 'cust-residential-park',
    nameVariants: ['Park View Residents', 'Park View', 'PV Estate', 'Residential Park', 'Park Estates'],
    addressVariants: ['Park View Estate, Croydon', 'Park View, Croydon', 'The Park, Croydon', 'Estate Road'],
    jobTypes: ['preventative maintenance', 'routine inspection', 'fitting upgrade', 'modernisation', 'leak repair'],
  },
  {
    id: 'cust-riverside-hotel',
    nameVariants: ['Riverside Hotel', 'The Riverside', 'Riverside', 'RH Management', 'Hotel Management'],
    addressVariants: ['Riverside, Croydon', 'Riverside Hotel, Croydon', 'By the River Road', 'River Road'],
    jobTypes: ['guest room plumbing', 'commercial kitchen', 'bathroom fitting', 'hot water system', 'boiler repair'],
  },
  {
    id: 'cust-parkside-retail',
    nameVariants: ['Parkside Retail', 'Parkside Centre', 'Retail Centre', 'Parkside Shop', 'Centre Management'],
    addressVariants: ['Parkside Centre, Croydon', 'Parkside Retail Park', 'Retail Park, Croydon', 'Parkside'],
    jobTypes: ['restroom maintenance', 'commercial repair', 'emergency plumbing', 'business closure', 'facility upgrade'],
  },
  {
    id: 'cust-crown-school',
    nameVariants: ['Crown School', 'Crown Primary', 'School', 'Crown Facilities', 'School Admin'],
    addressVariants: ['Crown School Road, Croydon', 'Crown Road, Croydon', 'School Lane', 'Crown Road'],
    jobTypes: ['school bathroom maintenance', 'pipe repair', 'shower block upgrade', 'emergency response', 'toilet block service'],
  },
  {
    id: 'cust-medway-dental',
    nameVariants: ['Medway Dental', 'Dental Surgery', 'Medway Clinic', 'Dental Practice', 'Surgery Management'],
    addressVariants: ['Medway Business Park, Croydon', 'Medway Park, Croydon', 'Business Park Drive', 'Medway'],
    jobTypes: ['surgery plumbing', 'sterilisation system', 'hand basin upgrade', 'water quality issue', 'emergency callout'],
  },
  {
    id: 'cust-greenfield-farm',
    nameVariants: ['Greenfield Farm', 'Greenfield', 'Mr Green', 'Farm Management', 'Green Family'],
    addressVariants: ['Greenfield Lane, Outside Croydon', 'Greenfield Farm', 'Lane Farm', 'Greenfield'],
    jobTypes: ['farm plumbing', 'external line repair', 'water tank service', 'feeding system', 'trough filling'],
  },
];

// ---------------------------------------------------------------------------
// Job Templates - Realistic Plumbing Work
// ---------------------------------------------------------------------------

const jobTemplates = [
  {
    verb: 'Fixed',
    object: (ct) => `${ct.jobTypes[Math.floor(Math.random() * ct.jobTypes.length)]}`,
    context: (ct) => `at ${ct.addressVariants[Math.floor(Math.random() * ct.addressVariants.length)]}`,
    details: [
      'took 30 minutes',
      'took 45 minutes',
      'took about an hour',
      'quick 15-minute job',
      'took 90 minutes including testing',
      'was a complex repair, took 2 hours',
      'took most of the afternoon',
      'took around 20 minutes',
    ],
    notes: [
      'used compression fittings',
      'used silicone sealant',
      'installed new valve',
      'applied epoxy putty',
      'used PTFE tape',
      'fitted new gasket',
      'replaced seals',
      'used pipe wrench',
      'applied plumber\'s putty',
    ],
  },
  {
    verb: 'Replaced',
    object: (ct) => `${ct.jobTypes[Math.floor(Math.random() * ct.jobTypes.length)]}`,
    context: (ct) => `at ${ct.addressVariants[Math.floor(Math.random() * ct.addressVariants.length)]}`,
    details: [
      'full replacement',
      'complete assembly swap',
      'upgraded to modern fitting',
      'fitted new unit',
      'installed improved model',
    ],
    notes: [
      '15mm compression fitting',
      'mixing valve assembly',
      'new ballcock valve',
      'modern thermostatic cartridge',
      'updated fill valve',
    ],
  },
  {
    verb: 'Repaired',
    object: (ct) => `${ct.jobTypes[Math.floor(Math.random() * ct.jobTypes.length)]} issue`,
    context: (ct) => `for ${ct.nameVariants[Math.floor(Math.random() * ct.nameVariants.length)]}`,
    details: [
      'temporary fix applied',
      'permanent solution implemented',
      'tested and commissioned',
      'advised on prevention',
      'customer satisfied with work',
    ],
    notes: [
      'epoxy putty',
      'temporary tape',
      'compression joint',
      'sealant compound',
      'new washer and O-ring',
    ],
  },
  {
    verb: 'Serviced',
    object: (ct) => `${ct.jobTypes[Math.floor(Math.random() * ct.jobTypes.length)]}`,
    context: (ct) => `at ${ct.addressVariants[Math.floor(Math.random() * ct.addressVariants.length)]}`,
    details: [
      'routine maintenance check',
      'annual service completed',
      'flushed and cleaned',
      'pressure tested',
      'safety check passed',
    ],
    notes: [
      'cleaning solution',
      'lubricating oil',
      'replacement filter',
      'inspection tools',
      'scale remover',
    ],
  },
];

// ---------------------------------------------------------------------------
// Generate Entries
// ---------------------------------------------------------------------------

function generateEntry(customer, userId, entryIndex) {
  const template = jobTemplates[Math.floor(Math.random() * jobTemplates.length)];
  const object = template.object(customer);
  const context = template.context(customer);
  const detail = template.details[Math.floor(Math.random() * template.details.length)];
  const note = template.notes[Math.floor(Math.random() * template.notes.length)];

  const transcript = `${template.verb} the ${object} ${context}, ${note}, ${detail}`;
  const summary = transcript + (Math.random() > 0.5 ? '.' : '');

  return {
    user_id: userId,
    transcript,
    summary,
    created_at: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(), // Last 90 days
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🚀 JobDone Database Populator\n');
  
  // Parse CLI args
  const config = parseArgs();
  
  // Fetch user by email
  console.log(`📧 Fetching user for email: ${config.email}...`);
  const user = await getUserIdByEmail(config.email);
  const userId = user.id;
  console.log(`✅ User: ${user.email} (${userId})\n`);
  
  // Reset database
  await resetEntriesTable();
  
  const numEntries = config.entries;
  console.log(`📝 Generating ${numEntries} test entries...`);
  console.log(`📍 Customer variations: ${customers.length}`);
  console.log(`🧠 Embedding model: ${EMBEDDING_MODEL}\n`);

  const entries = [];
  let entryIndex = 0;

  // Generate entries
  for (let i = 0; i < numEntries; i++) {
    const customer = customers[i % customers.length];
    entries.push(generateEntry(customer, userId, entryIndex++));
  }

  console.log(`✅ Generated ${entries.length} entries\n`);

  // Generate embeddings
  console.log('⏳ Generating embeddings (this may take a minute)...');
  const startEmbed = Date.now();
  let embedded = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      entry.embedding = await embeddingService.embedText(entry.summary);
      entry.embedding_model = EMBEDDING_MODEL;

      embedded++;
      if ((i + 1) % 100 === 0) {
        const elapsed = ((Date.now() - startEmbed) / 1000).toFixed(1);
        const rate = (embedded / (elapsed || 1)).toFixed(1);
        console.log(`  ${i + 1}/${entries.length} (${rate} emb/sec)`);
      }
    } catch (err) {
      console.error(`  ❌ Failed to embed entry ${i}:`, err.message);
      process.exit(1);
    }
  }

  const embedTime = ((Date.now() - startEmbed) / 1000).toFixed(1);
  console.log(`✅ All embeddings generated in ${embedTime}s\n`);

  // Batch insert into Supabase
  console.log('📤 Inserting into Supabase (batched)...');
  const batchSize = 50;
  const startInsert = Date.now();
  let inserted = 0;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const formattedBatch = batch.map(e => ({
      user_id: e.user_id,
      transcript: e.transcript,
      summary: e.summary,
      embedding: e.embedding,
      embedding_model: e.embedding_model,
      created_at: e.created_at,
    }));

    try {
      const { error } = await jobdoneDb.from('entries').insert(formattedBatch);
      if (error) throw error;

      inserted += batch.length;
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(entries.length / batchSize);
      const elapsed = ((Date.now() - startInsert) / 1000).toFixed(1);
      console.log(`  Batch ${batchNum}/${totalBatches} (${inserted}/${entries.length}) - ${elapsed}s`);
    } catch (err) {
      console.error(`  ❌ Batch insert failed:`, err.message);
      process.exit(1);
    }
  }

  const insertTime = ((Date.now() - startInsert) / 1000).toFixed(1);
  console.log(`✅ All ${inserted} entries inserted in ${insertTime}s\n`);

  // Summary
  console.log('📊 Database Population Summary');
  console.log('═'.repeat(50));
  console.log(`Email:             ${user.email}`);
  console.log(`User ID:           ${userId}`);
  console.log(`Total entries:     ${inserted}`);
  console.log(`Embedding model:   ${EMBEDDING_MODEL}`);
  console.log(`Total time:        ${((Date.now() - startEmbed) / 1000).toFixed(1)}s`);
  console.log('═'.repeat(50));
  console.log('\n✨ Ready for query testing!\n');

  // Test a query
  console.log('🧪 Testing query recall...');
  const testQuery = 'tap replacement';
  const testEmbedding = await embeddingService.embedText(testQuery);
  const results = await jobdoneDb.rpc('match_entries', {
    p_user_id: userId,
    p_query_embedding: `[${testEmbedding.join(',')}]`,
    p_match_count: 5,
    p_similarity_floor: 0.3,
  });

  if (results.error) {
    console.error('❌ Query test failed:', results.error.message);
  } else {
    console.log(`✅ Found ${results.data.length} similar entries for "${testQuery}"`);
    results.data.slice(0, 3).forEach((r, i) => {
      console.log(`   ${i + 1}. (${r.similarity.toFixed(2)}) ${r.summary}`);
    });
  }

  console.log('\n✨ Database ready for testing!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
