const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { Telegraf, Markup } = require('telegraf');

const CONFIG = loadConfig();
const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || CONFIG.bot_token || CONFIG.token;

if (!BOT_TOKEN) {
  throw new Error('Missing Telegram bot token. Set TELEGRAM_BOT_TOKEN/BOT_TOKEN or add bot_token to appconfig.');
}

const bot = new Telegraf(BOT_TOKEN);
const chatStates = new Map();

const LOG_DIRECTORY = path.resolve(__dirname, '..', 'logs');
const REBUY_LOG_PATH = path.join(LOG_DIRECTORY, 'rebuy-addon.log');
let logDirectoryEnsured = false;

function ensureLogDirectory() {
  if (logDirectoryEnsured) {
    return;
  }
  try {
    fs.mkdirSync(LOG_DIRECTORY, { recursive: true });
    logDirectoryEnsured = true;
  } catch (error) {
    if (error && error.code !== 'EEXIST') {
      console.error('Failed to create tournament log directory', error);
    } else {
      logDirectoryEnsured = true;
    }
  }
}

function logTournamentEvent(type, details) {
  try {
    ensureLogDirectory();
    const timestamp = new Date().toISOString();
    let payload = '';
    if (details) {
      if (typeof details === 'string') {
        payload = details;
      } else {
        try {
          payload = JSON.stringify(details);
        } catch (serializationError) {
          payload = String(details);
        }
      }
    }
    const line = `[${timestamp}] ${type.toUpperCase()} ${payload}\n`;
    fs.appendFile(REBUY_LOG_PATH, line, (appendError) => {
      if (appendError) {
        console.error('Failed to write tournament log entry', appendError);
      }
    });
  } catch (error) {
    console.error('Failed to record tournament log entry', error);
  }
}

const ACTION_REBUY = 'action:rebuy';
const ACTION_ADDON = 'action:addon';
const ACTION_ELIMINATE = 'action:eliminate';
const ACTION_RESET_ROUND = 'action:reset_round';
const ACTION_SKIP_ROUND = 'action:skip_round';
const CALLBACK_REBUY_PREFIX = 'rebuy_player:';
const CALLBACK_ADDON_PREFIX = 'addon_player:';
const CALLBACK_ELIMINATE_PREFIX = 'eliminate_player:';

bot.start(async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return;
  }

  const state = createInitialState(CONFIG);
  chatStates.set(chatId, state);

  await ctx.replyWithHTML(formatTournamentSummary(state));
  await ctx.replyWithHTML(formatSeatAssignments(state));
  await ctx.replyWithHTML(formatStructure(state));

  await startLevel(bot, chatId, state, 0, 'initial');
});

bot.action(ACTION_REBUY, async (ctx) => {
  const state = chatStates.get(ctx.chat?.id);
  if (!state) {
    await ctx.answerCbQuery('No active tournament.');
    return;
  }

  await ctx.answerCbQuery();
  const keyboard = buildPlayerKeyboard(state, CALLBACK_REBUY_PREFIX, () => true);
  if (!keyboard) {
    await ctx.reply('No players available for a rebuy right now.');
    return;
  }

  await ctx.reply('Select a player for the rebuy:', keyboard);
});

bot.action(ACTION_ADDON, async (ctx) => {
  const state = chatStates.get(ctx.chat?.id);
  if (!state) {
    await ctx.answerCbQuery('No active tournament.');
    return;
  }

  await ctx.answerCbQuery();
  const keyboard = buildPlayerKeyboard(state, CALLBACK_ADDON_PREFIX, (player) => {
    const info = state.playerStatus.get(player);
    return info && !info.eliminated;
  });
  if (!keyboard) {
    await ctx.reply('No active players available for an add-on right now.');
    return;
  }

  await ctx.reply('Select a player for the add-on:', keyboard);
});

bot.action(ACTION_ELIMINATE, async (ctx) => {
  const state = chatStates.get(ctx.chat?.id);
  if (!state) {
    await ctx.answerCbQuery('No active tournament.');
    return;
  }

  await ctx.answerCbQuery();
  const keyboard = buildPlayerKeyboard(state, CALLBACK_ELIMINATE_PREFIX, (player) => {
    const info = state.playerStatus.get(player);
    return info && !info.eliminated;
  });

  if (!keyboard) {
    await ctx.reply('All players are already marked as eliminated.');
    return;
  }

  await ctx.reply('Select a player to eliminate:', keyboard);
});

bot.action(ACTION_RESET_ROUND, async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return;
  }
  const state = chatStates.get(chatId);
  if (!state) {
    await ctx.answerCbQuery('No active tournament.');
    return;
  }
  await ctx.answerCbQuery('Current level restarted.');
  await restartCurrentLevel(bot, chatId, state);
});

bot.action(ACTION_SKIP_ROUND, async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return;
  }
  const state = chatStates.get(chatId);
  if (!state) {
    await ctx.answerCbQuery('No active tournament.');
    return;
  }

  const nextLevelIndex = state.currentLevelIndex + 1;
  if (nextLevelIndex >= state.levels.length) {
    await ctx.answerCbQuery('No more levels to skip to.');
    return;
  }

  await ctx.answerCbQuery('Moving to the next level.');
  await startLevel(bot, chatId, state, nextLevelIndex, 'skip');
});

bot.action(new RegExp(`^${escapeRegExp(CALLBACK_REBUY_PREFIX)}(.+)$`), async (ctx) => {
  const chatId = ctx.chat?.id;
  const state = chatStates.get(chatId);
  if (!state) {
    await ctx.answerCbQuery('No active tournament.');
    return;
  }

  const player = decodeURIComponent(ctx.match[1]);
  const info = state.playerStatus.get(player);
  if (!info) {
    await ctx.answerCbQuery('Unknown player.');
    return;
  }

  info.rebuys += 1;
  state.totalRebuys += 1;
  state.rebuyHistory.push({ player, timestamp: new Date().toISOString() });
  logTournamentEvent('rebuy', {
    chatId,
    player,
    playerRebuys: info.rebuys,
    totalRebuys: state.totalRebuys,
  });

  await ctx.answerCbQuery(`${player} recorded for a rebuy.`);
  await safeEditMessageText(ctx, `Rebuy recorded for ${player}.`);
  await updateMetricsMessage(bot, chatId, state);
});

bot.action(new RegExp(`^${escapeRegExp(CALLBACK_ADDON_PREFIX)}(.+)$`), async (ctx) => {
  const chatId = ctx.chat?.id;
  const state = chatStates.get(chatId);
  if (!state) {
    await ctx.answerCbQuery('No active tournament.');
    return;
  }

  const player = decodeURIComponent(ctx.match[1]);
  const info = state.playerStatus.get(player);
  if (!info) {
    await ctx.answerCbQuery('Unknown player.');
    return;
  }

  if (info.eliminated) {
    await ctx.answerCbQuery(`${player} is eliminated and cannot take an add-on.`);
    return;
  }

  info.addons += 1;
  state.totalAddons += 1;
  state.addonHistory.push({ player, timestamp: new Date().toISOString() });
  logTournamentEvent('addon', {
    chatId,
    player,
    playerAddons: info.addons,
    totalAddons: state.totalAddons,
  });

  await ctx.answerCbQuery(`${player} recorded for an add-on.`);
  await safeEditMessageText(ctx, `Add-on recorded for ${player}.`);
  await updateMetricsMessage(bot, chatId, state);
});

bot.action(new RegExp(`^${escapeRegExp(CALLBACK_ELIMINATE_PREFIX)}(.+)$`), async (ctx) => {
  const chatId = ctx.chat?.id;
  const state = chatStates.get(chatId);
  if (!state) {
    await ctx.answerCbQuery('No active tournament.');
    return;
  }

  const player = decodeURIComponent(ctx.match[1]);
  const info = state.playerStatus.get(player);
  if (!info) {
    await ctx.answerCbQuery('Unknown player.');
    return;
  }

  if (info.eliminated) {
    await ctx.answerCbQuery(`${player} is already eliminated.`);
    return;
  }

  info.eliminated = true;
  state.eliminationHistory.push({ player, timestamp: new Date().toISOString() });

  await ctx.answerCbQuery(`${player} eliminated.`);
  await safeEditMessageText(ctx, `${player} marked as eliminated.`);
  await updateMetricsMessage(bot, chatId, state);
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

function createInitialState(config) {
  const players = getPlayers(config);
  const dealers = getDealers(config, players);
  const numberOfTables = getNumber(config.number_of_tables || config.numberOfTables || config.tables) || 1;
  const seatAssignments = assignSeats(players, dealers, numberOfTables);
  const playerStatus = new Map();
  players.forEach((player) => {
    playerStatus.set(player, { rebuys: 0, addons: 0, eliminated: false });
  });

  return {
    config,
    players,
    dealers,
    numberOfTables,
    seatAssignments,
    playerStatus,
    rebuyHistory: [],
    addonHistory: [],
    eliminationHistory: [],
    totalRebuys: 0,
    totalAddons: 0,
    levels: normalizeStructure(config.structure),
    currentLevelIndex: 0,
    levelStartTime: null,
    levelTimers: {
      warning: null,
      end: null,
      metricsInterval: null
    },
    metricsMessageId: null
  };
}

function normalizeStructure(structure) {
  if (!Array.isArray(structure)) {
    return [];
  }

  return structure
    .map((entry, index) => normalizeStructureEntry(entry, index))
    .filter((entry) => entry !== null);
}

function normalizeStructureEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const normalized = { ...entry };

  if (normalized.break || normalized.type === 'break') {
    normalized.break = true;
    const duration = resolveNumber(
      normalized.time,
      normalized.duration_minutes,
      normalized.duration,
      normalized.minutes
    );
    if (Number.isFinite(duration)) {
      normalized.duration_minutes = duration;
      normalized.time = duration;
    }
    if (!normalized.label) {
      normalized.label = 'Break';
    }
    return normalized;
  }

  const roundNumber = resolveNumber(
    normalized.round,
    normalized.level,
    normalized.level_number,
    normalized.number
  );
  const resolvedRound = Number.isFinite(roundNumber) ? roundNumber : index + 1;
  normalized.round = resolvedRound;
  if (!normalized.level) {
    normalized.level = resolvedRound;
  }
  if (!normalized.level_number) {
    normalized.level_number = resolvedRound;
  }

  const sb = resolveNumber(normalized.sb, normalized.small_blind, normalized.smallBlind);
  if (Number.isFinite(sb)) {
    normalized.small_blind = sb;
    normalized.sb = sb;
  }

  const bb = resolveNumber(normalized.bb, normalized.big_blind, normalized.bigBlind);
  if (Number.isFinite(bb)) {
    normalized.big_blind = bb;
    normalized.bb = bb;
  }

  const ante = resolveNumber(normalized.ante, normalized.ante_amount, normalized.anteAmount);
  if (Number.isFinite(ante)) {
    normalized.ante = ante;
  }

  const duration = resolveNumber(
    normalized.time,
    normalized.duration_minutes,
    normalized.duration,
    normalized.minutes
  );
  if (Number.isFinite(duration)) {
    normalized.duration_minutes = duration;
    normalized.time = duration;
  }

  return normalized;
}

function getPlayers(config) {
  const raw = config.players || config.player || [];
  if (!Array.isArray(raw)) {
    return [];
  }
  const unique = new Set();
  raw.forEach((entry) => {
    const name = String(entry || '').trim();
    if (name) {
      unique.add(name);
    }
  });
  return Array.from(unique);
}

function getDealers(config, players) {
  const playerSet = new Set(players);
  const raw = config.dealers || config.dealer || [];
  if (!Array.isArray(raw)) {
    return [];
  }
  const dealers = raw
    .map((entry) => String(entry || '').trim())
    .filter((name) => name && playerSet.has(name));
  return Array.from(new Set(dealers));
}

function assignSeats(players, dealers, numberOfTables) {
  const tableCount = Math.max(1, Number.isFinite(numberOfTables) ? numberOfTables : 1);
  const seatAssignments = [];
  const dealerQueue = shuffle([...dealers]);
  const seatPool = shuffle([...players]);

  const removeFromSeatPool = (player) => {
    const index = seatPool.indexOf(player);
    if (index >= 0) {
      seatPool.splice(index, 1);
    }
  };

  for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
    const seats = new Array(10).fill(null);

    let dealer = dealerQueue.shift();
    if (dealer) {
      removeFromSeatPool(dealer);
    } else if (seatPool.length > 0) {
      dealer = seatPool.shift();
    }
    seats[1] = dealer || null;

    for (let seat = 2; seat <= 9; seat += 1) {
      if (seatPool.length === 0) {
        seats[seat] = null;
      } else {
        seats[seat] = seatPool.shift();
      }
    }

    seatAssignments.push(seats);
  }

  return seatAssignments;
}

function formatTournamentSummary(state) {
  const playersList = state.players.map((player) => `• ${escapeHtml(player)}`).join('\n');
  const dealerList = state.dealers.length
    ? state.dealers.map((dealer) => escapeHtml(dealer)).join(', ')
    : 'None';
  const lines = [
    '<b>Tournament Configuration</b>',
    '',
    `<b>Players (${state.players.length})</b>`,
    playersList || 'No players configured.',
    '',
    `<b>Dealers</b>: ${dealerList}`,
    `<b>Tables</b>: ${state.numberOfTables}`
  ];
  return lines.join('\n');
}

function formatSeatAssignments(state) {
  const lines = ['<b>Seat Draw</b>', ''];
  state.seatAssignments.forEach((tableSeats, index) => {
    lines.push(`<b>Table ${index + 1}</b>`);
    for (let seat = 1; seat <= 9; seat += 1) {
      const label = seat === 1 ? 'Seat 1 (Dealer)' : `Seat ${seat}`;
      const player = tableSeats[seat] ? escapeHtml(tableSeats[seat]) : '—';
      lines.push(`${label}: ${player}`);
    }
    if (index < state.seatAssignments.length - 1) {
      lines.push('');
    }
  });
  return lines.join('\n');
}

function formatStructure(state) {
  const levels = state.levels;
  if (!levels.length) {
    return '<b>Structure</b>\nNo blind levels configured.';
  }

  const lines = ['<b>Blind Structure</b>', ''];
  levels.forEach((level, index) => {
    lines.push(escapeHtml(formatLevelLabel(level, index)));
  });
  return lines.join('\n');
}

function formatMetrics(state) {
  const lines = ['<b>Tournament Metrics</b>', ''];

  const baseChips = getNumber(state.config?.buy_in?.chips);
  const rebuyChips = getNumber(state.config?.rebuy?.chips);
  const addonChips = getNumber(state.config?.addon?.chips);
  const totalBaseChips = Number.isFinite(baseChips) ? baseChips * state.players.length : null;
  const totalRebuyChips = Number.isFinite(rebuyChips) ? rebuyChips * state.totalRebuys : 0;
  const totalAddonChips = Number.isFinite(addonChips) ? addonChips * state.totalAddons : 0;
  if (totalBaseChips !== null || totalRebuyChips > 0 || totalAddonChips > 0) {
    const totalChips = (totalBaseChips ?? 0) + totalRebuyChips + totalAddonChips;
    lines.push(`Total chips in play: <b>${formatNumber(totalChips)}</b>`);
  }

  const baseAmount = getNumber(state.config?.buy_in?.amount);
  const rebuyAmount = getNumber(state.config?.rebuy?.amount);
  const addonAmount = getNumber(state.config?.addon?.amount);
  const currency =
    state.config?.buy_in?.currency ||
    state.config?.rebuy?.currency ||
    state.config?.addon?.currency ||
    '';
  const totalBasePrize = Number.isFinite(baseAmount) ? baseAmount * state.players.length : null;
  const totalRebuyPrize = Number.isFinite(rebuyAmount) ? rebuyAmount * state.totalRebuys : 0;
  const totalAddonPrize = Number.isFinite(addonAmount) ? addonAmount * state.totalAddons : 0;
  if (totalBasePrize !== null || totalRebuyPrize > 0 || totalAddonPrize > 0) {
    const totalPrize = (totalBasePrize ?? 0) + totalRebuyPrize + totalAddonPrize;
    lines.push(`Prize pool: <b>${escapeHtml(formatAmount(totalPrize, currency))}</b>`);
  }

  const activePlayers = Array.from(state.playerStatus.values()).filter((info) => !info.eliminated)
    .length;
  lines.push(`Active players: <b>${activePlayers}</b>`);

  const eliminatedPlayers = Array.from(state.playerStatus.entries())
    .filter(([, info]) => info.eliminated)
    .map(([player]) => escapeHtml(player));
  lines.push(
    `Eliminated players: ${eliminatedPlayers.length ? eliminatedPlayers.join(', ') : 'None'}`
  );

  lines.push(`Rebuys logged: <b>${state.totalRebuys}</b>`);
  lines.push(`Add-ons logged: <b>${state.totalAddons}</b>`);

  const level = state.levels[state.currentLevelIndex];
  if (level) {
    lines.push(`Current level: ${escapeHtml(formatLevelLabel(level, state.currentLevelIndex))}`);
    const remaining = formatTimeRemaining(state, level);
    if (remaining) {
      lines.push(`Time remaining: ${remaining}`);
    }
    const nextLevel = state.levels[state.currentLevelIndex + 1];
    if (nextLevel) {
      lines.push(`Next level: ${escapeHtml(formatLevelLabel(nextLevel, state.currentLevelIndex + 1))}`);
    }
  } else {
    lines.push('Structure complete.');
  }

  return lines.join('\n');
}

function formatTimeRemaining(state, level) {
  const durationMinutes = getLevelDurationMinutes(level);
  if (!durationMinutes || !state.levelStartTime) {
    return null;
  }
  const durationMs = durationMinutes * 60 * 1000;
  const elapsed = Date.now() - state.levelStartTime.getTime();
  const remaining = Math.max(0, durationMs - elapsed);
  return formatDuration(remaining);
}

function updateMetricsMessage(botInstance, chatId, state) {
  const text = formatMetrics(state);
  const keyboard = getMetricsKeyboard();

  if (state.metricsMessageId) {
    return botInstance.telegram
      .editMessageText(chatId, state.metricsMessageId, undefined, text, {
        parse_mode: 'HTML',
        ...keyboard
      })
      .catch((error) => {
        const errorCode =
          error?.on?.payload?.error_code || error?.code || error?.response?.error_code;
        const description =
          error?.on?.payload?.description || error?.description || error?.response?.description || '';

        if (description.includes('message is not modified')) {
          return null;
        }

        if (errorCode === 400 || errorCode === 403 || description.includes('message to edit')) {
          return sendMetricsMessage(botInstance, chatId, state, text, keyboard);
        }

        throw error;
      });
  }

  return sendMetricsMessage(botInstance, chatId, state, text, keyboard);
}

function sendMetricsMessage(botInstance, chatId, state, text, keyboard) {
  return botInstance.telegram
    .sendMessage(chatId, text, { parse_mode: 'HTML', ...keyboard })
    .then((message) => {
      state.metricsMessageId = message.message_id;
      return message;
    });
}

async function startLevel(botInstance, chatId, state, levelIndex, reason) {
  clearLevelTimers(state);

  if (levelIndex >= state.levels.length) {
    state.currentLevelIndex = state.levels.length;
    state.levelStartTime = null;
    await botInstance.telegram.sendMessage(chatId, 'All blind levels completed.');
    await updateMetricsMessage(botInstance, chatId, state);
    return;
  }

  state.currentLevelIndex = levelIndex;
  state.levelStartTime = new Date();

  const level = state.levels[levelIndex];
  const label = formatLevelLabel(level, levelIndex);
  const prefix =
    reason === 'skip'
      ? 'Skipping to'
      : reason === 'reset'
      ? 'Restarting'
      : reason === 'auto'
      ? 'Starting'
      : 'Starting';
  await botInstance.telegram.sendMessage(chatId, `${prefix} ${label}`);

  scheduleLevelTimers(botInstance, chatId, state, level, label);
  await updateMetricsMessage(botInstance, chatId, state);
}

async function restartCurrentLevel(botInstance, chatId, state) {
  if (!state.levels[state.currentLevelIndex]) {
    await botInstance.telegram.sendMessage(chatId, 'No active level to restart.');
    return;
  }
  await startLevel(botInstance, chatId, state, state.currentLevelIndex, 'reset');
}

function scheduleLevelTimers(botInstance, chatId, state, level, label) {
  const durationMinutes = getLevelDurationMinutes(level);
  if (!durationMinutes) {
    scheduleMetricsInterval(botInstance, chatId, state);
    return;
  }
  const durationMs = durationMinutes * 60 * 1000;

  const warningDelay = durationMs - 60 * 1000;
  if (warningDelay > 0) {
    state.levelTimers.warning = setTimeout(() => {
      botInstance.telegram
        .sendMessage(chatId, `1 minute remaining in ${label}.`)
        .catch((error) => console.error('Failed to send warning message', error));
    }, warningDelay);
  }

  state.levelTimers.end = setTimeout(() => {
    botInstance.telegram
      .sendMessage(chatId, `${label} complete. Advancing to the next level.`)
      .catch((error) => console.error('Failed to send level completion message', error));
    startLevel(botInstance, chatId, state, state.currentLevelIndex + 1, 'auto').catch((error) =>
      console.error('Failed to start the next level', error)
    );
  }, durationMs);

  scheduleMetricsInterval(botInstance, chatId, state);
}

function clearLevelTimers(state) {
  if (state.levelTimers.warning) {
    clearTimeout(state.levelTimers.warning);
    state.levelTimers.warning = null;
  }
  if (state.levelTimers.end) {
    clearTimeout(state.levelTimers.end);
    state.levelTimers.end = null;
  }
  if (state.levelTimers.metricsInterval) {
    clearInterval(state.levelTimers.metricsInterval);
    state.levelTimers.metricsInterval = null;
  }
}

function scheduleMetricsInterval(botInstance, chatId, state) {
  if (state.levelTimers.metricsInterval) {
    clearInterval(state.levelTimers.metricsInterval);
  }

  state.levelTimers.metricsInterval = setInterval(() => {
    updateMetricsMessage(botInstance, chatId, state).catch((error) =>
      console.error('Failed to refresh metrics message', error)
    );
  }, 60 * 1000);
}

function buildPlayerKeyboard(state, prefix, filterFn) {
  const filtered = state.players.filter((player) => filterFn(player));
  if (filtered.length === 0) {
    return null;
  }

  const buttons = filtered.map((player) =>
    Markup.button.callback(player, `${prefix}${encodeURIComponent(player)}`)
  );

  const rows = [];
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }
  return Markup.inlineKeyboard(rows);
}

function getMetricsKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('♻️ Rebuy', ACTION_REBUY),
      Markup.button.callback('➕ Add-on', ACTION_ADDON)
    ],
    [
      Markup.button.callback('❌ Eliminate Player', ACTION_ELIMINATE)
    ],
    [
      Markup.button.callback('🔁 Reset Round', ACTION_RESET_ROUND),
      Markup.button.callback('⏭️ Skip Round', ACTION_SKIP_ROUND)
    ]
  ]);
}

function formatLevelLabel(level, index) {
  if (level.break || level.type === 'break') {
    const duration = getLevelDurationMinutes(level);
    const parts = [level.label || 'Break'];
    if (Number.isFinite(duration)) {
      parts.push(`${duration}m`);
    }
    return parts.join(' – ');
  }

  const levelNumber = level.level || level.level_number || level.number || index + 1;
  const sb = getNumber(level.small_blind || level.smallBlind || level.sb);
  const bb = getNumber(level.big_blind || level.bigBlind || level.bb);
  const anteNumber = getNumber(level.ante);
  const duration = getLevelDurationMinutes(level);

  const parts = [`Level ${levelNumber}`];
  if (Number.isFinite(sb) && Number.isFinite(bb)) {
    parts.push(`${formatNumber(sb)}/${formatNumber(bb)}`);
  }
  if (Number.isFinite(anteNumber) && anteNumber > 0) {
    parts.push(`Ante ${formatNumber(anteNumber)}`);
  }
  if (Number.isFinite(duration)) {
    parts.push(`${duration}m`);
  }

  return parts.join(' – ');
}

function getLevelDurationMinutes(level) {
  const candidates = [
    level.duration_minutes,
    level.durationMinutes,
    level.duration,
    level.minutes,
    level.time_minutes,
    level.timeMinutes,
    level.time
  ];
  for (const value of candidates) {
    const number = getNumber(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return null;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatAmount(amount, currency) {
  if (!Number.isFinite(amount)) {
    return String(amount);
  }
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(amount);
  if (!currency) {
    return formatted;
  }
  return `${currency}${formatted}`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function shuffle(items) {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getNumber(value) {
  if (value === undefined || value === null || value === '') {
    return NaN;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadConfig() {
  const candidates = ['appconfig.yaml', 'appconfig.yml', 'appconfig.json'];
  for (const file of candidates) {
    const resolved = path.resolve(__dirname, '..', file);
    if (!fs.existsSync(resolved)) {
      continue;
    }

    const raw = fs.readFileSync(resolved, 'utf8');
    if (!raw.trim()) {
      continue;
    }

    if (file.endsWith('.json')) {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
    const parsed = yaml.load(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  throw new Error('No configuration file found. Create appconfig.yaml or appconfig.json at the project root.');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveNumber(...values) {
  for (const value of values) {
    const number = getNumber(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return NaN;
}

async function safeEditMessageText(ctx, text) {
  try {
    await ctx.editMessageText(text);
  } catch (error) {
    const errorCode = error?.on?.payload?.error_code || error?.code || error?.response?.error_code;
    const description =
      error?.on?.payload?.description || error?.description || error?.response?.description || '';

    if (description.includes('message is not modified') || description.includes('message to edit')) {
      return;
    }

    if (errorCode !== 400) {
      throw error;
    }
  }
}
