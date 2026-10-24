// Set up and run the interview-engine pilot (docs/engine-contract.md, section 4). Writes to the
// platform database in MONGODB_URI.
//
//   npx tsx scripts/engine-pilot.ts status          what the pilot looks like now
//   npx tsx scripts/engine-pilot.ts setup           create or refresh the pilot case and select it
//   npx tsx scripts/engine-pilot.ts find <text>     users whose email or name contains <text>
//   npx tsx scripts/engine-pilot.ts add <email>     put a user on the pilot
//   npx tsx scripts/engine-pilot.ts remove <email>  take a user off it
//
// The pilot runs one case for every engine interview (decided 24 Oct): the engine's coffee-chain case
// (engine/cases/coffee.json). Sessions are created on a platform Case that mirrors it, so the report
// grades the case that was run. That Case is hidden from the case library (isCustom, no owner).
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Case } from '../server/models/Case.js';
import { Setting, getSettings } from '../server/models/Setting.js';
import { User } from '../server/models/User.js';

const ENGINE_CASE_ID = 'coffee';
const here = path.dirname(fileURLToPath(import.meta.url));

interface EngineFact { id: string; parent: string | null; answer: string }
interface EngineCase { statement: string; facts: EngineFact[] }

/** The platform Case for the pilot: what the candidate is told, and the answer the report grades against. */
function pilotCase(engine: EngineCase) {
  const answer = (id: string) => engine.facts.find((f) => f.id === id)?.answer ?? '';
  // The facts in tree order, so the report's reference tree follows the case's own logic.
  const ordered: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of engine.facts.filter((x) => x.parent === parent)) {
      ordered.push(`${'  '.repeat(depth)}- ${f.answer}`);
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  const solution = [
    'Profit fell because costs rose while revenue stayed flat: total costs rose about 1.5 million, '
      + 'mostly variable costs, and almost all of that is coffee beans. Bean costs rose 35 percent '
      + '(about 1.2 million) because the chain switched to a more expensive supplier two years ago, '
      + 'while market bean prices were flat. Labour rose about 0.3 million; rent and overheads are flat; '
      + 'visits, ticket and the 40-cafe footprint are unchanged.',
    'Recommendation: renegotiate with the current supplier or return to market-priced beans, '
      + 'quantify the 1.2 million at stake, and check quality and customer impact before switching.',
    'What the case holds, in tree order:',
    ...ordered,
  ].join('\n');
  return {
    title: 'Profit decline at a regional coffee chain',
    module: 'case' as const,
    type: 'profitability' as const,
    industry: 'retail' as const,
    difficulty: 2,
    description: engine.statement,
    scenario: engine.statement,
    // Only what the statement already says: anything more would hand the candidate the facts.
    keyDataPoints: [
      { label: 'Cafes', value: '40' },
      { label: 'Revenue', value: 'About $30M, flat for two years' },
      { label: 'Operating profit', value: '$6M → $4.5M' },
    ],
    questions: [],
    plausibleSolution: solution,
    answerKey: solution,
    privateMechanismNote: `${answer('beans_why')} ${answer('bean_market')}`,
    commonWrongTurns: [
      'Hunting for a revenue problem: visits, ticket and the footprint are all flat.',
      'Blaming market bean prices: they were flat; the supplier change is the cause.',
    ],
    engine: { caseId: ENGINE_CASE_ID },
    isSeeded: false,
    isCustom: true,   // with no owner, the library never lists it
    createdBy: null,
  };
}

async function userByEmail(email: string) {
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('_id email name');
  if (!user) throw new Error(`No user with email ${email}`);
  return user;
}

async function status() {
  const settings = await getSettings();
  const pilot = settings.enginePilotCaseId ? await Case.findById(settings.enginePilotCaseId).select('title engine') : null;
  const users = await User.find({ _id: { $in: settings.enginePilotUserIds ?? [] } }).select('email name');
  console.log(`Pilot case: ${pilot ? `${pilot.title} (${pilot._id}, engine case "${pilot.engine?.caseId}")` : 'none'}`);
  console.log(`Pilot users (${users.length}): ${users.map((u) => u.email).join(', ') || 'none'}`);
  console.log(`ENGINE_URL in this environment (.env): ${process.env.ENGINE_URL || 'not set; Node needs it to send sessions to the engine'}`);
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    if (command === 'setup') {
      const engine = JSON.parse(fs.readFileSync(path.join(here, '..', 'engine', 'cases', `${ENGINE_CASE_ID}.json`), 'utf8')) as EngineCase;
      const doc = await Case.findOneAndUpdate({ 'engine.caseId': ENGINE_CASE_ID, isCustom: true, createdBy: null },
        { $set: pilotCase(engine) }, { upsert: true, new: true, setDefaultsOnInsert: true });
      await Setting.updateOne({ key: 'global' }, { $set: { enginePilotCaseId: doc._id } }, { upsert: true });
      console.log(`Pilot case ready: ${doc._id}`);
    } else if (command === 'find' && arg) {
      const pattern = new RegExp(arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const users = await User.find({ $or: [{ email: pattern }, { name: pattern }] }).select('email name role').limit(20);
      for (const u of users) console.log(`${u.email} | ${u.name} | ${u.role}`);
      console.log(`${users.length} match(es)`);
      return;
    } else if (command === 'add' && arg) {
      const user = await userByEmail(arg);
      await Setting.updateOne({ key: 'global' }, { $addToSet: { enginePilotUserIds: user._id } }, { upsert: true });
      console.log(`Added ${user.email} to the pilot`);
    } else if (command === 'remove' && arg) {
      const user = await userByEmail(arg);
      await Setting.updateOne({ key: 'global' }, { $pull: { enginePilotUserIds: user._id } });
      console.log(`Removed ${user.email} from the pilot`);
    } else if (command !== 'status') {
      console.log('Usage: npx tsx scripts/engine-pilot.ts status | setup | find <text> | add <email> | remove <email>');
      return;
    }
    await status();
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
