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
const ROUND_ACK_CALLBACK_PREFIX = 'round_ack:';
const MAX_TRACKED_ROUNDS = 50;

function generateRoundId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const recentRounds = new Map();

function rememberRound(record) {
  recentRounds.set(record.id, {
    label: computeRoundLabel(record)
  });
  if (recentRounds.size > MAX_TRACKED_ROUNDS) {
    const oldestKey = recentRounds.keys().next().value;
    if (oldestKey) {
      recentRounds.delete(oldestKey);
    }
  }
}

function getTrackedRoundSummary(id) {
  return recentRounds.get(id);
}

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
    const data = payload || {};
    const record = {
      ...data,
      id: data.id ?? generateRoundId(),
      tables: Array.isArray(data.tables) ? data.tables : [],
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

function toOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const result = String(value).trim();
  return result.length > 0 ? result : null;
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numberValue = Number(value);
  return Number.isNaN(numberValue) ? null : numberValue;
}

function normalizeTables(tables) {
  if (!Array.isArray(tables)) {
    return [];
  }
  const normalized = tables
    .map((table) => normalizeTableValue(table))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function selectDealersForTables(tables) {
  const normalized = Array.isArray(tables) ? tables : [];
  if (normalized.length === 0) {
    return state.getDealers();
  }
  const tableSet = new Set(normalized.map((table) => table.toLowerCase()));
  return state.getDealers().filter((dealer) => {
    if (!dealer.table) {
      return false;
    }
    return tableSet.has(normalizeTableValue(dealer.table).toLowerCase());
  });
}

function resolveDurationMinutes(payload) {
  const explicit = toOptionalNumber(payload.durationMinutes);
  if (explicit !== null) {
    return explicit;
  }
  if (payload.durationMs !== undefined && payload.durationMs !== null && payload.durationMs !== '') {
    const durationMs = Number(payload.durationMs);
    if (!Number.isNaN(durationMs) && Number.isFinite(durationMs)) {
      return Math.round(durationMs / 60000);
    }
  }
  return null;
}

function prepareRoundRecord(body = {}) {
  const roundCandidate = body.round ?? body.roundNumber ?? body.name;
  const roundLabel = toOptionalString(roundCandidate);
  if (!roundLabel) {
    const error = new Error('A round identifier (round, roundNumber, or name) is required.');
    error.status = 400;
    throw error;
  }

  const roundNumberValue = toOptionalNumber(
    body.roundNumber ?? (roundCandidate !== undefined ? roundCandidate : undefined)
  );

  const nameValue = toOptionalString(body.name);
  const smallBlindValue = toOptionalString(body.sb ?? body.smallBlind);
  const bigBlindValue = toOptionalString(body.bb ?? body.bigBlind);
  const anteValue = toOptionalString(body.ante ?? body.anteAmount);
  const startTimeValue = toOptionalString(body.startTime);
  const notesValue = toOptionalString(body.notes);
  const isBreak = Boolean(body.break || body.isBreak);
  const durationMinutes = resolveDurationMinutes(body);

  const resolvedBlinds =
    toOptionalString(body.blinds) ||
    (smallBlindValue && bigBlindValue ? `${smallBlindValue}/${bigBlindValue}` : null);

  const tables = normalizeTables(body.tables);

  return {
    record: {
      round: roundLabel,
      roundNumber: roundNumberValue,
      name: nameValue,
      blinds: resolvedBlinds,
      smallBlind: smallBlindValue,
      bigBlind: bigBlindValue,
      ante: anteValue,
      startTime: startTimeValue,
      notes: notesValue,
      isBreak,
      durationMinutes,
      tables
    },
    targetTables: tables
  };
}

async function announceRoundUpdate(body = {}) {
  const { record, targetTables } = prepareRoundRecord(body);
  const storedRecord = state.recordRoundChange(record);
  rememberRound(storedRecord);
  const targetDealers = selectDealersForTables(targetTables);
  const ackCallbackData = `${ROUND_ACK_CALLBACK_PREFIX}${storedRecord.id}`;
  const ackMarkup = {
    reply_markup: {
      inline_keyboard: [[{ text: '✅ Acknowledge', callback_data: ackCallbackData }]]
    }
  };
  const message = buildRoundMessage(storedRecord);
  const { notified, failures } = await notifyDealers(targetDealers, message, ackMarkup);
  return {
    round: storedRecord,
    notified,
    failures,
    dealers: targetDealers.map((dealer) => dealer.id),
    tables: storedRecord.tables
  };
}

async function handleRoundRequest(req, res) {
  try {
    const result = await announceRoundUpdate(req.body || {});
    res.json(result);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) {
      console.error('Failed to process round update:', error);
    }
    res.status(status).json({ error: error.message || 'Failed to process round update.' });
  }
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

function computeRoundLabel(round) {
  if (round.isBreak) {
    return 'Break';
  }
  const base = round.round ?? round.roundNumber ?? round.name;
  const label = toOptionalString(base);
  return label ? `Round ${label}` : 'Round update';
}

function buildRoundMessage(round) {
  if (round.isBreak) {
    const parts = [computeRoundLabel(round)];
    if (Number.isFinite(round.durationMinutes) && round.durationMinutes !== null) {
      const minutes = Number(round.durationMinutes);
      if (!Number.isNaN(minutes)) {
        const unit = minutes === 1 ? 'minute' : 'minutes';
        parts.push(`${minutes} ${unit}`);
      }
    }
    const header = parts.join(' — ');
    const details = [];
    if (round.notes) {
      details.push(round.notes);
    }
    if (round.startTime) {
      details.push(`Start time: ${round.startTime}`);
    }
    return details.length > 0 ? [header, ...details].join('\n') : header;
  }

  const headerParts = [];
  headerParts.push(computeRoundLabel(round));
  const blindsValue =
    toOptionalString(round.blinds) ||
    (toOptionalString(round.smallBlind) && toOptionalString(round.bigBlind)
      ? `${toOptionalString(round.smallBlind)}/${toOptionalString(round.bigBlind)}`
      : null);
  if (blindsValue) {
    headerParts.push(`Blinds ${blindsValue}`);
  }
  let message = headerParts.join(' — ');
  const details = [];
  if (round.ante) {
    details.push(`Ante ${round.ante}`);
  }
  if (round.startTime) {
    details.push(`Start time: ${round.startTime}`);
  }
  if (round.notes) {
    details.push(round.notes);
  }
  if (details.length > 0) {
    message = [message, ...details].join('\n');
  }
  return message;
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
  if (!data) {
    await ctx.answerCbQuery();
    return;
  }

  if (data.startsWith(ROUND_ACK_CALLBACK_PREFIX)) {
    const ackId = data.slice(ROUND_ACK_CALLBACK_PREFIX.length);
    const summary = getTrackedRoundSummary(ackId);
    const acknowledgement = summary?.label ? `${summary.label} acknowledged.` : 'Acknowledged.';
    await ctx.answerCbQuery(acknowledgement);
    console.log(
      'Dealer %s acknowledged %s',
      ctx.from?.id ?? 'unknown',
      summary?.label ?? `round update ${ackId}`
    );
    return;
  }

  if (!data.startsWith(TABLE_CALLBACK_PREFIX)) {
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
    await ctx.reply(buildRoundMessage(round));
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

app.post('/api/rounds', handleRoundRequest);
app.post('/round', handleRoundRequest);

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
