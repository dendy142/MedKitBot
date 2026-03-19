import { InlineKeyboard } from 'grammy';
import { supabase } from '../db/supabase.js';
import { getUserMedkits } from '../db/queries/medkits.js';
import { getMedkitMedicines } from '../db/queries/medicines.js';

/**
 * Get user's courses
 */
async function getUserCourses(userId, status = null) {
  let query = supabase
    .from('courses')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data } = await query;
  return data || [];
}

/**
 * Get course by id
 */
async function getCourse(courseId) {
  const { data } = await supabase
    .from('courses')
    .select('*')
    .eq('id', courseId)
    .single();
  return data;
}

/**
 * Get medicines linked to a course
 */
async function getCourseMedicines(courseId) {
  const { data } = await supabase
    .from('course_medicines')
    .select('*, medicines(id, name, dosage, quantity, quantity_unit)')
    .eq('course_id', courseId);
  return data || [];
}

/**
 * Show courses list
 */
async function showCoursesList(ctx) {
  const courses = await getUserCourses(ctx.dbUser.id);
  const keyboard = new InlineKeyboard();

  let text = '📋 *Курсы лечения*\n\n';

  if (courses.length === 0) {
    text += '_Нет созданных курсов._\n';
  } else {
    for (const c of courses) {
      const statusEmoji = c.status === 'active' ? '▶️' : c.status === 'completed' ? '✅' : '⏸';
      text += `${statusEmoji} *${c.name}*\n`;
      keyboard.text(`${statusEmoji} ${c.name}`, `course:${c.id}`).row();
    }
  }

  keyboard.text(ctx.t('course.btn_create'), 'course:create').row();
  keyboard.text(ctx.t('common.back'), 'main_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

/**
 * Show single course detail
 */
async function showCourseDetail(ctx, courseId) {
  const course = await getCourse(courseId);
  if (!course) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery(ctx.t('common.not_found'));
    return;
  }

  const medicines = await getCourseMedicines(courseId);
  const statusEmoji = course.status === 'active' ? '▶️' : course.status === 'completed' ? '✅' : '⏸';

  let text = `${statusEmoji} ${ctx.t('course.title', { name: course.name })}\n\n`;

  if (medicines.length === 0) {
    text += '_Нет привязанных лекарств._\n';
  } else {
    text += '💊 *Лекарства:*\n';
    for (const cm of medicines) {
      const med = cm.medicines;
      if (med) {
        text += `  • ${med.name}${med.dosage ? ' ' + med.dosage : ''}\n`;
      }
    }
  }
  text += '\n';

  const keyboard = new InlineKeyboard();

  if (course.status === 'active') {
    keyboard.text(ctx.t('course.btn_schedules'), `course:${courseId}:schedules`);
    keyboard.text(ctx.t('course.btn_pause_all'), `course:${courseId}:pause`);
    keyboard.row();
    keyboard.text(ctx.t('course.btn_complete'), `course:${courseId}:complete`);
    keyboard.row();
  } else if (course.status === 'paused') {
    keyboard.text('▶️ Возобновить', `course:${courseId}:activate`);
    keyboard.text(ctx.t('course.btn_complete'), `course:${courseId}:complete`);
    keyboard.row();
  }

  keyboard.text('➕ Добавить лекарства', `course:${courseId}:addmeds`).row();
  keyboard.text('🗑 Удалить курс', `course:${courseId}:delete`).row();
  keyboard.text(ctx.t('common.back'), 'courses');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

/**
 * Register course handlers
 */
export function registerCourseHandlers(bot) {
  // List courses
  bot.callbackQuery('courses', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showCoursesList(ctx);
  });

  // View course
  bot.callbackQuery(/^course:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showCourseDetail(ctx, ctx.match[1]);
  });

  // Create course — ask name
  bot.callbackQuery('course:create', async (ctx) => {
    await ctx.answerCallbackQuery();
    const msg = await ctx.editMessageText(ctx.t('course.create_name'), {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'courses'),
    });
    await supabase.from('sessions').upsert({
      key: `state:${ctx.dbUser.id}`,
      value: { action: 'create_course', msgId: msg.message_id },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  });

  // Course: add medicines — show medkit selection then medicine picker
  bot.callbackQuery(/^course:([0-9a-f-]+):addmeds$/, async (ctx) => {
    const courseId = ctx.match[1];
    await ctx.answerCallbackQuery();

    const medkits = await getUserMedkits(ctx.dbUser.id);
    if (medkits.length === 0) {
      await ctx.editMessageText(ctx.t('export_import.export_no_medkits'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.back'), `course:${courseId}`),
      });
      return;
    }

    // Show medicines from all medkits
    const keyboard = new InlineKeyboard();
    for (const mk of medkits) {
      const meds = await getMedkitMedicines(mk.id);
      for (const med of meds) {
        keyboard.text(`💊 ${med.name}`, `course:${courseId}:linkmed:${med.id}`).row();
      }
    }
    keyboard.text(ctx.t('common.done'), `course:${courseId}`);

    await ctx.editMessageText(ctx.t('course.select_medicines'), {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  // Link medicine to course
  bot.callbackQuery(/^course:([0-9a-f-]+):linkmed:([0-9a-f-]+)$/, async (ctx) => {
    const courseId = ctx.match[1];
    const medicineId = ctx.match[2];

    try {
      await supabase.from('course_medicines').upsert({
        course_id: courseId,
        medicine_id: medicineId,
      }, { onConflict: 'course_id,medicine_id' });
      await ctx.answerCallbackQuery('✅ Добавлено');
    } catch (e) {
      console.error('Error linking medicine to course:', e);
      await ctx.answerCallbackQuery(ctx.t('common.error'));
    }
  });

  // View all schedules for course medicines
  bot.callbackQuery(/^course:([0-9a-f-]+):schedules$/, async (ctx) => {
    const courseId = ctx.match[1];
    await ctx.answerCallbackQuery();
    const medicines = await getCourseMedicines(courseId);

    let text = '📆 *Расписания курса:*\n\n';
    for (const cm of medicines) {
      const med = cm.medicines;
      if (!med) continue;

      const { data: scheds } = await supabase
        .from('schedules')
        .select('*')
        .eq('medicine_id', med.id)
        .eq('status', 'active');

      if (scheds && scheds.length > 0) {
        text += `💊 *${med.name}*\n`;
        for (const s of scheds) {
          text += `  ⏰ ${s.time_value} — ${s.dose_per_intake} ${med.quantity_unit || 'шт'}\n`;
        }
        text += '\n';
      }
    }

    if (text === '📆 *Расписания курса:*\n\n') {
      text += '_Нет активных расписаний._\n';
    }

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text(ctx.t('common.back'), `course:${courseId}`),
    });
  });

  // Pause course — pause all linked schedules
  bot.callbackQuery(/^course:([0-9a-f-]+):pause$/, async (ctx) => {
    const courseId = ctx.match[1];
    await ctx.answerCallbackQuery();

    await supabase.from('courses').update({ status: 'paused' }).eq('id', courseId);

    const medicines = await getCourseMedicines(courseId);
    for (const cm of medicines) {
      if (cm.medicines?.id) {
        await supabase
          .from('schedules')
          .update({ status: 'paused' })
          .eq('medicine_id', cm.medicines.id)
          .eq('status', 'active');
      }
    }

    await showCourseDetail(ctx, courseId);
  });

  // Activate (resume) course
  bot.callbackQuery(/^course:([0-9a-f-]+):activate$/, async (ctx) => {
    const courseId = ctx.match[1];
    await ctx.answerCallbackQuery();

    await supabase.from('courses').update({ status: 'active' }).eq('id', courseId);

    const medicines = await getCourseMedicines(courseId);
    for (const cm of medicines) {
      if (cm.medicines?.id) {
        await supabase
          .from('schedules')
          .update({ status: 'active' })
          .eq('medicine_id', cm.medicines.id)
          .eq('status', 'paused');
      }
    }

    await showCourseDetail(ctx, courseId);
  });

  // Complete course
  bot.callbackQuery(/^course:([0-9a-f-]+):complete$/, async (ctx) => {
    const courseId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await supabase.from('courses').update({ status: 'completed' }).eq('id', courseId);
    await showCourseDetail(ctx, courseId);
  });

  // Delete course
  bot.callbackQuery(/^course:([0-9a-f-]+):delete$/, async (ctx) => {
    const courseId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await supabase.from('course_medicines').delete().eq('course_id', courseId);
    await supabase.from('courses').delete().eq('id', courseId);
    await showCoursesList(ctx);
  });
}

/**
 * Handle text state for course creation
 * Called from textState.js
 */
export async function handleCourseTextState(state, text, ctx) {
  if (state.action === 'create_course') {
    const name = text.trim();
    if (!name || name.length > 100) return null;

    // Get first medkit
    const medkits = await getUserMedkits(ctx.dbUser.id);
    const medkitId = medkits.length > 0 ? medkits[0].id : null;

    const { data: course, error } = await supabase
      .from('courses')
      .insert({
        user_id: ctx.dbUser.id,
        medkit_id: medkitId,
        name,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating course:', error);
      return null;
    }

    const keyboard = new InlineKeyboard()
      .text('➕ Добавить лекарства', `course:${course.id}:addmeds`)
      .row()
      .text(ctx.t('common.back'), 'courses');

    await ctx.api.editMessageText(ctx.chat.id, state.msgId,
      `✅ Курс *«${name}»* создан!\n\nДобавьте лекарства к курсу:`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );

    return 'handled';
  }
  return null;
}
