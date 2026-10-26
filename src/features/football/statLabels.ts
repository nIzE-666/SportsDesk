/** Russian labels keyed by the provider's stable identifiers. */
const labels: Record<string, string> = {
  clearances: 'Выносы мяча',
  interceptions: 'Перехваты',
  keeper_saves: 'Сейвы вратаря',
  tackles: 'Отборы',
  shot_blocks: 'Блокировки ударов',
  blocks: 'Блокировки ударов',
  fouls: 'Нарушения правил',
  red_cards: 'Красные карточки',
  yellow_cards: 'Жёлтые карточки',
  aerials_won: 'Выигранные верховые единоборства',
  dribbles_succeeded: 'Успешные обводки',
  duel_won: 'Выигранные единоборства',
  duel_lost: 'Проигранные единоборства',
  ground_duels_won: 'Выигранные единоборства внизу',
  expected_goals: 'Ожидаемые голы (xG)',
  expected_goals_non_penalty: 'Ожидаемые голы без пенальти (xG)',
  expected_goals_on_target: 'Ожидаемые голы после ударов в створ (xGOT)',
  expected_goals_on_target_variant: 'Ожидаемые голы после ударов в створ (xGOT)',
  expected_goals_open_play: 'Ожидаемые голы с игры (xG)',
  expected_goals_set_play: 'Ожидаемые голы со стандартов (xG)',
  offsides: 'Офсайды',
  accurate_crosses: 'Точные навесы',
  accurate_passes: 'Точные передачи',
  long_balls_accurate: 'Точные длинные передачи',
  opposition_half_passes: 'Передачи на чужой половине',
  own_half_passes: 'Передачи на своей половине',
  passes: 'Передачи',
  player_throws: 'Вбрасывания',
  touches_opp_box: 'Касания в чужой штрафной',
  shotsofftarget: 'Удары мимо',
  shots_off_target: 'Удары мимо',
  shotsontarget: 'Удары в створ',
  shots_on_target: 'Удары в створ',
  blocked_shots: 'Заблокированные удары',
  shots_inside_box: 'Удары из штрафной',
  shots_outside_box: 'Удары из-за штрафной',
  shots_woodwork: 'Попадания в каркас ворот',
  total_shots: 'Всего ударов',
  ballpossesion: 'Владение мячом',
  ball_possession: 'Владение мячом',
  big_chance: 'Голевые моменты',
  big_chance_missed_title: 'Упущенные голевые моменты',
  corners: 'Угловые',
  goals: 'Голы',
  rating_title: 'Рейтинг',
  rating: 'Рейтинг',
  rating_avg: 'Средний рейтинг',
  assists: 'Голевые передачи',
  xg_and_xa: 'Ожидаемые голы и передачи (xG + xA)',
  xg_xa: 'Ожидаемые голы и передачи (xG + xA)',
  xg: 'Ожидаемые голы (xG)',
  xa: 'Ожидаемые голевые передачи (xA)',
  fantasy_points: 'Очки фэнтези',
  minutes_played: 'Сыграно минут',
  minutes: 'Сыграно минут',
  chances_created: 'Созданные моменты',
  defensive_actions: 'Действия в обороне',
  expected_assists: 'Ожидаемые голевые передачи (xA)',
  touches: 'Касания мяча',
  dispossessed: 'Потери мяча под давлением',
  line_breaking_passes: 'Передачи между линиями',
  passes_into_final_third: 'Передачи в финальную треть',
  recoveries: 'Подборы мяча',
  ball_recoveries: 'Подборы мяча',
  dribbled_past: 'Обведён соперником',
  headed_clearance: 'Выносы головой',
  was_fouled: 'Заработанные фолы',
  shot_accuracy: 'Точность ударов',
  keeper_sweeper: 'Выходы за пределы штрафной',
  keeper_diving_save: 'Сейвы в прыжке',
  goals_conceded: 'Пропущенные голы',
  goals_prevented: 'Предотвращённые голы',
  keeper_high_claim: 'Перехваты верховых мячей',
  punches: 'Выносы кулаками',
  saves: 'Сейвы',
  saves_inside_box: 'Сейвы после ударов из штрафной',
  expected_goals_on_target_faced: 'Ожидаемые голы после ударов по воротам (xGOT)',
  big_chance_created_team_title: 'Созданные голевые моменты',
  errors_led_to_goal: 'Ошибки, приведшие к голу',
  clearance_off_the_line: 'Выносы с линии ворот',
  pass_accuracy: 'Точность передач',
  accurate_passes_count: 'Количество точных передач',
  total_passes: 'Всего передач',
  shots: 'Удары',
  penalties_won: 'Заработанные пенальти',
  penalties_conceded: 'Привезённые пенальти',
  penalties_missed: 'Незабитые пенальти',
  penalties_scored: 'Голы с пенальти',
  penalties_saved: 'Отражённые пенальти',
  yellow_red_cards: 'Вторые жёлтые карточки',
  distance_covered: 'Преодолённая дистанция',
  errors_lead_to_shot: 'Ошибки, приведшие к удару',
  final_third_entries: 'Входы в финальную треть',
  big_chances: 'Голевые моменты',
  possession: 'Владение мячом',
  own_goals: 'Автоголы',
  successful_dribbles: 'Успешные обводки',
  offsides_team: 'Офсайды',
  hit_woodwork: 'Попадания в каркас ворот',
  shotmap: 'Карта ударов',
};
const groupNames: Record<string, string> = {
  defence: 'Оборона',
  defense: 'Оборона',
  discipline: 'Дисциплина',
  duels: 'Единоборства',
  'expected goals (xg)': 'Ожидаемые голы (xG)',
  'expected goals': 'Ожидаемые голы (xG)',
  passes: 'Передачи',
  passing: 'Передачи',
  shots: 'Удары',
  'top stats': 'Основные показатели',
  top_stats: 'Основные показатели',
  attack: 'Атака',
  goalkeeping: 'Игра вратаря',
  keeper: 'Игра вратаря',
  possession: 'Владение мячом',
  general: 'Общие показатели',
  other: 'Другие показатели',
  shooting: 'Удары',
};
const labelAliases: Record<string, string> = {
  'ball possession': 'ballpossesion',
  'accurate passes': 'accurate_passes',
  'xg + xa': 'xg_and_xa',
  shotmap: 'shotmap',
  'fouls committed': 'fouls',
  'minutes played': 'minutes_played',
  'total shots': 'total_shots',
  'expected assists (xa)': 'expected_assists',
};
Object.assign(labels, {
  physical_metrics_distance_covered: 'Общая пройденная дистанция',
  physical_metrics_number_of_sprints: 'Количество спринтов',
  physical_metrics_running: 'Дистанция бегом',
  physical_metrics_sprinting: 'Дистанция спринтом',
  physical_metrics_walking: 'Дистанция шагом',
});
groupNames['physical performance'] = 'Физическая активность';
groupNames.physical_metrics = 'Физическая активность';
labels.physical_metrics_top_speed = 'Максимальная скорость';
labels.top_speed = 'Максимальная скорость';
labelAliases['top speed'] = 'top_speed';
export function formatDistanceStat(value: number, total?: number): string {
  if (!Number.isFinite(value)) return '—';
  const distance = formatTeamStat(String(value), 'distance');
  return typeof total === 'number' && Number.isFinite(total) && total > 0
    ? `${distance} (${((value / total) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%)`
    : distance;
}
export function formatTeamStat(raw: string, type?: string): string {
  if (raw == null || raw === '') return '—';
  const text = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (type === 'distance')
      return `${(n / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 })} км`;
    if (type === 'speed') return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} км/ч`;
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  }
  return text.replace(/(\d)\.(?=\d)/g, '$1,');
}
export function statLabel(key: string | undefined, fallback: string): string {
  const normalized = (key ?? '')
    .trim()
    .toLowerCase()
    .replace(/^matchstats\.headers\./, '');
  return labels[normalized] ?? labels[labelAliases[fallback.toLowerCase()] ?? ''] ?? fallback;
}
export function statGroupLabel(key: string | undefined, fallback?: string): string {
  return (
    groupNames[(key ?? '').trim().toLowerCase()] ??
    groupNames[(fallback ?? '').trim().toLowerCase()] ??
    fallback ??
    key ??
    'Показатели'
  );
}
export function statsPeriodLabel(period: string): string {
  return (
    (
      {
        All: 'Весь матч',
        FirstHalf: 'Первый тайм',
        SecondHalf: 'Второй тайм',
        ExtraTime: 'Дополнительное время',
        ExtraFirstHalf: 'Первый доп. тайм',
        ExtraSecondHalf: 'Второй доп. тайм',
        FirstExtraHalf: 'Первый доп. тайм',
        SecondExtraHalf: 'Второй доп. тайм',
        PenaltyShootout: 'Серия пенальти',
      } as Record<string, string>
    )[period] ?? period
  );
}
