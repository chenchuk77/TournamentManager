const fs = require('fs');
const path = require('path');
const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN/BOT_TOKEN environment variable.');
}

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const PERSIST_PATH = process.env.TOURNAMENT_STATE_FILE || path.join(__dirname, 'tournament-state.json');

function normalizeTableValue(table) {
  return String(table ?? '').trim();
}

const DEFAULT_TABLES = Array.from({ length: 10 }, (_, index) => String(index + 1));
const TABLE_CHOICES = (() => {
  const configured = (process.env.TOURNAMENT_TABLES || '')
    .split(',')
    .map(normalizeTableValue)
    .filter(Boolean);
  const base = configured.length > 0 ? configured : DEFAULT_TABLES;
  return Array.from(new Set(base.map(normalizeTableValue)));
})();
const TABLE_CHOICES_SET = new Set(TABLE_CHOICES);
const TABLE_CALLBACK_PREFIX = 'assign_table:';

class TournamentState {
  constructor(persistPath) {
    this.persistPath = persistPath;
    this.state = {
      dealers: {},
      currentRound: null,
      rebuys: [],
      eliminations: []
    };
    this.load();
  }

  load() {
    if (!this.persistPath) {
      return;
    }

    try {
      if (fs.existsSync(this.persistPath)) {
        const raw = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));
        this.state = {
          dealers: raw.dealers || {},
          currentRound: raw.currentRound || null,
          rebuys: Array.isArray(raw.rebuys) ? raw.rebuys : [],
          eliminations: Array.isArray(raw.eliminations) ? raw.eliminations : []
        };
      }
    } catch (error) {
      console.error('Failed to load persisted state:', error);
    }
  }

  save() {
    if (!this.persistPath) {
      return;
    }

    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      fs.writeFileSync(this.persistPath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error('Failed to persist state:', error);
    }
  }

  getDealers() {
    return Object.values(this.state.dealers);
  }

  assignDealer(dealer) {
    const now = new Date().toISOString();
    const id = String(dealer.id);
    const normalizedTable = dealer.table !== undefined ? String(dealer.table).trim() : undefined;
    const existing = this.state.dealers[id];
    const record = {
      id,
      chatId: dealer.chatId ? String(dealer.chatId) : id,
      table: normalizedTable,
      firstName: dealer.firstName || null,
      lastName: dealer.lastName || null,
      username: dealer.username || null,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    this.state.dealers[id] = record;
    this.save();
    return record;
  }

  unassignDealer(id) {
    const key = String(id);
    const existing = this.state.dealers[key];
    if (existing) {
      delete this.state.dealers[key];
      this.save();
    }
    return existing;
  }

  findDealerByTable(table) {
    if (table === undefined || table === null) {
      return undefined;
    }
    const normalized = String(table).trim().toLowerCase();
    return this.getDealers().find((dealer) => {
      if (dealer.table === undefined || dealer.table === null) {
        return false;
      }
      return String(dealer.table).trim().toLowerCase() === normalized;
    });
  }

  recordRoundChange(payload) {
    const record = {
      ...payload,
      updatedAt: new Date().toISOString()
    };
    this.state.currentRound = record;
    this.save();
    return record;
  }

  recordRebuy(payload) {
    const record = {
      ...payload,
      createdAt: new Date().toISOString()
    };
    this.state.rebuys.push(record);
    this.save();
    return record;
  }

  recordElimination(payload) {
    const record = {
      ...payload,
      createdAt: new Date().toISOString()
    };
    this.state.eliminations.push(record);
    this.save();
    return record;
  }

  getState() {
    return {
      dealers: this.getDealers(),
      currentRound: this.state.currentRound,
      rebuys: this.state.rebuys,
      eliminations: this.state.eliminations
    };
  }
}

const state = new TournamentState(PERSIST_PATH);
const bot = new Telegraf(BOT_TOKEN);

function dealerDisplayName(dealer) {
  if (dealer.firstName || dealer.lastName) {
    return [dealer.firstName, dealer.lastName].filter(Boolean).join(' ');
  }
  if (dealer.username) {
    return `@${dealer.username}`;
  }
  return dealer.id;
}

async function notifyDealers(dealers, message, extra = {}) {
  if (!Array.isArray(dealers) || dealers.length === 0) {
    return { notified: [], failures: [] };
  }

  const results = await Promise.allSettled(
    dealers.map((dealer) => bot.telegram.sendMessage(dealer.chatId, message, extra))
  );

  const notified = [];
  const failures = [];
  results.forEach((result, index) => {
    const dealer = dealers[index];
    if (result.status === 'fulfilled') {
      notified.push(dealer.id);
    } else {
      failures.push({ dealer: dealer.id, error: result.reason.message || String(result.reason) });
      console.error('Failed to notify dealer %s (%s): %s', dealer.id, dealerDisplayName(dealer), result.reason);
    }
  });

  return { notified, failures };
}

function buildTableKeyboard(currentDealerId) {
  const assignments = new Map();
  state.getDealers().forEach((dealer) => {
    if (!dealer.table) {
      return;
    }
    assignments.set(normalizeTableValue(dealer.table), dealer);
  });

  const buttons = TABLE_CHOICES.map((table) => {
    const normalized = normalizeTableValue(table);
    const occupant = assignments.get(normalized);
    let label = `Table ${normalized}`;
    if (occupant) {
      label += occupant.id === String(currentDealerId) ? ' (you)' : ' (taken)';
    }
    return Markup.button.callback(label, `${TABLE_CALLBACK_PREFIX}${normalized}`);
  });

  return Markup.inlineKeyboard(buttons, { columns: 3 });
}

function buildRoundMessage(round) {
  const parts = [`\uD83C\uDFB4 Round update: ${round.round ?? round.roundNumber ?? round.name ?? ''}`.trim()];
  if (round.blinds) {
    parts.push(`Blinds: ${round.blinds}`);
  }
  if (round.ante) {
    parts.push(`Ante: ${round.ante}`);
  }
  if (round.startTime) {
    parts.push(`Start time: ${round.startTime}`);
  }
  if (round.notes) {
    parts.push(round.notes);
  }
  return parts.join('\n');
}

function buildRebuyMessage(rebuy) {
  const parts = [`\u267B\uFE0F Rebuy requested at table ${rebuy.table}`];
  if (rebuy.player) {
    parts.push(`Player: ${rebuy.player}`);
  }
  if (rebuy.amount) {
    parts.push(`Amount: ${rebuy.amount}`);
  }
  if (rebuy.notes) {
    parts.push(rebuy.notes);
  }
  return parts.join('\n');
}

function buildEliminationMessage(elimination) {
  const parts = [`\u274C Player eliminated: ${elimination.player || 'Unknown'}`];
  if (elimination.table) {
    parts.push(`Table: ${elimination.table}`);
  }
  if (elimination.position) {
    parts.push(`Position: ${elimination.position}`);
  }
  if (elimination.payout) {
    parts.push(`Payout: ${elimination.payout}`);
  }
  if (elimination.notes) {
    parts.push(elimination.notes);
  }
  return parts.join('\n');
}

bot.start((ctx) => {
  const keyboard = buildTableKeyboard(ctx.from?.id);
  return ctx.reply('Choose your table', keyboard);
});

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(TABLE_CALLBACK_PREFIX)) {
    await ctx.answerCbQuery();
    return;
  }

  const selectedTable = normalizeTableValue(data.slice(TABLE_CALLBACK_PREFIX.length));
  if (!selectedTable || !TABLE_CHOICES_SET.has(selectedTable)) {
    await ctx.answerCbQuery('Unknown table selection.', { show_alert: true });
    return;
  }

  const currentUserId = String(ctx.from?.id ?? '');
  if (!currentUserId) {
    await ctx.answerCbQuery('Unable to determine your account.', { show_alert: true });
    return;
  }

  const existing = state.findDealerByTable(selectedTable);
  if (existing && existing.id !== currentUserId) {
    await ctx.answerCbQuery('That table is already taken.', { show_alert: true });
    return;
  }

  const dealer = state.assignDealer({
    id: ctx.from.id,
    chatId: ctx.callbackQuery?.message?.chat?.id ?? ctx.from.id,
    table: selectedTable,
    firstName: ctx.from.first_name,
    lastName: ctx.from.last_name,
    username: ctx.from.username
  });

  await ctx.answerCbQuery(`Assigned to table ${selectedTable}`);

  try {
    await ctx.editMessageText(`Selected table: ${selectedTable}`);
  } catch (error) {
    console.warn('Failed to edit message after table selection:', error);
  }

  await ctx.reply(`You are now assigned to table ${dealer.table}.`);
});

bot.command('assign', async (ctx) => {
  await ctx.reply('Please use /start to choose your table from the menu.');
});

bot.command('unassign', async (ctx) => {
  const removed = state.unassignDealer(ctx.from.id);
  if (removed) {
    await ctx.reply('You have been unassigned from your table.');
  } else {
    await ctx.reply('No assignment was found for you.');
  }
});

bot.command('table', async (ctx) => {
  const dealer = state.getDealers().find((d) => d.id === String(ctx.from.id));
  if (!dealer) {
    await ctx.reply('You are not currently assigned to a table.');
    return;
  }
  await ctx.reply(`You are assigned to table ${dealer.table}.`);
});

bot.command('status', async (ctx) => {
  const dealer = state.getDealers().find((d) => d.id === String(ctx.from.id));
  if (!dealer) {
    await ctx.reply('You are not currently assigned to a table.');
    return;
  }
  const round = state.state.currentRound;
  if (round) {
    await ctx.reply(`Current round: ${round.round ?? round.roundNumber ?? 'unknown'}\nBlinds: ${round.blinds || 'n/a'}`);
  } else {
    await ctx.reply('The tournament round has not been announced yet.');
  }
});

bot.launch().then(() => {
  console.log('Telegram bot launched and ready.');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', dealers: state.getDealers().length });
});

app.get('/api/state', (req, res) => {
  res.json(state.getState());
});

app.get('/api/dealers', (req, res) => {
  res.json({ dealers: state.getDealers() });
});

app.post('/api/dealers', (req, res) => {
  const { id, chatId, table, firstName, lastName, username } = req.body;
  if (!id || !table) {
    res.status(400).json({ error: 'Both id and table are required to assign a dealer.' });
    return;
  }
  const dealer = state.assignDealer({ id, chatId, table, firstName, lastName, username });
  res.status(201).json({ dealer });
});

app.delete('/api/dealers/:id', (req, res) => {
  const removed = state.unassignDealer(req.params.id);
  if (!removed) {
    res.status(404).json({ error: 'Dealer not found.' });
    return;
  }
  res.json({ dealer: removed });
});

app.post('/api/rounds', async (req, res) => {
  const { round, roundNumber, name, blinds, ante, startTime, notes } = req.body;
  const identifier = round ?? roundNumber ?? name;
  if (!identifier) {
    res.status(400).json({ error: 'A round identifier (round, roundNumber, or name) is required.' });
    return;
  }
  const record = state.recordRoundChange({
    round: round ?? roundNumber ?? name,
    roundNumber: roundNumber ?? null,
    name: name ?? null,
    blinds,
    ante,
    startTime,
    notes
  });
  const message = buildRoundMessage(record);
  const { notified, failures } = await notifyDealers(state.getDealers(), message);
  res.json({ round: record, notified, failures });
});

app.post('/api/rebuys', async (req, res) => {
  const { table, player, amount, notes } = req.body;
  if (!table) {
    res.status(400).json({ error: 'Table is required for a rebuy request.' });
    return;
  }
  const dealer = state.findDealerByTable(table);
  if (!dealer) {
    res.status(404).json({ error: `No dealer is registered for table ${table}.` });
    return;
  }
  const record = state.recordRebuy({ table: dealer.table, player, amount, notes });
  const message = buildRebuyMessage(record);
  const { notified, failures } = await notifyDealers([dealer], message);
  res.json({ rebuy: record, notified, failures });
});

app.post('/api/eliminations', async (req, res) => {
  const { player, table, position, payout, notes } = req.body;
  if (!player) {
    res.status(400).json({ error: 'Player name is required for eliminations.' });
    return;
  }
  const record = state.recordElimination({ player, table, position, payout, notes });
  const message = buildEliminationMessage(record);
  const { notified, failures } = await notifyDealers(state.getDealers(), message);
  res.json({ elimination: record, notified, failures });
});

app.listen(PORT, () => {
  console.log(`Tournament manager server listening on port ${PORT}`);
});
