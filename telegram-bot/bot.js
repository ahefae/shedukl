// schedule-service Telegram bot
// Команды: /start /today /now
// Читает данные из тех же таблиц Supabase, что и сайт.

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { createClient } = require("@supabase/supabase-js");

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GROUP_NAME = process.env.GROUP_NAME || "ПО-33";

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Заполните BOT_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY в .env");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DAY_NAMES_FULL = ["", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];

function jsDayToOur(jsDay) { // JS: 0=Вс..6=Сб -> 1=Пн..6=Сб, 7=Вс(нет пар)
  return jsDay === 0 ? 7 : jsDay;
}
function toMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function hhmm(t) {
  return t.slice(0, 5);
}

async function getGroupId() {
  const { data, error } = await sb.from("groups").select("id").eq("name", GROUP_NAME).single();
  if (error || !data) throw new Error("Группа не найдена в Supabase: " + GROUP_NAME);
  return data.id;
}

async function getScheduleForDay(dayOfWeek) {
  const groupId = await getGroupId();
  const { data, error } = await sb
    .from("schedule")
    .select("*")
    .eq("group_id", groupId)
    .eq("day_of_week", dayOfWeek)
    .order("lesson_number", { ascending: true });
  if (error) throw error;
  return data || [];
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `Привет! Это бот расписания группы ${GROUP_NAME}.\n\n` +
      `/today — расписание на сегодня\n` +
      `/now — какая пара идёт прямо сейчас`
  );
});

bot.onText(/\/today/, async (msg) => {
  try {
    const today = jsDayToOur(new Date().getDay());
    if (today === 7) {
      return bot.sendMessage(msg.chat.id, "Сегодня воскресенье, пар нет 🎉");
    }
    const lessons = await getScheduleForDay(today);
    if (lessons.length === 0) {
      return bot.sendMessage(msg.chat.id, `Сегодня (${DAY_NAMES_FULL[today]}) пар нет.`);
    }
    const lines = lessons.map(
      (l) =>
        `${l.lesson_number}. ${hhmm(l.time_start)}–${hhmm(l.time_end)} — ${l.subject_name}` +
        (l.teacher ? `\n   ${l.teacher}` : "") +
        (l.room ? `, ауд. ${l.room}` : "")
    );
    bot.sendMessage(msg.chat.id, `Расписание на сегодня (${DAY_NAMES_FULL[today]}):\n\n${lines.join("\n\n")}`);
  } catch (e) {
    bot.sendMessage(msg.chat.id, "Ошибка при загрузке расписания: " + e.message);
  }
});

bot.onText(/\/now/, async (msg) => {
  try {
    const today = jsDayToOur(new Date().getDay());
    if (today === 7) {
      return bot.sendMessage(msg.chat.id, "Сегодня воскресенье, пар нет 🎉");
    }
    const lessons = (await getScheduleForDay(today)).sort(
      (a, b) => toMinutes(a.time_start) - toMinutes(b.time_start)
    );
    if (lessons.length === 0) {
      return bot.sendMessage(msg.chat.id, "На сегодня пар нет.");
    }

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const current = lessons.find(
      (l) => nowMin >= toMinutes(l.time_start) && nowMin < toMinutes(l.time_end)
    );
    if (current) {
      return bot.sendMessage(
        msg.chat.id,
        `Сейчас идёт ${current.lesson_number} пара: ${current.subject_name} ` +
          `(${hhmm(current.time_start)}–${hhmm(current.time_end)})`
      );
    }

    const next = lessons.find((l) => toMinutes(l.time_start) > nowMin);
    if (next) {
      return bot.sendMessage(
        msg.chat.id,
        `Сейчас перемена. Следующая пара в ${hhmm(next.time_start)}: ${next.subject_name}`
      );
    }

    bot.sendMessage(msg.chat.id, "На сегодня все пары закончились");
  } catch (e) {
    bot.sendMessage(msg.chat.id, "Ошибка: " + e.message);
  }
});

console.log("Бот запущен...");
