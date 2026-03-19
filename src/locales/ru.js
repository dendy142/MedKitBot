// Russian locale — all user-facing strings
// Every string in the bot MUST come from this file via ctx.t()

export default {
  // ── Common buttons & labels ──────────────────────────────────────
  common: {
    back: '◀️ Назад',
    cancel: '❌ Отмена',
    confirm: '✅ Подтвердить',
    yes: '✅ Да',
    no: '❌ Нет',
    yes_delete: '✅ Да, удалить',
    save: '✅ Сохранить',
    skip: '⏭ Пропустить',
    done: '✅ Готово',
    loading: '⏳ Загружаю...',
    error: '⚠️ Произошла ошибка. Попробуйте ещё раз или вернитесь в /menu',
    data_outdated: '⚠️ Данные устарели. Вернитесь в /menu',
    not_found: 'Не найдено',
    main_menu: '🏠 Главное меню',
    to_medkits: '📦 Мои аптечки',
    to_settings: '⚙️ Настройки',
    to_help: '📖 Помощь',
    add_more: '➕ Ещё',
    retry: '🔄 Попробовать снова',
    open: '📦 Открыть',
    created: 'Создано',
    deleted: 'Удалено',
    updated: 'Обновлено',
    cancelled: 'Отменено',
    feature_wip: 'Скоро! Функция в разработке.',
  },

  // ── Main menu / Dashboard ────────────────────────────────────────
  menu: {
    title: '👋 *Главное меню*\n\n',
    medkits_count: '📦 Аптечек: {count}',
    intake_today: '💊 Приём: {taken}/{total} принято',
    expiring_soon: '⚠️ Истекает скоро: {count}',
    low_stock: '📉 Заканчивается: {count}',
    shopping_count: '🛒 В списке покупок: {count}',
    btn_medkits: '📦 Аптечки',
    btn_intake: '💊 Приём',
    btn_shopping: '🛒 Покупки',
    btn_search: '🔍 Поиск',
    btn_stats: '📊 Статистика',
    btn_settings: '⚙️ Настройки',
    btn_intake_today: '⏰ Приёмы сегодня',
    btn_add_medicine: '➕ Добавить лекарство',
    // Empty states
    empty_medkits: 'У вас пока нет аптечек.',
    empty_intakes: 'Нет запланированных приёмов.',
    // Attention banner (#92)
    attention: '⚠️ Требует внимания:',
    attention_expired: '🔴 {count} просрочено',
    attention_expiring: '🟡 {count} скоро истекут',
    btn_attention: 'Посмотреть',
  },

  // ── Medkits ──────────────────────────────────────────────────────
  medkit: {
    list_title: '📦 *Мои аптечки*\n\n',
    list_empty: '📦 *Мои аптечки*\n\nУ вас пока нет аптечек. Создайте первую!',
    title: '📦 *{name}* ({count})',
    title_shared: ' 👥',
    filter_active: '\n🔍 Фильтр: {type} «{value}»',
    filter_category: 'категория',
    filter_tag: 'тег',
    empty: '_Аптечка пуста. Добавьте первое лекарство!_\n',
    btn_create: '➕ Создать аптечку',
    btn_add: '➕ Добавить',
    btn_sort: '🔀 Сортировка',
    btn_filter: '📂 Фильтр',
    btn_share: '👥 Поделиться',
    btn_edit: '✏️ Редакт.',
    btn_delete: '🗑 Удалить',
    btn_archive: '📂 Архив',
    btn_to_medkit: '◀️ К аптечке',
    btn_to_medkits: '◀️ К аптечкам',
    // Create
    create_prompt: '📦 *Новая аптечка*\n\nВведите название:',
    created: '✅ Аптечка *«{name}»* создана!',
    // Rename
    renamed: '✅ Аптечка переименована в *«{name}»*',
    // Delete
    delete_confirm: '🗑 Вы уверены, что хотите удалить аптечку «{name}»?\n\n⚠️ Все лекарства в ней будут удалены!',
    delete_toast: 'Аптечка удалена',
    // Sort
    sort_title: '🔀 *Сортировка*\n\nВыберите порядок:',
    sort_name: 'По названию',
    sort_expiry: 'По сроку',
    sort_category: 'По категории',
    sort_quantity: 'По остатку',
    sort_problems: '⚠️ Проблемы',
    // Filter
    filter_title: '📂 *Фильтр*\n\nВыберите тип фильтра:',
    filter_by_category: 'По категории ▸',
    filter_by_tag: 'По тегу ▸',
    filter_clear: '❌ Сбросить',
    filter_no_categories: '📂 Нет категорий в этой аптечке.',
    filter_no_tags: '📂 Нет тегов в этой аптечке.',
    filter_category_title: '📂 *Фильтр по категории*\n\nВыберите категорию:',
    filter_tag_title: '📂 *Фильтр по тегу*\n\nВыберите тег:',
    // Medicine list line
    med_line_remainder: '   Остаток: {qty}',
    med_line_expiry: ' | До: {expiry}',
    // Rename
    rename_prompt: '✏️ Введите новое название аптечки:',
    // Multiselect (#22)
    btn_multiselect: '☑️ Выбрать несколько',
    btn_multiselect_move: '📦 Переместить',
    btn_multiselect_archive: '🗄 Архивировать',
    btn_multiselect_delete: '🗑 Удалить',
  },

  // ── Medicine card & actions ──────────────────────────────────────
  medicine: {
    not_found: 'Лекарство не найдено',
    // Card labels
    label_category: '📁 Категория: {value}',
    label_tags: '🏷 Теги: {value}',
    label_expiry: '📅 Срок: {value}',
    label_quantity: '📏 Остаток: {value}',
    label_notes: '📝 {value}',
    label_favorite: '⭐ В избранном',
    label_added: '📅 Добавлено: {date}',
    label_schedules: '⏰ Расписания:',
    label_schedule_item: '  • {info}',
    // Status badges (#17)
    badge_expired: '🔴 Истёк',
    badge_expiring: '🟡 Истекает через {days}д',
    badge_low: '🟠 Мало',
    badge_favorite: '⭐',
    // Buttons
    btn_edit: '✏️ Ред.',
    btn_restock: '➕ Пополнить',
    btn_schedule: '📆 Приём',
    btn_copy: '📂 Копир.',
    btn_photos: '📷 Фото ({count})',
    btn_history: '📋 История',
    btn_shop: '🛒 В покупки',
    btn_archive: '🗑 В архив',
    btn_to_medicine: '◀️ К лекарству',
    // Quick restock (#18)
    btn_restock_1: '+1',
    btn_restock_5: '+5',
    btn_restock_10: '+10',
    btn_restock_custom: 'Ввести число',
    // Archive
    archive_confirm: '🗑 Переместить «{name}» в архив?',
    archive_toast: 'Перемещено в архив',
    archive_done: '✅ Лекарство перемещено в архив.',
    // Restore
    restore_toast: 'Лекарство восстановлено',
    restore_done: '✅ Лекарство восстановлено из архива.',
    // Permanent delete
    delete_confirm: '🗑 Удалить навсегда «{name}»? Это действие нельзя отменить.',
    delete_toast: 'Лекарство удалено навсегда',
    delete_done: '✅ Лекарство удалено навсегда.',
    btn_to_archive: '◀️ К архиву',
    // Restock
    restock_prompt: '➕ *Пополнение: {name}*\n\nТекущий остаток: {quantity}\n\nВведите количество для добавления:',
    restock_done: '✅ Остаток пополнен: {quantity}',
    restock_invalid: '⚠️ Некорректное число.',
    // Edit
    edit_title: '✏️ *Редактирование: {name}*\n\nЧто изменить?',
    edit_prompt: '✏️ Введите новое значение для поля «{field}»:',
    edit_done: '✅ Поле обновлено.',
    field_name: 'Название',
    field_dosage: 'Дозировка',
    field_category: 'Категория',
    field_expiry: 'Срок годн.',
    field_quantity: 'Количество',
    field_notes: 'Заметки',
    field_tags: 'Теги',
    // Accusative case for edit prompts
    field_acc_name: 'название',
    field_acc_dosage: 'дозировку',
    field_acc_category: 'категорию',
    field_acc_expiry: 'срок годности (ДД.ММ.ГГГГ или ММ.ГГГГ)',
    field_acc_quantity: 'количество',
    field_acc_notes: 'заметки',
    field_acc_tags: 'теги (через запятую)',
    // Photos
    photos_title: '📷 Все фото:',
    // History
    history_title: '📋 *История: {name}*\n\n',
    history_empty: '_Нет записей об изменениях._\n',
    history_user: 'Пользователь',
    history_empty_value: '(пусто)',
    // Copy/Move
    copymove_title: '📂 *Копирование / Перемещение*\n\nВыберите действие:',
    btn_copy_action: '📋 Копировать',
    btn_move_action: '📦 Переместить',
    copy_no_medkits: '📋 Нет других аптечек для копирования.\n\nСоздайте ещё одну аптечку.',
    copy_title: '📋 *Копировать «{name}»*\n\nВыберите аптечку:',
    copy_done: '✅ «{name}» скопировано в аптечку «{target}».',
    move_no_medkits: '📦 Нет других аптечек для перемещения.\n\nСоздайте ещё одну аптечку.',
    move_title: '📦 *Переместить «{name}»*\n\nВыберите аптечку:',
    move_done: '✅ «{name}» перемещено в аптечку «{target}».',
    // Archive list
    archive_empty: '📂 Архив пуст.',
    archive_title: '📂 *Архив*\n\n',
    // Shopping
    added_to_shop: '✅ *{name}* добавлен в список покупок!',
    added_to_shop_toast: 'Добавлено в список покупок',
    btn_to_shop: '🛒 К списку',
    // Duplicate check (#30)
    duplicate_found: '💊 В этой аптечке уже есть «{name}». Добавить новое или перейти к существующему?',
    btn_add_anyway: 'Добавить новое',
    btn_go_existing: 'Перейти',
    // Suggest schedule (#39)
    suggest_schedule: '⏰ Хотите создать расписание приёма для этого лекарства?',
    btn_yes_schedule: 'Да',
    btn_no_schedule: 'Нет, позже',
    // Date validation (#34)
    expiry_in_past: '⚠️ Эта дата уже прошла. Лекарство будет отмечено как просроченное. Продолжить?',
    btn_continue: 'Да',
    btn_enter_another: 'Ввести другую дату',
    expiry_far_future: '⚠️ Дата очень далёкая ({date}). Вы уверены?',
    // Expired status
    expired: 'ПРОСРОЧЕНО',
  },

  // ── Add medicine wizard ──────────────────────────────────────────
  addmed: {
    medkit_not_found: 'Аптечка не найдена',
    // Step prompts
    step1: '💊 *Добавление в «{medkit}»*\n\nШаг 1/8: Введите *название* лекарства:',
    step2_unit: 'Шаг 2/8: Выберите *единицу дозировки*:',
    step2_value: 'Шаг 2/8: Введите *количество* в *{unit}* (напр. 500):',
    step2_custom: 'Шаг 2/8: Введите *дозировку* целиком (напр. «2 капли», «1 пакетик»):',
    step3_category: 'Шаг 3/8: Выберите *категорию*:',
    step3_custom: 'Шаг 3/8: Введите *свою категорию*:',
    btn_custom_category: '✏️ Своя категория',
    step4_tags: 'Шаг 4/8: Введите *теги* через запятую (напр. «для детей, рецептурное»):',
    step5_year: 'Шаг 5/8: Выберите *год* срока годности:',
    step5_month: 'Шаг 5/8: Выберите *месяц* ({year}):',
    step5_day: 'Шаг 5/8: Выберите *день* ({month} {year}) или оставьте только месяц:',
    step5_month_only: 'Только {month} {year}',
    step6_quantity: 'Шаг 6/8: Введите *количество* (число):',
    step6_invalid: 'Шаг 6/8: Введите *количество* (число):\n\n⚠️ Некорректное число, попробуйте ещё раз.',
    step6_unit: 'Выберите *единицу измерения*:',
    step7_photos: 'Шаг 7/8: Отправьте *фото* лекарства (до {max} шт.):',
    step7_more: 'Шаг 7/8: *Фото* лекарства ({count}/{max})\n\nОтправьте ещё или нажмите «Готово».',
    step7_send: 'Отправьте фото',
    step8_notes: 'Шаг 8/8: Добавьте *заметки* (напр. «принимать после еды»):',
    // Months short (for expiry picker)
    months_short: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
    // Buttons
    btn_open: '💊 Открыть',
    // Photos count
    photos_count: '{count} шт.',
    // Confirmation
    confirm_title: '📋 *Проверьте данные:*',
    confirm_name: '💊 *Название:* {value}',
    confirm_dosage: '💉 *Дозировка:* {value}',
    confirm_category: '🏷 *Категория:* {value}',
    confirm_tags: '🏷 *Теги:* {value}',
    confirm_expiry: '📅 *Срок годности:* {value}',
    confirm_quantity: '📏 *Количество:* {value}',
    confirm_photos: '📷 *Фото:* {value}',
    confirm_notes: '📝 *Заметки:* {value}',
    // Cancel
    cancel_toast: 'Отменено',
    cancel_confirm: '❌ Данные будут потеряны. Отменить?',
    btn_cancel_no: 'Нет, продолжить',
    cancel_done: '❌ Добавление отменено.',
    // Success
    success: '✅ Лекарство *«{name}»* добавлено!',
    // Validation (#14)
    invalid_date: 'Введите дату в формате ДД.ММ.ГГГГ, например 15.03.2027',
    invalid_number: 'Введите число, например 30 или 0.5',
    invalid_name: 'Введите название лекарства (до 100 символов)',
    // Auto-category (#33)
    auto_category: 'Подсказка: категория «{category}» подобрана автоматически.',
    // Hint from history (#31)
    hint_from_history: 'Вы раньше добавляли «{name}» ({category}). Использовать те же параметры?',
    btn_use_hint: 'Да, использовать',
    btn_enter_manual: 'Нет, вручную',
    // Templates (#32)
    btn_from_templates: '📋 Из моих лекарств',
    templates_title: '📋 *Выберите лекарство:*\n\nОно будет добавлено с предыдущими параметрами.',
    templates_empty: 'У вас пока нет добавленных лекарств.',
    // Last category (#15)
    last_category: '(последняя)',
    // Onboarding skip
    skip_onboarding: '⏭ Добавление пропущено. Вы сможете добавить лекарства позже.\n\nВот что умеет бот:',
    skip_onboarding_short: '⏭ Добавление пропущено. Вы сможете добавить лекарства позже.',
  },

  // ── Onboarding success text ──────────────────────────────────────
  onboarding_success: '✅ Лекарство *«{name}»* добавлено!\n\n🎉 *Всё готово! Вот что вы можете делать:*\n\n📦 *Аптечки* — создавайте несколько аптечек и переключайтесь между ними\n\n💊 *Лекарства* — добавляйте с дозировкой, сроком годности, категорией, фото и заметками\n\n📆 *Приём* — настройте расписание, и бот будет напоминать вовремя\n\n👥 *Общий доступ* — поделитесь аптечкой с семьёй по ссылке\n\n🔍 *Поиск* — просто напишите название лекарства в чат\n\n⚙️ *Настройки* — часовой пояс, уведомления, дайджест',

  // ── Intake ───────────────────────────────────────────────────────
  intake: {
    title: '💊 *Приём на сегодня*\n\n',
    empty: '💊 *Приём на сегодня*\n\nНет запланированных приёмов.\n\nДобавьте курс приёма через карточку лекарства (📆 Приём).',
    time_header: '🕐 *{time}*\n',
    unknown_medicine: 'Неизвестно',
    summary: '📊 Итого: {taken}/{total} принято',
    summary_skipped: ', {count} пропущено',
    summary_pending: ', {count} ожидает',
    default_unit: 'шт',
    // Actions
    taken_toast: '✅ Приём отмечен',
    taken_error: 'Ошибка при отметке приёма',
    skipped_toast: '❌ Приём пропущен',
    skipped_error: 'Ошибка',
    snoozed_toast: '⏰ Отложено на 15 мин',
    snoozed_label: '⏰ _Отложено_',
    taken_label: '✅ _Принято_',
    skipped_label: '❌ _Пропущено_',
    // Buttons
    btn_take: '✅ Принял',
    btn_snooze: '⏰ +15 мин',
    btn_skip: '❌ Пропуск',
    btn_note: '📝 Заметка',
    btn_to_intakes: '💊 К приёмам',
    // Note input
    note_prompt: '📝 Введите заметку к приёму:',
    note_saved: '✅ Приём отмечен с заметкой: _{text}_',
    note_error: '❌ Ошибка при сохранении заметки.',
    // Skip reason (#58)
    skip_reason_title: 'Причина пропуска:',
    skip_reason_forgot: 'Забыл',
    skip_reason_sick: 'Плохое самочувствие',
    skip_reason_empty: 'Закончилось',
    skip_reason_doctor: 'Решение врача',
    skip_reason_other: 'Другое',
    // Calendar (#101)
    calendar_title: '📅 {month} {year}:',
    btn_today: '📅 Сегодня',
    btn_tomorrow: '📅 Завтра',
    btn_yesterday: '📅 Вчера',
  },

  // ── Schedules ────────────────────────────────────────────────────
  schedule: {
    list_title: '📆 *Курсы приёма: {name}*\n',
    list_remainder: '📏 Остаток: {quantity}',
    list_empty: 'Нет активных курсов.\n',
    btn_add: '➕ Добавить курс',
    btn_pause: '⏸ Пауза',
    btn_resume: '▶️ Возобн.',
    btn_to_schedules: '📆 К курсам',
    btn_to_medicine: '◀️ К лекарству',
    // Status icons
    status_active: '▶️',
    status_paused: '⏸',
    // Day labels
    days_short: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    // Period labels
    period_morning: '🌅 Утро',
    period_afternoon: '☀️ День',
    period_evening: '🌆 Вечер',
    period_night: '🌙 Ночь',
    // Frequency labels
    freq_daily: 'Ежедневно',
    freq_every_other_day: 'Через день',
    freq_weekly: 'По дням недели',
    // Duration labels
    duration_indefinite: '♾ Бессрочно',
    duration_days: '📅 {count} дней',
    duration_until: '📅 До {date}',
    // Creation flow
    time_prompt: '🕐 Введите время в формате ЧЧ:ММ (например, 08:30):',
    time_invalid: '⚠️ Неверный формат. Введите время в формате ЧЧ:ММ (например, 08:30):',
    time_invalid_range: '⚠️ Некорректное время. Введите в формате ЧЧ:ММ:',
    period_prompt: '🕐 *Выберите период дня:*',
    dose_prompt: '💊 *Доза за приём*\n\nЛекарство: {name}\nВремя: {time}\n\nВведите количество ({unit}) за один приём:',
    dose_invalid: '⚠️ Введите положительное число.',
    freq_prompt: '🔄 *Частота приёма:*',
    btn_freq_daily: 'Ежедневно',
    btn_freq_every_other: 'Через день',
    btn_freq_weekly: 'По дням недели',
    days_prompt: '📅 *Выберите дни недели:*\n\nВыбрано: {selected}',
    days_none: 'ничего не выбрано',
    days_select_one: 'Выберите хотя бы один день',
    duration_prompt: '⏳ *Длительность курса:*',
    btn_dur_indefinite: '♾ Бессрочно',
    btn_dur_days: '📅 Количество дней',
    btn_dur_date: '📅 До конкретной даты',
    dur_days_prompt: '📅 Введите количество дней курса:',
    dur_days_invalid: '⚠️ Введите положительное целое число дней:',
    dur_date_prompt: '📅 Введите дату окончания курса в формате ДД.ММ.ГГГГ:',
    dur_date_invalid: '⚠️ Не удалось распознать дату.',
    // Confirmation
    confirm_title: '📋 *Подтверждение курса*\n\n',
    confirm_dose: '💊 Доза: {dose} {unit}',
    confirm_ok: 'Всё верно?',
    btn_create: '✅ Создать',
    created_toast: '✅ Курс приёма создан!',
    create_error: '❌ Ошибка при создании курса.',
    // Delete
    delete_confirm: '🗑 Удалить курс приёма?',
    delete_toast: 'Курс удалён',
    delete_done: '✅ Курс удалён.',
    // Time mode selection
    time_mode_prompt: '⏰ *Когда принимать?*\n\nВыберите режим:',
    btn_time_exact: '🕐 Точное время',
    btn_time_period: '🌅 Период дня',
    // Period selection prompt (non-bold variant)
    period_select_prompt: '🌅 Выберите период дня:',
    // Duration button labels (short)
    btn_dur_n_days: '📅 N дней',
    btn_dur_until_date: '📅 До даты',
    // Duration prompt (bold variant used in callbacks)
    duration_prompt_bold: '📅 *Длительность курса:*',
    // Created success screen
    btn_to_schedules_label: '📆 К курсам',
    btn_to_medicine_label: '◀️ К лекарству',
    // Extra validation
    dose_invalid_positive: '⚠️ Введите положительное число:',
    dur_days_invalid_int: '⚠️ Введите положительное целое число дней:',
    dur_date_invalid_format: '⚠️ Введите дату в формате ДД.ММ.ГГГГ:',
    dur_date_future: '⚠️ Дата должна быть в будущем. Введите в формате ДД.ММ.ГГГГ:',
    // Error
    error_generic: 'Ошибка',
    // Conflict check (#29)
    conflict: '⚠️ У вас уже есть приём «{name}» в {time}. Создать ещё одно?',
    btn_conflict_yes: 'Да, создать',
    // Auto-pause (#40)
    auto_pause: '⏸ {name} закончился — расписание ({count}) поставлено на паузу.',
    // Resume suggestion (#41)
    resume_suggest: '▶️ Вы пополнили {name}. Возобновить расписание ({count})?',
    btn_resume_yes: '▶️ Возобновить',
    btn_resume_no: 'Нет',
    btn_resume_all: '▶️ Возобновить все',
  },

  // ── Shopping list ────────────────────────────────────────────────
  shopping: {
    title: '🛒 *Список покупок* ({count})\n\n',
    empty: '🛒 *Список покупок*\n\nСписок пуст.',
    empty_short: 'Список пуст',
    btn_add: '➕ Добавить',
    btn_clear: '🗑 Очистить',
    btn_share: '📤 Поделиться',
    btn_to_list: '🛒 К списку',
    add_prompt: '🛒 Введите название товара для списка покупок:',
    added_toast: 'Добавлено в список покупок',
    added: '✅ *{name}* добавлен в список покупок!',
    bought_toast: 'Куплено!',
    bought: '✅ *{name}* — куплено!\n\nПополнить остаток в аптечке?',
    btn_restock: '➕ Пополнить',
    btn_no_restock: '⏭ Нет',
    clear_confirm: '🗑 Очистить весь список покупок?',
    clear_toast: 'Список очищен',
    share_header: '🛒 Список покупок:\n\n',
    share_footer: '\nСформировано в @my_med_kit_bot',
    // Quantity (#106)
    quantity_prompt: 'Сколько упаковок?',
    btn_qty_custom: 'Ввести число',
  },

  // ── Search ───────────────────────────────────────────────────────
  search: {
    prompt: '🔍 *Поиск лекарства*\n\nВведите название лекарства:',
    no_results: '🔍 По запросу «{query}» ничего не найдено.\n\nПопробуйте другое название или перейдите в аптечку.',
    results_title: '🔍 Результаты по «{query}»:\n\n',
    medkit_header: '📦 *{name}*\n',
    btn_search_again: '🔍 Искать ещё',
    // Extended search (#109-111)
    btn_by_category: '🔍 По категории',
    btn_by_expiry: '🔍 По сроку',
    btn_by_status: '🔍 По статусу',
    status_expired: '🔴 Просроченные',
    status_expiring: '🟡 Скоро истекут',
    status_low: '🟠 На исходе',
    status_favorite: '⭐ Избранные',
    status_archived: '🗄 Архив',
    expiry_this_month: 'Истекает в этом месяце',
    expiry_next_month: 'В следующем',
    expiry_select: 'Выбрать месяц',
  },

  // ── Settings ─────────────────────────────────────────────────────
  settings: {
    title: '⚙️ *Настройки*\n\n',
    tz_label: '🕐 Часовой пояс: {value}',
    notif_reminders: '🔔 Напоминания: {value}',
    notif_expiry: '📅 Сроки годности: {value}',
    notif_stock: '📉 Остатки: {value}',
    digest_label: '📊 Дайджест: {value}',
    on: 'вкл',
    off: 'выкл',
    // Buttons
    btn_timezone: '🕐 Часовой пояс',
    btn_notifications: '🔔 Уведомления',
    btn_thresholds: '📐 Пороги',
    btn_periods: '🌅 Периоды дня',
    btn_digest: '📊 Дайджест',
    btn_display: '📋 Отображение',
    btn_export: '📤 Экспорт',
    btn_import: '📥 Импорт',
    // Timezone
    tz_prompt: '🕐 Выберите часовой пояс:',
    tz_toast: 'Часовой пояс обновлён',
    // Notifications
    notif_title: '🔔 *Уведомления*\n\nНажмите чтобы вкл/выкл:',
    notif_intake: '💊 Напоминания о приёме',
    notif_expiry_alerts: '📅 Сроки годности',
    notif_low_stock: '📉 Остатки',
    notif_shared: '👥 Изменения в общих аптечках',
    notif_enabled_toast: 'Включено',
    notif_disabled_toast: 'Выключено',
    // Thresholds
    thresh_title: '📐 *Пороги предупреждений*\n\n',
    thresh_expiry: '📅 Срок годности: за *{days}* дн.',
    thresh_stock: '📉 Остаток: *{count}* шт. или *{percent}%*',
    thresh_toast_expiry: 'Порог: {days} дней',
    thresh_toast_stock: 'Порог остатка: {count} шт.',
    btn_thresh_expiry_14: '📅 Срок: 14 дн.',
    btn_thresh_expiry_30: '📅 30 дн.',
    btn_thresh_expiry_60: '📅 60 дн.',
    btn_thresh_stock_3: '📉 Остаток: 3',
    btn_thresh_stock_5: '📉 5',
    btn_thresh_stock_10: '📉 10',
    // Day periods
    periods_title: '🌅 *Периоды дня*\n\n',
    period_morning: '🌅 Утро: {time}',
    period_afternoon: '☀️ День: {time}',
    period_evening: '🌆 Вечер: {time}',
    period_night: '🌙 Ночь: {time}',
    btn_period_morning: '🌅 Утро',
    btn_period_afternoon: '☀️ День',
    btn_period_evening: '🌆 Вечер',
    btn_period_night: '🌙 Ночь',
    period_edit_prompt: '{period}\n\nТекущее время: *{current}*\n\nВведите новое время в формате ЧЧ:ММ (например, 08:00):',
    period_updated: '✅ {period} обновлено: {time}',
    time_invalid: '⚠️ Неверный формат. Введите время в формате ЧЧ:ММ (например, 08:00):',
    time_invalid_range: '⚠️ Некорректное время. Введите время в формате ЧЧ:ММ (например, 08:00):',
    // Digest
    digest_title: '📊 *Дайджест*\n\n',
    digest_status_on: 'Статус: ✅ Включён',
    digest_status_off: 'Статус: ❌ Выключен',
    digest_time: '🕐 Время: {time}',
    digest_on_toast: 'Дайджест включён',
    digest_off_toast: 'Дайджест выключен',
    btn_digest_on: '🔔 Включить',
    btn_digest_off: '🔕 Выключить',
    btn_digest_time: '🕐 Время: {time}',
    digest_time_prompt: '🕐 Время дайджеста\n\nТекущее время: *{current}*\n\nВведите новое время в формате ЧЧ:ММ (например, 08:00):',
    digest_time_updated: '✅ Время дайджеста обновлено: {time}',
    // Display
    display_title: '📋 *Отображение*\n\n',
    display_sort: '🔀 Сортировка: *{value}*',
    display_date: '📅 Формат дат: *{value}*',
    btn_sort_name: 'По названию',
    btn_sort_expiry: 'По сроку',
    btn_sort_category: 'По категории',
    btn_sort_quantity: 'По остатку',
    btn_date_ddmmyyyy: 'ДД.ММ.ГГГГ',
    btn_date_yyyymmdd: 'ГГГГ-ММ-ДД',
    sort_toast: 'Сортировка: {value}',
    date_toast: 'Формат: {value}',
    // Quiet hours (#42)
    btn_quiet_hours: '🌙 Тихие часы',
    quiet_title: '🌙 *Тихие часы*\n\n',
    quiet_status_on: 'Статус: ✅ Включены',
    quiet_status_off: 'Статус: ❌ Выключены',
    quiet_from: '🕐 С: {time}',
    quiet_to: '🕐 До: {time}',
    quiet_on_toast: 'Тихие часы включены',
    quiet_off_toast: 'Тихие часы выключены',
    btn_quiet_on: '🔔 Включить',
    btn_quiet_off: '🔕 Выключить',
    btn_quiet_from: '🕐 С: {time}',
    btn_quiet_to: '🕐 До: {time}',
    quiet_from_prompt: '🕐 Начало тихих часов\n\nТекущее время: *{current}*\n\nВведите время начала в формате ЧЧ:ММ (например, 23:00):',
    quiet_to_prompt: '🕐 Конец тихих часов\n\nТекущее время: *{current}*\n\nВведите время окончания в формате ЧЧ:ММ (например, 07:00):',
    quiet_from_updated: '✅ Начало тихих часов обновлено: {time}',
    quiet_to_updated: '✅ Конец тихих часов обновлено: {time}',
    quiet_label: '🌙 Тихие часы: {value}',
    // Weekly report (#45)
    btn_weekly_report: '📊 Недельный отчёт',
    weekly_title: '📊 *Еженедельный отчёт*\n\n',
    weekly_status_on: 'Статус: ✅ Включён',
    weekly_status_off: 'Статус: ❌ Выключен',
    weekly_on_toast: 'Еженедельный отчёт включён',
    weekly_off_toast: 'Еженедельный отчёт выключен',
    btn_weekly_on: '🔔 Включить',
    btn_weekly_off: '🔕 Выключить',
    weekly_label: '📊 Недельный отчёт: {value}',
    // Auto shopping (#28)
    auto_shop_label: '🛒 Авто-покупки: {value}',
    btn_auto_shop: '🛒 Авто-покупки',
    auto_shop_title: '🛒 *Авто-добавление в покупки*\n\nКогда лекарство заканчивается, оно будет автоматически добавлено в список покупок.\n\n',
    auto_shop_status_on: 'Статус: ✅ Включено',
    auto_shop_status_off: 'Статус: ❌ Выключено',
    auto_shop_on_toast: 'Авто-покупки включены',
    auto_shop_off_toast: 'Авто-покупки выключены',
    btn_auto_shop_on: '🔔 Включить',
    btn_auto_shop_off: '🔕 Выключить',
    // Notification style (#113)
    notif_style_title: 'Стиль уведомлений:',
    notif_style_brief: 'Краткие',
    notif_style_detailed: 'Подробные',
  },

  // ── Sharing ──────────────────────────────────────────────────────
  sharing: {
    // Roles
    role_owner: '👑 Владелец',
    role_editor: '✏️ Редактор',
    role_viewer: '👁 Только просмотр',
    role_emoji_owner: '👑',
    role_emoji_editor: '✏️',
    role_emoji_viewer: '👁',
    unknown_user: 'Неизвестный',
    default_user: 'Пользователь',
    // Share menu
    share_title: '👥 *Поделиться аптечкой «{name}»*\n\nВыберите способ:',
    owner_only: 'Только владелец может делиться аптечкой',
    no_access: 'Нет доступа',
    btn_link: '🔗 По ссылке',
    btn_username: '📝 По @username',
    btn_members: '👥 Участники',
    // Link
    link_role_title: '🔗 *Приглашение по ссылке*\n\nВыберите роль для приглашённого:',
    link_result: '🔗 *Ссылка-приглашение*\n\nРоль: {role}\nАптечка: *{name}*\n\nОтправьте эту ссылку:\n`{link}`',
    btn_new_link: '🔗 Новая ссылка',
    // Username
    username_role_title: '📝 *Приглашение по username*\n\nВыберите роль для приглашённого:',
    username_prompt: '📝 *Приглашение по username*\n\nРоль: {role}\n\nВведите @username пользователя (без @):',
    username_invalid: '⚠️ Введите корректный username.',
    username_not_found: '❌ Пользователь @{name} не найден.\n\nОн должен сначала написать боту.',
    username_already_member: 'ℹ️ @{name} уже является участником этой аптечки.',
    username_self: 'ℹ️ Вы не можете пригласить самого себя.',
    username_notif: '📨 Вас пригласили в аптечку «{medkit}»!\n\nРоль: {role}\n\nНажмите, чтобы принять:',
    btn_accept: '✅ Принять приглашение',
    username_notif_fail: '⚠️ Не удалось отправить уведомление @{name}. Возможно, пользователь заблокировал бота.\n\nСсылка-приглашение:\n`{link}`',
    username_sent: '✅ Приглашение отправлено @{name}!\n\nРоль: {role}',
    btn_invite_more: '📨 Пригласить ещё',
    // Members
    members_title: '👥 *Участники: {name}*\n\n',
    members_pending: '📨 *Ожидают принятия:*\n',
    members_pending_item: '⏳ {name} — {role}\n',
    btn_invite: '📨 Пригласить',
    btn_leave: '🚪 Покинуть аптечку',
    member_not_found: 'Участник не найден',
    pending_by_link: 'по ссылке',
    medkit_not_found: 'Аптечка не найдена',
    medkit_not_found_text: '❌ Аптечка не найдена.',
    // Member actions
    member_detail: '👤 *Участник: {name}*\nРоль: {role}\n\nВыберите действие:',
    btn_change_role: '✏️ Изменить роль',
    btn_remove: '❌ Удалить',
    btn_remove_member: '🗑 Удалить участника',
    btn_transfer: '👑 Передать владение',
    btn_transfer_confirm: '✅ Да, передать',
    change_role_title: '🔄 *Изменить роль*\n\nВыберите новую роль:',
    role_changed_notif: '🔄 Ваша роль в аптечке «{medkit}» изменена на: {role}',
    role_changed_toast: 'Роль изменена',
    transfer_toast: 'Владение передано',
    // Remove
    remove_confirm: '🗑 Удалить участника *{name}* из аптечки «{medkit}»?',
    remove_toast: 'Участник удалён',
    remove_notif: '❌ Вы были удалены из аптечки «{medkit}».',
    // Leave
    leave_owner: 'Владелец не может покинуть аптечку. Сначала передайте владение.',
    leave_impossible: 'Невозможно покинуть аптечку',
    leave_confirm: '🚪 Вы уверены, что хотите покинуть аптечку «{name}»?',
    btn_leave_confirm: '✅ Да, покинуть',
    leave_owner_notif: '🚪 {name} покинул(а) аптечку «{medkit}».',
    leave_toast: 'Вы покинули аптечку',
    leave_done: '✅ Вы покинули аптечку «{name}».',
    // Transfer
    transfer_confirm: '👑 *Передача владения*\n\nВы уверены, что хотите передать владение аптечкой «{medkit}» пользователю *{name}*?\n\n⚠️ Вы станете редактором.',
    transfer_notif: '👑 Вам передано владение аптечкой «{name}»!',
    transfer_done: '✅ Владение аптечкой «{medkit}» передано пользователю *{name}*.\n\nВаша новая роль: ✏️ Редактор',
    // Deep link invitations
    invite_invalid: '❌ Приглашение недействительно или срок его действия истёк.',
    invite_unknown_medkit: 'Неизвестная аптечка',
    invite_already_member: 'ℹ️ Вы уже являетесь участником аптечки «{name}».',
    invite_wrong_user: '❌ Это приглашение предназначено для другого пользователя.',
    invite_is_owner: 'ℹ️ Вы являетесь владельцем этой аптечки.',
    invite_failed: '❌ Не удалось принять приглашение. Попробуйте позже.',
    invite_accepted: '✅ Вы присоединились к аптечке «{name}»!\n\nРоль: {role}',
    invite_owner_notif: '👥 {name} присоединился к аптечке «{medkit}»!',
  },

  // ── Statistics ───────────────────────────────────────────────────
  stats: {
    title: '📊 *Статистика приёмов*\n\nВыберите период:',
    btn_today: 'Сегодня',
    btn_week: 'Неделя',
    btn_month: 'Месяц',
    btn_all: 'Всё время',
    period_today: 'сегодня',
    period_week: 'неделю ({start} — {end})',
    period_month: 'месяц ({start} — {end})',
    period_all: 'всё время',
    no_data: '📊 *Статистика за {period}*\n\nНет данных о приёмах за этот период.',
    result_title: '📊 *Статистика за {period}*\n\n',
    result_total: '📈 Общее: {taken}/{planned} ({pct}%)',
    medicine_line: '💊 {name}: {taken}/{planned} ({pct}%)',
    streak: '🔥 Стрик: {count} {days} подряд',
    unknown_medicine: 'Неизвестно',
    // Trend (#35)
    trend_up: '↑ с {prev}%',
    trend_down: '↓ с {prev}%',
    trend_same: '→ без изменений',
    // Overall streak on menu (#37)
    streak_menu: '🔥 {count} дней подряд без пропусков!',
    // Worst time (#36)
    worst_time: '⚠️ Чаще всего пропускаете: {time} — {pct}% пропусков',
    // Per-medicine stats (#38)
    med_stats: '📊 Статистика:\n  Принято: {taken} из {planned} ({pct}%)\n  Текущая серия: {streak} дней\n  Лучшая серия: {best} дней',
    // Day names (Sunday-first, matching JS getDay())
    day_names: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
    // Day words
    days_1: 'день',
    days_2: 'дня',
    days_5: 'дней',
  },

  // ── Export / Import ──────────────────────────────────────────────
  export_import: {
    // Export
    export_title: '📤 *Экспорт данных*\n\nВыберите что экспортировать:',
    export_no_medkits: '📤 У вас нет аптечек для экспорта.',
    export_all: '📦 Все аптечки',
    export_no_medicines: 'Нет лекарств для экспорта',
    export_empty: '📤 В выбранной аптечке нет лекарств.',
    export_done: '📤 Экспорт завершён — {count} лекарств',
    csv_header: 'Название;Дозировка;Категория;Срок годности;Количество;Единица;Теги;Заметки',
    // Import
    import_title: '📥 *Импорт лекарств*\n\nОтправьте CSV-файл с лекарствами.\n\nФормат (разделитель — точка с запятой):\n`Название;Дозировка;Категория;Срок годности;Количество;Единица`\n\nПример:\n`Парацетамол;500мг;Жаропонижающие;03.2027;30;таблетки`',
    import_bad_format: '⚠️ Пожалуйста, отправьте файл в формате CSV.',
    import_no_medicines: '⚠️ Не удалось найти лекарства в файле. Проверьте формат.',
    import_preview: '📥 *Импорт: найдено {count} лекарств*\n\n',
    import_more: '\n_...и ещё {count}_\n',
    import_choose_medkit: '\nВ какую аптечку импортировать?',
    import_cancelled_toast: 'Импорт отменён',
    import_cancelled: '❌ Импорт отменён.',
    import_session_expired: 'Сессия истекла. Начните заново.',
    import_medkit_not_found: '⚠️ Аптечка не найдена.',
    import_done: '✅ Импортировано *{created}* лекарств в аптечку *«{medkit}»*',
    import_errors: '\n⚠️ Не удалось импортировать: {count}',
    btn_open_medkit: '📦 Открыть аптечку',
    btn_to_menu: '◀️ В меню',
  },

  // ── Onboarding ───────────────────────────────────────────────────
  onboarding: {
    welcome: '👋 *Добро пожаловать в Medkit Bot!*\n\nЯ помогу вам управлять домашней аптечкой:\n• 📦 Вести каталог лекарств\n• 📅 Отслеживать сроки годности\n• 💊 Напоминать о приёме\n• 👥 Делиться аптечкой с семьёй\n• 🛒 Вести список покупок\n\nДавайте настроим бот для вас!',
    tz_prompt: '🕐 Выберите ваш часовой пояс:',
    tz_set: 'Часовой пояс установлен',
    first_medkit: '✅ Часовой пояс установлен!\n\n📦 Я создал вашу первую аптечку — *«Домашняя»*.\n\nХотите добавить первое лекарство прямо сейчас?',
    btn_add: '💊 Да, добавить',
    btn_skip: '⏭ Пропустить, покажи что тут есть',
    // Tour (#81)
    tour_1: '👋 Добро пожаловать! Я помогу управлять вашей аптечкой',
    tour_2: '💊 Добавляйте лекарства, следите за сроками и количеством',
    tour_3: '⏰ Настройте напоминания — я не дам забыть о приёме',
    tour_4: '👨‍👩‍👧 Ведите аптечку для всей семьи',
    btn_next: 'Далее ▶️',
    btn_skip_tour: '⏩ Пропустить',
    // Quick start (#82)
    quick_start: 'Добавьте первое лекарство за 30 секунд!',
    // Tips (#83)
    tip_1: '💡 Знали ли вы? Вы можете сфотографировать лекарство, и фото сохранится на карточке.',
    tip_2: '💡 Создайте расписание приёма — бот напомнит вовремя и спишет остаток.',
    tip_3: '💡 Поделитесь аптечкой с семьёй по ссылке — каждый увидит содержимое.',
    tip_4: '💡 Добавляйте теги к лекарствам — потом удобно фильтровать.',
    tip_5: '💡 Просто напишите название лекарства — бот попробует найти его.',
    tip_6: '💡 Экспортируйте данные в CSV для резервной копии.',
    tip_7: '💡 Настройте дайджест — бот будет присылать ежедневную сводку.',
    // Progress (#84)
    progress_title: '📋 Ваш профиль: {pct}%',
    progress_medkit: '✅ Аптечка создана',
    progress_medicine: '✅ Лекарства добавлены',
    progress_no_medkit: '❌ Аптечка не создана',
    progress_no_medicine: '❌ Лекарства не добавлены',
    progress_no_schedule: '❌ Расписания не созданы',
    progress_no_photo: '❌ Фото не загружены',
    progress_schedule: '✅ Расписания созданы',
    progress_photo: '✅ Фото загружены',
    complete: '🎉 *Всё готово! Вот что вы можете делать:*\n\n📦 *Аптечки* — создавайте несколько аптечек (Домашняя, Дачная, В дорогу) и переключайтесь между ними\n\n💊 *Лекарства* — добавляйте с дозировкой, сроком годности, категорией, фото и заметками. Помечайте важные ⭐\n\n📆 *Приём* — настройте расписание, и бот будет напоминать вовремя\n\n👥 *Общий доступ* — поделитесь аптечкой с семьёй по ссылке\n\n🔍 *Поиск* — просто напишите название лекарства в чат\n\n⚙️ *Настройки* — часовой пояс, уведомления, дайджест\n\nНажмите кнопку ниже чтобы начать 👇',
  },

  // ── Help ─────────────────────────────────────────────────────────
  help: {
    text: '📖 *Помощь — Medkit Bot*\n\nЯ помогу управлять вашими домашними аптечками!\n\n*📦 Аптечки*\nСоздавайте несколько аптечек (Домашняя, Дачная, В дорогу) и управляйте ими.\nДелитесь аптечками с семьёй — каждый участник видит содержимое.\n\n*💊 Лекарства*\nДобавляйте лекарства с дозировкой, категорией, сроком годности, количеством.\nПрикрепляйте до 5 фото и заметки.\nПомечайте избранные ⭐ — они всегда вверху.\nКопируйте и перемещайте между аптечками.\n\n*📆 Приём и расписание*\nНастройте курсы приёма: точное время или период дня.\nБот напомнит о приёме и автоматически спишет остаток.\nОтслеживайте стрики и статистику соблюдения.\n\n*👥 Общие аптечки*\nПоделитесь аптечкой по ссылке или @username.\nРоли: владелец, редактор, только просмотр.\n\n*🛒 Список покупок*\nДобавляйте лекарства в список покупок.\nОтмечайте купленное и пополняйте остаток.\nДелитесь списком текстом для пересылки.\n\n*🔍 Поиск*\nБыстрый поиск по названию среди всех аптечек.\nПросто напишите название — бот попробует найти.\n\n*📊 Статистика*\nОтслеживайте соблюдение курсов, стрики и историю.\nПериоды: сегодня, неделя, месяц, всё время.\n\n*📤 Экспорт / 📥 Импорт*\nЭкспортируйте данные в CSV.\nИмпортируйте лекарства из CSV-файла.\n\n*⚙️ Настройки*\nЧасовой пояс, периоды дня, уведомления, пороги, дайджест, отображение.\n\n*Команды:*\n/start — Главное меню\n/help — Эта справка\n/cancel — Отмена текущего действия',
    btn_medkits: '📦 Аптечки',
    btn_intake: '💊 Приём',
    btn_shopping: '🛒 Покупки',
    btn_stats: '📊 Статистика',
  },

  // ── Cron notifications ───────────────────────────────────────────
  cron: {
    // Reminders
    reminder_title: '💊 *Напоминание о приёме*\n\n',
    reminder_dose: '💊 Доза: {dose} {unit}',
    reminder_notes: '📝 {notes}',
    reminder_medicine: 'Лекарство',
    btn_take: '✅ Принял',
    btn_snooze: '⏰ +15 мин',
    btn_skip: '❌ Пропуск',
    // Grouped reminder (#44)
    reminder_grouped: '⏰ Пора принять лекарства:\n',
    reminder_grouped_item: '  💊 {name} — {dose} {unit}\n',
    btn_take_all: '✅ Всё принято',
    btn_details: 'Подробнее',
    // Expiry check
    expiry_title: '⚠️ *Срок годности истекает:*\n\n',
    expiry_overdue: 'ПРОСРОЧЕНО',
    expiry_days: '{count} дн.',
    // Digest
    digest_title: '📊 *Дайджест на {date}*\n\n',
    digest_intakes: '💊 Приёмов на сегодня: {count}',
    digest_expiring: '⚠️ Истекает скоро: {count} {word}',
    digest_low: '📉 Заканчивается: {count} {word}',
    digest_shopping: '🛒 В списке покупок: {count}',
    // Medicine word plurals
    med_1: 'лекарство',
    med_2: 'лекарства',
    med_5: 'лекарств',
    // Low stock warning (#27)
    low_stock_warning: '⚠️ {name} заканчивается (осталось {count}). Добавить в список покупок?',
    btn_add_to_shop: '🛒 Добавить',
    btn_later: 'Позже',
    // Auto-add to shopping (#28)
    auto_added_shop: '\n🛒 _{name}_ автоматически добавлен в список покупок.',
    // Weekly report (#45)
    weekly_title: '📊 *Еженедельный отчёт*\n\n',
    weekly_adherence: '💊 Соблюдение приёмов: {pct}% ({taken}/{planned})',
    weekly_expiring: '⚠️ Истекает скоро: {count} {word}',
    weekly_low_stock: '📉 Заканчивается: {count} {word}',
    weekly_shopping: '🛒 В списке покупок: {count}',
    weekly_no_data: 'На этой неделе нет данных для отчёта.',
    weekly_perfect: '🎉 Отличная неделя! Все приёмы выполнены.',
    // Inactive reminder (#89)
    inactive_reminder: 'Вы давно не заходили. У вас {count} непринятых лекарств. /menu',
  },

  // ── Achievements (#90) ───────────────────────────────────────────
  achievements: {
    title: '🏆 *Достижения*\n\n',
    first_medicine: '🏆 Первое лекарство',
    streak_7: '🔥 7 дней подряд',
    streak_30: '🔥🔥 30 дней подряд',
    medicines_10: '💊 10 лекарств добавлено',
    shared_medkit: '🤝 Поделились аптечкой',
    month_with_bot: '📅 Месяц с ботом',
    all_taken_day: '✅ Все приёмы за день',
    first_profile: '👨‍👩‍👧 Первый профиль',
    photo_added: '📸 Первое фото лекарства',
    full_week: '📊 Неделя 100% приёмов',
    unlocked: '🎉 Новое достижение: {name}',
    // Streak congrats (#91)
    streak_congrats_7: '🔥 {count} дней подряд! Так держать!',
    streak_congrats_30: '🎉 {count} дней без пропусков! Впечатляет!',
  },

  // ── Profiles (#46-56) ────────────────────────────────────────────
  profile: {
    title: '👤 *Профили*\n\n',
    empty: 'У вас пока нет профилей.',
    btn_add: '➕ Добавить профиль',
    // Create
    create_name: '👤 *Новый профиль*\n\nВведите имя:',
    create_birth_year: 'Введите год рождения (необязательно):',
    create_icon: 'Выберите иконку:',
    // Card
    card_name: '{icon} *{name}*',
    card_age: 'Возраст: {age}',
    card_tags: 'Теги: {tags}',
    // Edit
    btn_edit_name: '✏️ Имя',
    btn_edit_year: '🔢 Год рождения',
    btn_edit_icon: '😊 Иконка',
    btn_delete: '🗑 Удалить',
    // Delete
    delete_confirm: 'Удалить профиль «{name}»?\n\nЧто сделать с лекарствами?',
    btn_transfer: 'Перенести в "Общие"',
    btn_delete_all: 'Удалить всё',
    // Filter
    btn_filter: '👤 Фильтр',
    filter_all: 'Все',
    filter_general: 'Общие',
    // For whom
    for_whom: 'Для кого это лекарство?',
    general: 'Общее',
  },

  // ── Wellbeing (#59-60) ───────────────────────────────────────────
  wellbeing: {
    prompt: 'Как самочувствие?',
    good: '😊 Хорошо',
    ok: '😐 Нормально',
    bad: '😔 Плохо',
    note_prompt: 'Добавьте заметку (необязательно):',
    saved: 'Записано!',
    calendar_title: '{month} {year}:',
    summary: '{good} × {good_count}  {ok} × {ok_count}  {bad} × {bad_count}',
  },

  // ── Courses (#104) ───────────────────────────────────────────────
  course: {
    title: '📋 *Курс: {name}*',
    btn_create: '➕ Создать курс',
    create_name: '📋 *Новый курс*\n\nВведите название:',
    select_medicines: 'Выберите лекарства для курса:',
    btn_pause_all: '⏸ Пауза курса',
    btn_complete: '✅ Завершить курс',
    btn_schedules: '▶️ Все расписания',
  },

  // ── Backup (#100) ────────────────────────────────────────────────
  backup: {
    export_confirm: '📦 *Бэкап данных*\n\nЭкспортировать все данные (аптечки, лекарства, расписания) в JSON-файл?',
    export_done: '✅ Бэкап создан.',
    btn_export: '📦 Бэкап (JSON)',
    btn_import_json: '📥 Восстановить из JSON',
    import_confirm: '📥 *Восстановление из бэкапа*\n\nБудет создано:\n📦 {medkits} аптечек\n💊 {medicines} лекарств\n📆 {schedules} расписаний\n\nПродолжить?',
    import_done: '✅ Данные восстановлены: {medkits} аптечек, {medicines} лекарств, {schedules} расписаний.',
    import_errors: '\n⚠️ Ошибок: {count}',
    import_invalid: '⚠️ Файл не является корректным бэкапом. Убедитесь, что это JSON-файл, экспортированный из бота.',
    import_send_json: '📥 *Восстановление из бэкапа*\n\nОтправьте JSON-файл, экспортированный из бота.',
  },

  // ── Format helpers (used by format.js) ───────────────────────────
  format: {
    // Relative dates (#9)
    today: 'сегодня',
    tomorrow: 'завтра',
    yesterday: 'вчера',
    in_days: 'через {count} {word}',
    ago_days: '{count} {word} назад',
    in_weeks: 'через {count} {word}',
    ago_weeks: '{count} {word} назад',
    day_1: 'день',
    day_2: 'дня',
    day_5: 'дней',
    week_1: 'неделю',
    week_2: 'недели',
    week_5: 'недель',
    // Quantity units
    unit_tablets_1: 'таблетка',
    unit_tablets_2: 'таблетки',
    unit_tablets_5: 'таблеток',
    // Month names
    months: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
    months_short: ['янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.'],
  },
};
