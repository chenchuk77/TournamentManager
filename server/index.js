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
const DEALER_ACTION_CALLBACK_PREFIX = 'dealer_action:';
const DEALER_ACTION_REBUY = 'rebuy';
const DEALER_ACTION_ELIMINATION = 'elimination';
const DEALER_ACTION_RECENT = 'recent';
const DEALER_ACTIONS = [
  { key: DEALER_ACTION_REBUY, label: '♻️ Rebuy' },
  { key: DEALER_ACTION_ELIMINATION, label: '❌ Eliminate Player' },
  { key: DEALER_ACTION_RECENT, label: '🗒 Recent activity' }
];
const STATIC_ROOT = process.env.STATIC_ROOT || path.join(__dirname, '..');

const TELEGRAM_ALLOWED_USER_IDS = (() => {
  const raw =
    process.env.TELEGRAM_ALLOWED_USER_IDS || process.env.ALLOWED_TELEGRAM_IDS || '';
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
})();

const UNAUTHORIZED_MESSAGE =
  process.env.TELEGRAM_UNAUTHORIZED_MESSAGE ||
  'You are not authorized to use this tournament bot. Please contact the tournament director.';

function isDealerIdAllowed(id) {
  if (!id) {
    return false;
  }
  if (TELEGRAM_ALLOWED_USER_IDS.size === 0) {
    return true;
  }
  return TELEGRAM_ALLOWED_USER_IDS.has(String(id));
}

function generateRoundId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const recentRounds = new Map();
const pendingDealerActions = new Map();

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

bot.use(async (ctx, next) => {
  const telegramId = ctx.from?.id;
  if (isDealerIdAllowed(telegramId)) {
    return next();
  }

  const identifier = telegramId ? String(telegramId) : 'unknown';
  const denialMessage = `${UNAUTHORIZED_MESSAGE} Your Telegram ID is ${identifier}.`;

  if (ctx.updateType === 'callback_query') {
    try {
      await ctx.answerCbQuery('Not authorized', { show_alert: true });
    } catch (error) {
      console.warn('Failed to answer callback query for unauthorized user %s:', identifier, error);
    }
  }

  if (typeof ctx.reply === 'function' && ctx.chat) {
    try {
      await ctx.reply(denialMessage);
    } catch (error) {
      console.warn('Failed to notify unauthorized user %s:', identifier, error);
    }
  }

  console.warn('Blocked unauthorized Telegram user %s from accessing the bot.', identifier);
});

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

function formatActivityTimestamp(timestamp) {
  if (!timestamp) {
    return null;
  }
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return String(timestamp);
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    return String(timestamp);
  }
}

function buildRecentActivitySummary(dealer) {
  const dealerTable = dealer?.table ? normalizeTableValue(dealer.table) : null;
  const rebuys = Array.isArray(state.state.rebuys) ? state.state.rebuys : [];
  const eliminations = Array.isArray(state.state.eliminations) ? state.state.eliminations : [];

  const matchesTable = (record) => {
    if (!dealerTable) {
      return true;
    }
    return normalizeTableValue(record.table) === dealerTable;
  };

  const recentRebuys = rebuys.filter(matchesTable).slice(-5).reverse();
  const recentEliminations = eliminations.filter(matchesTable).slice(-5).reverse();

  const lines = [];
  if (dealerTable) {
    lines.push(`Recent activity for table ${dealerTable}:`);
  } else {
    lines.push('Recent tournament activity:');
  }

  if (recentRebuys.length === 0) {
    lines.push('♻️ No rebuys recorded yet.');
  } else {
    lines.push('♻️ Rebuys');
    recentRebuys.forEach((rebuy) => {
      const details = [];
      const timestamp = formatActivityTimestamp(rebuy.createdAt);
      if (timestamp) {
        details.push(timestamp);
      }
      if (!dealerTable && rebuy.table) {
        details.push(`Table ${normalizeTableValue(rebuy.table)}`);
      }
      if (rebuy.player) {
        details.push(rebuy.player);
      }
      if (rebuy.amount) {
        details.push(`Amount ${rebuy.amount}`);
      }
      const line = details.length > 0 ? details.join(' — ') : 'Recorded';
      lines.push(`• ${line}`);
      if (rebuy.notes) {
        lines.push(`    ${rebuy.notes}`);
      }
    });
  }

  if (recentEliminations.length === 0) {
    lines.push('❌ No eliminations recorded yet.');
  } else {
    lines.push('❌ Eliminations');
    recentEliminations.forEach((elimination) => {
      const details = [];
      const timestamp = formatActivityTimestamp(elimination.createdAt);
      if (timestamp) {
        details.push(timestamp);
      }
      if (!dealerTable && elimination.table) {
        details.push(`Table ${normalizeTableValue(elimination.table)}`);
      }
      if (elimination.player) {
        details.push(elimination.player);
      }
      if (elimination.position) {
        details.push(`#${elimination.position}`);
      }
      if (elimination.payout) {
        details.push(`Payout ${elimination.payout}`);
      }
      const line = details.length > 0 ? details.join(' — ') : 'Recorded';
      lines.push(`• ${line}`);
      if (elimination.notes) {
        lines.push(`    ${elimination.notes}`);
      }
    });
  }

  return lines.join('\n');
}

function setPendingDealerAction(telegramId, payload) {
  if (telegramId === undefined || telegramId === null) {
    return;
  }
  pendingDealerActions.set(String(telegramId), payload);
}

function getPendingDealerAction(telegramId) {
  if (telegramId === undefined || telegramId === null) {
    return undefined;
  }
  return pendingDealerActions.get(String(telegramId));
}

function clearPendingDealerAction(telegramId) {
  if (telegramId === undefined || telegramId === null) {
    return;
  }
  pendingDealerActions.delete(String(telegramId));
}

function buildDealerActionKeyboard() {
  const buttons = DEALER_ACTIONS.map((action) =>
    Markup.button.callback(action.label, `${DEALER_ACTION_CALLBACK_PREFIX}${action.key}`)
  );
  return Markup.inlineKeyboard(buttons, { columns: 1 });
}

function sendDealerActionMenu(ctx, text = 'Dealer actions') {
  return ctx.reply(text, buildDealerActionKeyboard());
}

function getDealerByTelegramId(id) {
  if (id === undefined || id === null) {
    return undefined;
  }
  const identifier = String(id);
  return state.getDealers().find((dealer) => dealer.id === identifier);
}

function splitInputLines(text) {
  if (text === undefined || text === null) {
    return [];
  }
  return String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseRebuyInput(text) {
  const lines = splitInputLines(text);
  if (lines.length === 0) {
    return { player: null, amount: null, notes: null };
  }

  const player = toOptionalString(lines.shift());
  let amount = null;
  if (lines.length > 0) {
    const amountCandidate = lines[0];
    if (/^\$?\d+(?:[.,]\d{1,2})?$/.test(amountCandidate)) {
      amount = lines.shift();
    }
  }
  const notes = lines.length > 0 ? lines.join('\n') : null;
  return { player, amount: toOptionalString(amount), notes: toOptionalString(notes) };
}

function parseEliminationInput(text) {
  const lines = splitInputLines(text);
  if (lines.length === 0) {
    return { player: null, position: null, payout: null, notes: null };
  }

  const player = toOptionalString(lines.shift());
  let table = null;
  for (let index = 0; index < lines.length; index += 1) {
    const tableMatch = lines[index].match(/^t(?:able)?\s*#?\s*:?\s*(.+)$/i);
    if (tableMatch) {
      table = normalizeTableValue(tableMatch[1]);
      lines.splice(index, 1);
      break;
    }
  }
  let position = null;
  if (lines.length > 0) {
    const positionCandidate = lines[0];
    if (/^#?\d+(?:st|nd|rd|th)?$/i.test(positionCandidate)) {
      position = positionCandidate.replace(/^#/, '');
      lines.shift();
    }
  }

  let payout = null;
  if (lines.length > 0) {
    const payoutCandidate = lines[0];
    if (/^\$?\d+(?:[.,]\d{1,2})?$/.test(payoutCandidate)) {
      payout = lines.shift();
    }
  }

  const notes = lines.length > 0 ? lines.join('\n') : null;
  return {
    player,
    table: toOptionalString(table),
    position: toOptionalString(position),
    payout: toOptionalString(payout),
    notes: toOptionalString(notes)
  };
}

async function submitRebuy(payload = {}) {
  const normalizedTable = normalizeTableValue(payload.table);
  if (!normalizedTable) {
    const error = new Error('Table is required for a rebuy request.');
    error.status = 400;
    throw error;
  }

  const dealer = state.findDealerByTable(normalizedTable);
  if (!dealer) {
    const error = new Error(`No dealer is registered for table ${normalizedTable}.`);
    error.status = 404;
    throw error;
  }

  const record = state.recordRebuy({
    table: dealer.table,
    player: toOptionalString(payload.player),
    amount: toOptionalString(payload.amount),
    notes: toOptionalString(payload.notes)
  });

  const message = buildRebuyMessage(record);
  const { notified, failures } = await notifyDealers([dealer], message);
  return { record, dealer, message, notified, failures };
}

async function submitElimination(payload = {}) {
  const player = toOptionalString(payload.player);
  if (!player) {
    const error = new Error('Player name is required for eliminations.');
    error.status = 400;
    throw error;
  }

  const record = state.recordElimination({
    player,
    table: toOptionalString(payload.table),
    position: toOptionalString(payload.position),
    payout: toOptionalString(payload.payout),
    notes: toOptionalString(payload.notes)
  });

  const message = buildEliminationMessage(record);
  const { notified, failures } = await notifyDealers(state.getDealers(), message);
  return { record, message, notified, failures };
}

async function handleDealerActionSelection(ctx, actionKey) {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.answerCbQuery('Unable to determine your account.', { show_alert: true });
    return;
  }

  const dealer = getDealerByTelegramId(telegramId);
  const dealerId = String(telegramId);
  const normalizedAction = String(actionKey || '').toLowerCase();

  if (normalizedAction === DEALER_ACTION_REBUY) {
    if (!dealer || !dealer.table) {
      await ctx.answerCbQuery('Assign yourself to a table before requesting a rebuy.', {
        show_alert: true
      });
      return;
    }

    setPendingDealerAction(telegramId, {
      type: DEALER_ACTION_REBUY,
      dealerId,
      table: dealer.table
    });

    await ctx.answerCbQuery();
    const promptLines = [
      `Enter the player name or seat for the rebuy at table ${dealer.table}.`,
      'Include amount or notes on additional lines if needed.',
      'Send /cancel to abort.'
    ];
    await ctx.reply(promptLines.join('\n'), Markup.forceReply());
    return;
  }

  if (normalizedAction === DEALER_ACTION_ELIMINATION) {
    setPendingDealerAction(telegramId, {
      type: DEALER_ACTION_ELIMINATION,
      dealerId,
      table: dealer?.table ?? null
    });

    await ctx.answerCbQuery();
    const promptLines = [];
    if (dealer?.table) {
      promptLines.push(`Enter the player name or seat for the elimination at table ${dealer.table}.`);
    } else {
      promptLines.push('Enter the player name or seat for the elimination.');
      promptLines.push('Include the table number on a new line if needed.');
    }
    promptLines.push('Include payout or notes on additional lines if needed.');
    promptLines.push('Send /cancel to abort.');
    await ctx.reply(promptLines.join('\n'), Markup.forceReply());
    return;
  }

  if (normalizedAction === DEALER_ACTION_RECENT) {
    await ctx.answerCbQuery();
    const summary = buildRecentActivitySummary(dealer);
    await ctx.reply(summary);
    return;
  }

  await ctx.answerCbQuery('Unknown action.', { show_alert: true });
}

async function handleRebuyText(ctx, pending, text) {
  const telegramId = ctx.from?.id;
  const { player, amount, notes } = parseRebuyInput(text);

  if (!player) {
    await ctx.reply('Please provide a player name or seat for the rebuy.');
    return false;
  }

  const table = pending?.table ?? getDealerByTelegramId(telegramId)?.table;
  if (!table) {
    clearPendingDealerAction(telegramId);
    await ctx.reply('You are not assigned to a table. Use /start to choose your table before requesting a rebuy.');
    return true;
  }

  try {
    const result = await submitRebuy({ table, player, amount, notes });
    clearPendingDealerAction(telegramId);

    const confirmationLines = [`\u267B\uFE0F Rebuy recorded at table ${result.record.table}.`];
    const effectivePlayer = result.record.player || player;
    if (effectivePlayer) {
      confirmationLines.push(`Player: ${effectivePlayer}`);
    }
    if (result.record.amount || amount) {
      confirmationLines.push(`Amount: ${result.record.amount || amount}`);
    }
    if (result.record.notes || notes) {
      confirmationLines.push(result.record.notes || notes);
    }
    if (result.failures.length === 0) {
      confirmationLines.push('Notification sent to your table.');
    } else {
      confirmationLines.push('⚠️ Unable to deliver the automatic notification. Please confirm manually.');
    }

    await ctx.reply(confirmationLines.join('\n'));
    await sendDealerActionMenu(ctx, 'Dealer actions');
    return true;
  } catch (error) {
    clearPendingDealerAction(telegramId);
    const message = error?.message || 'Failed to record rebuy.';
    await ctx.reply(`Failed to record rebuy: ${message}`);
    await sendDealerActionMenu(ctx, 'Dealer actions');
    return true;
  }
}

async function handleEliminationText(ctx, pending, text) {
  const telegramId = ctx.from?.id;
  const parsed = parseEliminationInput(text);

  if (!parsed.player) {
    await ctx.reply('Please provide the player name or seat for the elimination.');
    return false;
  }

  const dealer = getDealerByTelegramId(telegramId);
  const table = parsed.table || pending?.table || dealer?.table || null;

  try {
    const result = await submitElimination({
      player: parsed.player,
      table,
      position: parsed.position,
      payout: parsed.payout,
      notes: parsed.notes
    });
    clearPendingDealerAction(telegramId);

    const confirmationLines = [`\u274C Elimination recorded for ${result.record.player}.`];
    const effectiveTable = result.record.table || table;
    if (effectiveTable) {
      confirmationLines.push(`Table: ${effectiveTable}`);
    }
    if (result.record.position || parsed.position) {
      confirmationLines.push(`Position: ${result.record.position || parsed.position}`);
    }
    if (result.record.payout || parsed.payout) {
      confirmationLines.push(`Payout: ${result.record.payout || parsed.payout}`);
    }
    if (result.record.notes || parsed.notes) {
      confirmationLines.push(result.record.notes || parsed.notes);
    }
    if (result.failures.length === 0) {
      confirmationLines.push('Broadcast sent to all dealers.');
    } else {
      confirmationLines.push('⚠️ Some dealers did not receive the broadcast automatically.');
    }

    await ctx.reply(confirmationLines.join('\n'));
    await sendDealerActionMenu(ctx, 'Dealer actions');
    return true;
  } catch (error) {
    clearPendingDealerAction(telegramId);
    const message = error?.message || 'Failed to record elimination.';
    await ctx.reply(`Failed to record elimination: ${message}`);
    await sendDealerActionMenu(ctx, 'Dealer actions');
    return true;
  }
}

bot.start(async (ctx) => {
  const keyboard = buildTableKeyboard(ctx.from?.id);
  await ctx.reply('Choose your table', keyboard);
  await sendDealerActionMenu(ctx, 'Dealer actions');
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

  if (data.startsWith(DEALER_ACTION_CALLBACK_PREFIX)) {
    const actionKey = data.slice(DEALER_ACTION_CALLBACK_PREFIX.length);
    await handleDealerActionSelection(ctx, actionKey);
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
  await sendDealerActionMenu(ctx, 'Dealer actions');
});

bot.command(['menu', 'actions'], async (ctx) => {
  await sendDealerActionMenu(ctx, 'Dealer actions');
});

bot.command('cancel', async (ctx) => {
  const pending = getPendingDealerAction(ctx.from?.id);
  if (pending) {
    clearPendingDealerAction(ctx.from?.id);
    await ctx.reply('Current action cancelled. Use /menu to choose another option.');
  } else {
    await ctx.reply('There is no pending action to cancel.');
  }
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

bot.command(['recent', 'history'], async (ctx) => {
  const dealer = getDealerByTelegramId(ctx.from?.id);
  await ctx.reply(buildRecentActivitySummary(dealer));
});

bot.on('text', async (ctx, next) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    if (typeof next === 'function') {
      await next();
    }
    return;
  }

  const pending = getPendingDealerAction(telegramId);
  if (!pending) {
    if (typeof next === 'function') {
      await next();
    }
    return;
  }

  const text = ctx.message?.text ?? '';
  const normalized = text.trim();
  if (!normalized) {
    await ctx.reply('Please provide a response or send /cancel to abort.');
    return;
  }

  if (normalized.toLowerCase() === '/cancel') {
    clearPendingDealerAction(telegramId);
    await ctx.reply('Current action cancelled. Use /menu to choose another option.');
    return;
  }

  if (normalized.startsWith('/')) {
    if (typeof next === 'function') {
      await next();
    }
    return;
  }

  if (pending.type === DEALER_ACTION_REBUY) {
    const handled = await handleRebuyText(ctx, pending, text);
    if (!handled && typeof next === 'function') {
      await next();
    }
    return;
  }

  if (pending.type === DEALER_ACTION_ELIMINATION) {
    const handled = await handleEliminationText(ctx, pending, text);
    if (!handled && typeof next === 'function') {
      await next();
    }
    return;
  }

  clearPendingDealerAction(telegramId);
  if (typeof next === 'function') {
    await next();
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
  if (!isDealerIdAllowed(id)) {
    res.status(403).json({ error: 'This Telegram account is not authorized to act as a dealer.' });
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
  try {
    const { record, notified, failures } = await submitRebuy(req.body || {});
    res.json({ rebuy: record, notified, failures });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) {
      console.error('Failed to process rebuy request:', error);
    }
    res
      .status(status)
      .json({ error: error.message || 'Failed to process rebuy request.' });
  }
});

app.post('/api/eliminations', async (req, res) => {
  try {
    const { record, notified, failures } = await submitElimination(req.body || {});
    res.json({ elimination: record, notified, failures });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) {
      console.error('Failed to process elimination:', error);
    }
    res
      .status(status)
      .json({ error: error.message || 'Failed to process elimination.' });
  }
});

app.use(express.static(STATIC_ROOT));

app.listen(PORT, () => {
  console.log(`Tournament manager server listening on port ${PORT}`);
});
